//! ve-locks: lock tokens for 7–180 days to get 1x–4x weight.
//!
//! Weight is used for three things at once:
//! 1. Sputnik DAO vote weight (this contract is each DAO's staking contract and
//!    delegates weight via `register_delegation` / `delegate` / `undelegate`).
//! 2. The continuous yield-allocation vote (each locker's bucket preference).
//! 3. Pro-rata share of the airdrop bucket.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_dao, ext_ft, tgas};
use crate::math::{self, ACC_SCALE};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{Promise, PromiseError};

const DAY: u64 = 86_400;

#[near]
impl Contract {
    /// Extend an existing lock (re-weights the whole position).
    pub fn extend_lock(&mut self, token_id: AccountId, days: u64) {
        let idx = self.idx_of(&token_id);
        let account = env::predecessor_account_id();
        let p = self.positions.get(&(idx, account.clone())).expect("ERR_NO_LOCK");
        require!(p.amount.0 > 0, "ERR_NO_LOCK");
        self.internal_lock(idx, account, 0, days);
    }

    /// Withdraw an expired lock.
    pub fn unlock(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let account = env::predecessor_account_id();
        let key = (idx, account.clone());
        let mut p = self.positions.get(&key).cloned().expect("ERR_NO_LOCK");
        require!(p.amount.0 > 0, "ERR_NO_LOCK");
        require!(now_secs() >= p.unlock_at, "ERR_STILL_LOCKED");
        self.settle_rewards(idx, &mut p);
        self.apply_weight(idx, &mut p, 0);
        let amount = p.amount.0;
        p.amount = U128(0);
        self.positions.insert(key, p);
        {
            let tok = self.tok_mut(idx);
            tok.total_locked -= amount;
            tok.stakers = tok.stakers.saturating_sub(1);
            tok.tokens_in_flight += amount;
        }
        self.maybe_sync_delegation(idx, &account);
        ext_ft::ext(token_id)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(10))
            .ft_transfer(account.clone(), U128(amount), Some("floorpad unlock".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(10))
                    .on_tokens_delivered(idx, account, U128(amount)),
            )
    }

    /// Set how this locker wants each epoch's yield split, in bps (sum 10000):
    /// `[floor, buyback_burn, airdrop, ai_agent, dao_treasury]`.
    /// The preference persists across epochs until changed.
    pub fn set_allocation(&mut self, token_id: AccountId, alloc: [u16; BUCKETS]) {
        let idx = self.idx_of(&token_id);
        require!(
            alloc.iter().map(|v| *v as u32).sum::<u32>() == 10_000,
            "ERR_ALLOC_SUM"
        );
        let account = env::predecessor_account_id();
        let key = (idx, account);
        let mut p = self.positions.get(&key).cloned().unwrap_or_default();
        let w = p.weight.0;
        let tok = self.tok_mut(idx);
        if let Some(old) = p.alloc {
            for i in 0..BUCKETS {
                tok.alloc_tally[i] -= w * old[i] as u128;
            }
        }
        for i in 0..BUCKETS {
            tok.alloc_tally[i] += w * alloc[i] as u128;
        }
        p.alloc = Some(alloc);
        self.positions.insert(key, p);
    }

    /// Move accrued airdrop rewards into the caller's claimable LiNEAR.
    pub fn claim_rewards(&mut self, token_id: AccountId) -> U128 {
        let idx = self.idx_of(&token_id);
        let account = env::predecessor_account_id();
        let key = (idx, account.clone());
        let mut p = self.positions.get(&key).cloned().expect("ERR_NO_LOCK");
        self.settle_rewards(idx, &mut p);
        let amount = p.pending_reward.0;
        p.pending_reward = U128(0);
        self.positions.insert(key, p);
        self.credit_linear(&account, amount);
        U128(amount)
    }

    /// Permissionless: push an account's current weight to its token's DAO.
    pub fn sync_delegation(&mut self, token_id: AccountId, account_id: AccountId) {
        let idx = self.idx_of(&token_id);
        self.maybe_sync_delegation(idx, &account_id);
    }

    #[private]
    pub fn on_delegation_registered(
        &mut self,
        idx: u32,
        account: AccountId,
        #[callback_result] r: Result<(), PromiseError>,
    ) {
        let key = (idx, account.clone());
        if let Some(p) = self.positions.get_mut(&key) {
            p.sync_busy = false;
            if r.is_ok() {
                p.dao_registered = true;
            }
        }
        if r.is_ok() {
            self.maybe_sync_delegation(idx, &account);
        }
    }

    #[private]
    pub fn on_delegation_synced(
        &mut self,
        idx: u32,
        account: AccountId,
        target: U128,
        #[callback_result] r: Result<(U128, U128, U128), PromiseError>,
    ) {
        // No automatic re-sync here (bounded gas); if weight changed while this
        // was in flight, the next lock/unlock or `sync_delegation` catches up.
        if let Some(p) = self.positions.get_mut(&(idx, account)) {
            p.sync_busy = false;
            if r.is_ok() {
                p.delegated = target;
            }
        }
    }
}

