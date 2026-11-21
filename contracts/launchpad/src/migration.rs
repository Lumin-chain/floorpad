//! Seamless migration: buying never stops while a token moves to Rhea (Ref).
//!
//! * The buy that sells out the curve fills it exactly; the NEAR beyond that is queued as a
//!   Rhea buy instead of being refunded.
//! * While graduation runs (CreatePool .. AddLiquidity), `buy` queues the NEAR instead of failing.
//! * Once the pool is live, `process_migration_buys` (anyone; the keeper calls it right after
//!   graduation) runs one step per call:
//!     0. stake the whole queue as LiNEAR,
//!     1. deposit it into the launchpad's Ref account,
//!     2. ONE swap on the pool, only near the opening price (reference band) and with a minimum
//!        output, so nobody can sandwich the queue,
//!     3. withdraw the tokens and split them pro rata by NEAR: everyone in the queue buys at the
//!        same price.
//!   `deliver_migration_buys` then pushes the tokens to the buyers (anyone may call it; a failed
//!   transfer becomes claimable with `claim_tokens`).
//! * If the pool stays outside the price band for a day, the queue is refunded in LiNEAR
//!   (claimable), so funds can never be stuck.
//! * Buying never fails on timing: a buy that arrives while a round is executing waits in a
//!   second list and joins the next round; a curve buy that lands just after graduation (a page
//!   that had not refreshed yet) is queued too.
//!
//! State lives under its own storage key, so `TokenState` and the contract layout are unchanged.
use crate::curve::{ONE_YOCTO, STORAGE_FEE};
use crate::ext::{ext_ft, ext_linear, ext_ref, tgas, RefPoolInfo};
use crate::guard::{cp_out, within_band, SWAP_SLIPPAGE_BPS};
use crate::math;
use crate::*;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{Promise, PromiseError, PromiseOrValue};

/// Most buyers one queue holds (keeps every step well inside gas limits).
pub const MAX_QUEUE: usize = 150;
/// Leftovers below this are refunded instead of queued.
pub const MIN_QUEUED: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// After this long outside the price band, the queue is refunded in LiNEAR.
const REFUND_AFTER_SECS: u64 = 86_400;
/// Deliveries per `deliver_migration_buys` call.
const DELIVER_BATCH: u32 = 8;
/// A step still marked busy after this long lost its callback; it may be run again.
const STALE_STEP_SECS: u64 = 600;

const STAGE_QUEUED: u8 = 0;
const STAGE_STAKED: u8 = 1;
const STAGE_IN_REF: u8 = 2;
const STAGE_SWAPPED: u8 = 3;

#[derive(BorshSerialize, BorshDeserialize, Clone, Default)]
#[borsh(crate = "near_sdk::borsh")]
pub struct MigrationQueue {
    /// (buyer, NEAR, needs token storage registered on delivery)
    pub entries: Vec<(AccountId, u128, bool)>,
    pub total: u128,
    pub busy: bool,
    pub stage: u8,
    /// LiNEAR minted for the queue (stages 1-2).
    pub shares: u128,
    /// Tokens bought (stage 3).
    pub out: u128,
    /// When the pool first became available for the queue (refund timer).
    pub since: u64,
    /// Tokens credited and waiting to be sent: (buyer, amount, needs storage)
    pub deliveries: Vec<(AccountId, u128, bool)>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MigrationQueueView {
    pub queued_near: U128,
    pub buyers: u32,
    pub stage: u8,
    pub busy: bool,
    pub pending_deliveries: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct QueuedBuyView {
    /// NEAR waiting to be bought on Rhea.
    pub queued_near: U128,
    /// Tokens bought and waiting to be sent.
    pub tokens_to_deliver: U128,
}

fn add_entry(list: &mut QueueEntries, buyer: &AccountId, near: u128, needs_storage: bool) {
    if let Some(e) = list.iter_mut().find(|e| &e.0 == buyer) {
        e.1 += near;
        e.2 |= needs_storage;
    } else {
        require!(list.len() < MAX_QUEUE, "ERR_QUEUE_FULL");
        list.push((buyer.clone(), near, needs_storage));
    }
}

fn mq_key(idx: u32) -> Vec<u8> {
    let mut k = b"g:mq".to_vec();
    k.extend_from_slice(&idx.to_le_bytes());
    k
}

/// Buys that arrived while a round was executing; they join the next round.
fn mq_wait_key(idx: u32) -> Vec<u8> {
    let mut k = b"g:mqw".to_vec();
    k.extend_from_slice(&idx.to_le_bytes());
    k
}

type QueueEntries = Vec<(AccountId, u128, bool)>;

/// When the current step started (own key, so `MigrationQueue` keeps its layout).
fn mq_step_key(idx: u32) -> Vec<u8> {
    let mut k = b"g:mqt".to_vec();
    k.extend_from_slice(&idx.to_le_bytes());
    k
}

/// Amount from a Ref `withdraw` result: 0 when it failed (Ref keeps the deposit).
fn withdrawn_amount() -> u128 {
    match env::promise_result_checked(0, 64) {
        Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(0),
        Err(_) => 0,
    }
}

impl Contract {
    pub(crate) fn mq(&self, idx: u32) -> MigrationQueue {
        env::storage_read(&mq_key(idx))
            .map(|v| MigrationQueue::try_from_slice(&v).expect("ERR_MQ"))
            .unwrap_or_default()
    }

    pub(crate) fn set_mq(&mut self, idx: u32, q: &MigrationQueue) {
        env::storage_write(&mq_key(idx), &borsh::to_vec(q).expect("ERR_MQ"));
    }

    /// True while the token is between "curve sold out" and "pool live".
    pub(crate) fn is_migrating(&self, idx: u32) -> bool {
        let s = &self.tok(idx).grad_stage;
        *s != GradStage::Curve && *s != GradStage::Graduated
    }

    /// Queue `near` for `buyer`. Returns false (caller refunds) when it is too small to queue.
    pub(crate) fn enqueue_migration_buy(&mut self, idx: u32, buyer: &AccountId, near: u128, needs_storage: bool) -> bool {
        if near < MIN_QUEUED {
            return false;
        }
        let mut q = self.mq(idx);
        if q.stage == STAGE_QUEUED && !q.busy {
            add_entry(&mut q.entries, buyer, near, needs_storage);
            q.total += near;
            self.set_mq(idx, &q);
        } else {
            // a round is executing: its amounts are fixed, so this buy joins the next round
            let mut w = self.mq_waiting(idx);
            add_entry(&mut w, buyer, near, needs_storage);
            self.set_mq_waiting(idx, &w);
        }
        self.log_mech(idx, "migration_buy_queued", near, Some(buyer.clone()));
        true
    }

    pub(crate) fn mq_waiting(&self, idx: u32) -> QueueEntries {
        env::storage_read(&mq_wait_key(idx))
            .map(|v| QueueEntries::try_from_slice(&v).expect("ERR_MQ"))
            .unwrap_or_default()
    }

    fn set_mq_waiting(&mut self, idx: u32, w: &QueueEntries) {
        if w.is_empty() {
            env::storage_remove(&mq_wait_key(idx));
        } else {
            env::storage_write(&mq_wait_key(idx), &borsh::to_vec(w).expect("ERR_MQ"));
        }
    }

    /// Between rounds: buys that waited during the last round join the queue.
    fn promote_waiting(&mut self, idx: u32, q: &mut MigrationQueue) {
        if q.stage != STAGE_QUEUED || q.busy {
            return;
        }
        let w = self.mq_waiting(idx);
        if w.is_empty() {
            return;
        }
        for (who, near, storage) in w {
            add_entry(&mut q.entries, &who, near, storage);
            q.total += near;
        }
        self.set_mq_waiting(idx, &Vec::new());
    }

    /// Meta Pool stakes at least 1 NEAR: a queue below that is refunded in NEAR (no stake made).
    fn refund_small_queue(&mut self, idx: u32, mut q: MigrationQueue) -> Promise {
        let total = q.total;
        let mut out: Option<Promise> = None;
        for (who, near, _) in q.entries.drain(..) {
            let p = Promise::new(who).transfer(NearToken::from_yoctonear(near));
            out = Some(match out {
                None => p,
                Some(prev) => prev.and(p),
            });
        }
        self.log_mech(idx, "migration_refund", total, None);
        q.total = 0;
        q.since = 0;
        self.finish_step(idx, q);
        out.expect("ERR_QUEUE_EMPTY")
    }

    fn finish_step(&mut self, idx: u32, mut q: MigrationQueue) {
        q.busy = false;
        self.set_mq(idx, &q);
    }

    /// A busy step whose callback never landed (no start time recorded, or too old).
    pub(crate) fn step_is_stale(&self, idx: u32) -> bool {
        match env::storage_read(&mq_step_key(idx)) {
            Some(v) if v.len() == 8 => {
                let started = u64::from_le_bytes(v.try_into().unwrap());
                now_secs() > started + STALE_STEP_SECS
            }
            _ => true,
        }
    }

    /// The bought tokens are in the launchpad: split them pro rata by NEAR for delivery.
    fn distribute_bought(&mut self, idx: u32, mut q: MigrationQueue) {
        let out = q.out;
        let mut given = 0u128;
        let n = q.entries.len();
        for (i, (who, near, storage)) in q.entries.drain(..).enumerate() {
            let share = if i + 1 == n { out - given } else { math::mul_div(out, near, q.total) };
            given += share;
            q.deliveries.push((who, share, storage));
        }
        self.tok_mut(idx).owed_tokens += out; // reserved until delivered
        self.log_mech(idx, "migration_buys", out, None);
        q.total = 0;
        q.shares = 0;
        q.out = 0;
        q.stage = STAGE_QUEUED;
        q.since = 0;
        self.finish_step(idx, q);
    }
}

#[near]
impl Contract {
    pub fn get_migration_queue(&self, token_id: AccountId) -> MigrationQueueView {
        let idx = self.idx_of(&token_id);
        let q = self.mq(idx);
        let w = self.mq_waiting(idx);
        MigrationQueueView {
            // includes buys waiting for the next round
            queued_near: U128(q.total + w.iter().map(|e| e.1).sum::<u128>()),
            buyers: (q.entries.len() + w.iter().filter(|e| !q.entries.iter().any(|x| x.0 == e.0)).count()) as u32,
            stage: q.stage,
            busy: q.busy,
            pending_deliveries: q.deliveries.len() as u32,
        }
    }

    pub fn get_queued_buy(&self, token_id: AccountId, account_id: AccountId) -> QueuedBuyView {
        let idx = self.idx_of(&token_id);
        let q = self.mq(idx);
        let near = q.entries.iter().chain(self.mq_waiting(idx).iter()).filter(|e| e.0 == account_id).map(|e| e.1).sum::<u128>();
        let tokens = q.deliveries.iter().filter(|e| e.0 == account_id).map(|e| e.1).sum::<u128>();
        QueuedBuyView { queued_near: U128(near), tokens_to_deliver: U128(tokens) }
    }

    /// Permissionless: advance the queue one step (see module docs). Attach 300 Tgas.
    pub fn process_migration_buys(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        require!(self.tok(idx).grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        let mut q = self.mq(idx);
        require!(!q.busy || self.step_is_stale(idx), "ERR_QUEUE_STEP_IN_FLIGHT");
        self.promote_waiting(idx, &mut q);
        require!(q.total > 0, "ERR_QUEUE_EMPTY");
        if q.stage == STAGE_QUEUED && q.total < crate::stake::META_MIN_STAKE && self.asset_kind(&self.asset(idx)) == crate::stake::KIND_META {
            return self.refund_small_queue(idx, q);
        }
        env::storage_write(&mq_step_key(idx), &now_secs().to_le_bytes());
        if q.since == 0 {
            q.since = now_secs();
        }
        q.busy = true;
        let stage = q.stage;
        let shares = q.shares;
        self.set_mq(idx, &q);
        let me = env::current_account_id();
        let cfg = self.config.clone();
        let asset = self.asset(idx);
        let pool_id = self.tok(idx).pool_id.expect("ERR_NO_POOL");
        match stage {
            STAGE_QUEUED => ext_linear::ext(asset)
                .with_attached_deposit(NearToken::from_yoctonear(q.total))
                .with_static_gas(tgas(40))
                .deposit_and_stake()
                .then(Self::ext(me).with_static_gas(tgas(15)).on_mq_staked(idx)),
            STAGE_STAKED => ext_ft::ext(asset)
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(60))
                .ft_transfer_call(cfg.ref_exchange, U128(shares), None, String::new())
                .then(Self::ext(me).with_static_gas(tgas(15)).on_mq_deposited(idx)),
            STAGE_IN_REF => ext_ref::ext(cfg.ref_exchange)
                .with_static_gas(tgas(5))
                .get_pool(pool_id)
                .then(Self::ext(me).with_static_gas(tgas(150)).on_mq_pool(idx)),
            // check first: a retried step must not withdraw twice
            _ => ext_ref::ext(cfg.ref_exchange)
                .with_static_gas(tgas(5))
                .get_deposit(me.clone(), token_id)
                .then(Self::ext(me).with_static_gas(tgas(130)).on_mq_out_checked(idx)),
        }
    }

    /// Withdraw the bought tokens, or split them right away if an earlier attempt already did.
    #[private]
    pub fn on_mq_out_checked(&mut self, idx: u32, #[callback_result] dep: Result<U128, PromiseError>) -> PromiseOrValue<()> {
        let q = self.mq(idx);
        let Ok(dep) = dep else {
            self.finish_step(idx, q);
            return PromiseOrValue::Value(());
        };
        if dep.0 < q.out {
            // Ref no longer holds them: the earlier withdrawal landed in the launchpad
            env::log_str("migration queue: tokens already withdrawn, splitting");
            self.distribute_bought(idx, q);
            return PromiseOrValue::Value(());
        }
        let token_id = self.tok(idx).token_id.clone();
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(40))
            .withdraw(token_id, U128(q.out), None, Some(true))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(60)).on_mq_withdrawn(idx))
            .into()
    }

    #[private]
    pub fn on_mq_staked(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) {
        let mut q = self.mq(idx);
        if let Ok(shares) = r {
            q.shares = shares.0;
            q.stage = STAGE_STAKED;
        } // on failure LiNEAR returned the NEAR: retry from the start
        self.finish_step(idx, q);
    }

    #[private]
    pub fn on_mq_deposited(&mut self, idx: u32) {
        let mut q = self.mq(idx);
        let used = match env::promise_result_checked(0, 64) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(0),
            Err(_) => 0,
        };
        if used == q.shares {
            q.stage = STAGE_IN_REF;
        } // refunded: still held by the launchpad, retried next call
        self.finish_step(idx, q);
    }

    #[private]
    pub fn on_mq_pool(&mut self, idx: u32, #[callback_result] pool: Result<RefPoolInfo, PromiseError>) -> PromiseOrValue<()> {
        let q = self.mq(idx);
        let (token_id, pool_id) = {
            let t = self.tok(idx);
            (t.token_id.clone(), t.pool_id.expect("ERR_NO_POOL"))
        };
        let linear = self.asset(idx);
        let reserves = pool.ok().and_then(|p| {
            let m = p.token_account_ids.iter().position(|t| *t == token_id)?;
            let l = p.token_account_ids.iter().position(|t| *t == linear)?;
            Some((p.amounts.get(l)?.0, p.amounts.get(m)?.0))
        });
        let guarded = reserves.and_then(|(r_lin, r_meme)| {
            let (reference, spot) = self.observe_pool_price(idx, r_lin, r_meme)?;
            within_band(spot, reference).then_some((r_lin, r_meme))
        });
        let Some((r_lin, r_meme)) = guarded else {
            if now_secs() > q.since + REFUND_AFTER_SECS {
                // Give up on the swap: withdraw the LiNEAR and refund it pro rata.
                env::log_str("migration queue: price stayed outside the band, refunding in LiNEAR");
                let shares = q.shares;
                return ext_ref::ext(self.config.ref_exchange.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(tgas(40))
                    .withdraw(linear, U128(shares), None, Some(true))
                    .then(Self::ext(env::current_account_id()).with_static_gas(tgas(60)).on_mq_refunded(idx))
                    .into();
            }
            env::log_str("migration queue deferred: pool price outside the reference band");
            self.finish_step(idx, q);
            return PromiseOrValue::Value(());
        };
        let quoted = cp_out(q.shares, r_lin, r_meme, self.pool_fee_bps());
        let min_out = math::mul_div(quoted, math::BPS - SWAP_SLIPPAGE_BPS, math::BPS);
        let action = near_sdk::serde_json::json!({
            "pool_id": pool_id,
            "token_in": linear,
            "amount_in": U128(q.shares),
            "token_out": token_id,
            "min_amount_out": U128(min_out),
        });
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(30))
            .swap(vec![action], None)
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(15)).on_mq_swapped(idx))
            .into()
    }

    #[private]
    pub fn on_mq_swapped(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) {
        let mut q = self.mq(idx);
        if let Ok(out) = r {
            q.out = out.0;
            q.stage = STAGE_SWAPPED;
        } // failed (moved past the minimum): LiNEAR stays in Ref, retried next call
        self.finish_step(idx, q);
    }

    /// Tokens arrived: split pro rata by NEAR and queue them for delivery.
    #[private]
    pub fn on_mq_withdrawn(&mut self, idx: u32) {
        let q = self.mq(idx);
        // Ref's `withdraw` returns the amount sent (0 if the transfer bounced back into Ref)
        if withdrawn_amount() == 0 {
            self.finish_step(idx, q); // retry the withdrawal
            return;
        }
        self.distribute_bought(idx, q);
    }

    /// Price never came back into the band: refund the queue in LiNEAR (claimable).
    #[private]
    pub fn on_mq_refunded(&mut self, idx: u32) {
        let mut q = self.mq(idx);
        if withdrawn_amount() == 0 {
            self.finish_step(idx, q);
            return;
        }
        let shares = q.shares;
        let mut given = 0u128;
        let n = q.entries.len();
        let total = q.total;
        for (i, (who, near, _)) in q.entries.drain(..).enumerate() {
            let share = if i + 1 == n { shares - given } else { math::mul_div(shares, near, total) };
            given += share;
            self.credit_stake(idx, &who, share);
        }
        self.log_mech(idx, "migration_refund", shares, None);
        q.total = 0;
        q.shares = 0;
        q.stage = STAGE_QUEUED;
        q.since = 0;
        self.finish_step(idx, q);
    }

    /// Permissionless: send queued buyers their tokens (up to `max`, default 8, per call). Attach 300 Tgas.
    pub fn deliver_migration_buys(&mut self, token_id: AccountId, max: Option<u32>) -> u32 {
        let idx = self.idx_of(&token_id);
        let mut q = self.mq(idx);
        let n = (max.unwrap_or(DELIVER_BATCH).clamp(1, DELIVER_BATCH) as usize).min(q.deliveries.len());
        let batch: Vec<_> = q.deliveries.drain(..n).collect();
        self.set_mq(idx, &q);
        let me = env::current_account_id();
        for (who, amount, storage) in batch.iter().cloned() {
            {
                let tok = self.tok_mut(idx);
                tok.owed_tokens -= amount;
                tok.tokens_in_flight += amount;
            }
            let send = ext_ft::ext(token_id.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(10))
                .ft_transfer(who.clone(), U128(amount), Some("floorpad migration buy".into()));
            let send = if storage {
                ext_ft::ext(token_id.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(STORAGE_FEE))
                    .with_static_gas(tgas(10))
                    .storage_deposit(Some(who.clone()), Some(true))
                    .then(send)
            } else {
                send
            };
            send.then(Self::ext(me.clone()).with_static_gas(tgas(5)).on_tokens_delivered(idx, who, U128(amount)))
                .detach();
        }
        batch.len() as u32
    }
}