impl Contract {
    pub(crate) fn internal_lock(&mut self, idx: u32, account: AccountId, amount: u128, days: u64) {
        let (min_d, max_d) = (self.config.lock_min_days, self.config.lock_max_days);
        require!((min_d..=max_d).contains(&days), "ERR_LOCK_DAYS");
        let now = now_secs();
        let key = (idx, account.clone());
        let mut p = self.positions.get(&key).cloned().unwrap_or_default();
        self.settle_rewards(idx, &mut p);
        let unlock_at = p.unlock_at.max(now + days * DAY);
        let new_amount = p.amount.0 + amount;
        let weight = math::lock_weight(new_amount, (unlock_at - now) / DAY, min_d, max_d);
        if p.amount.0 == 0 && amount > 0 {
            self.tok_mut(idx).stakers += 1;
        }
        self.apply_weight(idx, &mut p, weight);
        p.amount = U128(new_amount);
        p.unlock_at = unlock_at;
        self.positions.insert(key, p);
        self.tok_mut(idx).total_locked += amount;
        self.maybe_sync_delegation(idx, &account);
    }

    /// Accrue airdrop rewards for the position at the current accumulator.
    pub(crate) fn settle_rewards(&self, idx: u32, p: &mut Position) {
        let acc = self.tok(idx).acc_reward_per_weight;
        let accrued = math::mul_div(p.weight.0, acc, ACC_SCALE);
        p.pending_reward = U128(p.pending_reward.0 + accrued.saturating_sub(p.reward_debt.0));
        p.reward_debt = U128(accrued);
    }

    /// Change a position's weight, keeping totals, tallies and reward debt consistent.
    /// Call `settle_rewards` first.
    pub(crate) fn apply_weight(&mut self, idx: u32, p: &mut Position, new_weight: u128) {
        let old = p.weight.0;
        let tok = self.tok_mut(idx);
        if let Some(a) = p.alloc {
            for i in 0..BUCKETS {
                tok.alloc_tally[i] = tok.alloc_tally[i] - old * a[i] as u128 + new_weight * a[i] as u128;
            }
        }
        tok.total_weight = tok.total_weight - old + new_weight;
        let acc = tok.acc_reward_per_weight;
        p.weight = U128(new_weight);
        p.reward_debt = U128(math::mul_div(new_weight, acc, ACC_SCALE));
    }

    pub(crate) fn maybe_sync_delegation(&mut self, idx: u32, account: &AccountId) {
        let (dao_id, ready) = {
            let t = self.tok(idx);
            (t.dao_id.clone(), t.dao_stage == DaoStage::Ready)
        };
        if !ready {
            return;
        }
        let key = (idx, account.clone());
        let Some(p) = self.positions.get_mut(&key) else { return };
        if p.sync_busy {
            return;
        }
        let me = env::current_account_id();
        if !p.dao_registered {
            if p.weight.0 == 0 {
                return;
            }
            p.sync_busy = true;
            ext_dao::ext(dao_id)
                .with_attached_deposit(env::storage_byte_cost().saturating_mul(16))
                .with_static_gas(tgas(10))
                .register_delegation(account.clone())
                .then(
                    Self::ext(me)
                        .with_static_gas(tgas(50))
                        .on_delegation_registered(idx, account.clone()),
                ).detach();
            return;
        }
        let (target, cur) = (p.weight.0, p.delegated.0);
        if target == cur {
            return;
        }
        p.sync_busy = true;
        let call = if target > cur {
            ext_dao::ext(dao_id)
                .with_static_gas(tgas(10))
                .delegate(account.clone(), U128(target - cur))
        } else {
            ext_dao::ext(dao_id)
                .with_static_gas(tgas(10))
                .undelegate(account.clone(), U128(cur - target))
        };
        call.then(
            Self::ext(me)
                .with_static_gas(tgas(10))
                .on_delegation_synced(idx, account.clone(), U128(target)),
        ).detach();
    }
}
