//! Floorpad launchpad.
//!
//! One contract runs every launch end to end:
//! * **Curve** – fair-launch bonding curve with anti-sniping caps (curve.rs)
//! * **Vault** – fees and exit fees back a rising, always-redeemable floor (vault.rs)
//! * **ve-locks** – time-weighted voting power and yield share (ve.rs)
//! * **DAO** – each token gets a Sputnik DAO; this contract is its staking
//!   contract, so ve-weight *is* Sputnik vote weight (dao.rs)
//! * **Graduation** – liquidity moves to a Ref `MEME/LiNEAR` pool so locked LP
//!   earns staking yield; the vault is staked into LiNEAR (graduation.rs)
//! * **Epochs** – staking yield is split by holder vote across floor, buyback,
//!   airdrop, AI agent and DAO treasury (epoch.rs)
//! * **Agent** – a per-token AI agent paid per post from its voted budget (agent.rs)

mod agent;
mod curve;
mod dao;
mod epoch;
mod ext;
pub mod math;
mod graduation;
mod harvest;
mod trading;
mod ve;
mod vault;
mod views;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use crate::math::bps;
use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    PromiseOrValue,
};

pub use trading::Custody;
pub use views::*;

pub const BUCKETS: usize = 5;
pub const BUCKET_FLOOR: usize = 0;
pub const BUCKET_BUYBACK: usize = 1;
pub const BUCKET_AIRDROP: usize = 2;
pub const BUCKET_AGENT: usize = 3;
pub const BUCKET_TREASURY: usize = 4;

/// Ring buffer sizes (bounded storage per token).
pub const MAX_TRADES: u32 = 200;
pub const MAX_POSTS: u32 = 100;
pub const MAX_EPOCHS: u32 = 52;
pub const MAX_MECH: u32 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Tokens,
    TokenIndex,
    Positions,
    Claimable,
    SnipeBought,
    KnownHolders,
    Trades,
    Posts,
    Epochs,
    PendingTokens,
    Referrals,
    TradingNear,
    Custody,
    Mech,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    /// Where platform fees go (e.g. a Sputnik DAO / Trezu treasury). Not an admin:
    /// this account has no powers over the contract; it can only receive fees.
    pub treasury_id: AccountId,
    /// Global contract code hashes (immutable: nobody can swap code under live tokens/DAOs).
    /// `dao_code_hash` is the official Sputnik DAO v2 global code.
    pub token_code_hash: Base58CryptoHash,
    pub dao_code_hash: Base58CryptoHash,
    pub ref_exchange: AccountId,
    pub linear: AccountId,
    pub default_agent: AccountId,

    pub creation_fee: NearToken,
    pub dao_deposit: NearToken,
    pub token_account_deposit: NearToken,
    pub graduation_reserve: NearToken,
    pub min_trade: NearToken,

    pub total_supply: U128,
    pub curve_supply: U128,
    pub lp_supply: U128,
    pub virtual_tokens: U128,
    /// Fully-diluted market cap (USD) at which a token graduates to Ref.
    /// Each launch sizes its curve from the NEAR/USD price at launch time.
    pub grad_mcap_usd: u64,
    /// On-chain NEAR/USD source: a Ref pool quote, read at every launch. `None` = feeder mode (testnet).
    pub price_pool: Option<PricePool>,
    /// The accepted price may move at most this much per hour of elapsed time (manipulation guard).
    pub max_price_move_bps_per_hour: u16,
    /// Feeder mode only: max age of the pushed price, and who may push it (owner always can).
    pub max_price_age_secs: u64,
    pub price_feeder: AccountId,
    /// Share of the platform fee paid to a trade's referrer.
    pub referral_bps: u16,

    pub buy_fee_bps: u16,
    pub sell_fee_bps: u16,
    /// Split of every curve fee: vault and creator; the rest is platform.
    pub fee_vault_bps: u16,
    pub fee_creator_bps: u16,
    /// Share of creator fees claimable at once; the rest is DAO-escrowed.
    pub creator_instant_bps: u16,
    /// Graduation: share of the raise to the floor vault and to the platform.
    pub grad_vault_bps: u16,
    pub grad_platform_bps: u16,
    /// Platform share of each epoch's staking yield.
    pub yield_platform_bps: u16,
    pub max_exit_fee_bps: u16,
    pub exit_decay_secs: u64,
    pub redeem_fee_bps: u16,

    pub snipe_window_secs: u64,
    pub snipe_max_tokens: U128,

    pub lock_min_days: u64,
    pub lock_max_days: u64,
    pub epoch_secs: u64,
    pub dao_proposal_period_secs: u64,
    pub dao_proposal_bond: NearToken,
    pub dao_quorum: U128,
    pub ref_pool_fee: u32,
    pub agent_post_cost: NearToken,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PricePool {
    pub pool_id: u64,
    /// wNEAR account (wrap.near)
    pub near_token: AccountId,
    /// USD stablecoin account and its decimals (native USDC: 6)
    pub usd_token: AccountId,
    pub usd_decimals: u8,
    /// Pool fee in bps; the quote is grossed up by it
    pub pool_fee_bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TokenMeta {
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub description: String,
    pub website: Option<String>,
    pub twitter: Option<String>,
    pub telegram: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DaoStage {
    Creating,
    Created,
    Finalizing,
    Ready,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GradStage {
    /// Trading on the bonding curve.
    Curve,
    /// Curve sold out: register tokens and create the Ref pool.
    CreatePool,
    /// Stake raised NEAR into LiNEAR.
    Stake,
    /// Deposit MEME + LiNEAR into Ref.
    Deposit,
    /// Add liquidity (LP is owned by this contract forever).
    AddLiquidity,
    Graduated,
}

#[near]
#[derive(Clone)]
pub struct TokenState {
    pub token_id: AccountId,
    pub creator: AccountId,
    pub meta: TokenMeta,
    pub created_at: u64,
    pub deployed: bool,

    pub dao_id: AccountId,
    pub dao_stage: DaoStage,
    pub dao_attempt: u8,

    // Curve
    pub v_near: u128,
    pub v_tokens: u128,
    pub sold: u128,
    pub real_near: u128,
    pub burned: u128,
    pub holders: u32,
    pub volume_near: u128,
    pub trade_count: u32,

    // Vault (floor)
    pub backing_near: u128,
    pub linear_shares: u128,
    pub principal_near: u128,
    pub creator_escrow: u128,
    pub creator_released: u128,
    /// Creator fees claimable now (no vote needed).
    pub creator_claimable: u128,
    /// Graduation target and the NEAR/USD price (micro-USD) the curve was sized at.
    pub grad_mcap_usd: u64,
    pub launch_near_usd: u128,

    // Graduation
    pub grad_stage: GradStage,
    pub grad_busy: bool,
    pub pool_id: Option<u64>,
    pub lp_near: u128,
    pub lp_shares: u128,
    /// Meme tokens paired into the LP (the unused rest of lp_supply is burned).
    pub lp_tokens: u128,
    pub lp_meme_deposited: bool,
    pub lp_linear_deposited: bool,
    pub graduated_at: u64,

    // ve-locks
    pub total_locked: u128,
    pub total_weight: u128,
    pub alloc_tally: [u128; BUCKETS],
    pub acc_reward_per_weight: u128,
    pub stakers: u32,

    // Epochs
    pub epoch_index: u32,
    pub last_epoch_at: u64,
    pub epoch_busy: bool,
    pub last_linear_price: u128,
    /// Meme tokens held here but already committed (outgoing transfers, pending burns).
    pub tokens_in_flight: u128,
    /// Meme tokens held here that are owed to users (failed deliveries).
    pub owed_tokens: u128,
    /// Meme tokens held here for instant-trading accounts.
    pub custody_total: u128,
    /// Mechanics log ring buffer length (burns, epochs, yield funding, escrow moves).
    pub mech_count: u32,

    // LP harvest (harvest.rs)
    /// Locked LP depth baseline: sqrt(LiNEAR-side NEAR value x meme side) of the
    /// launchpad's position. Only growth above it is harvested.
    pub lp_k0: u128,
    pub last_harvest_at: u64,
    pub harvest_busy: bool,
    /// Removed from the pool but still in the launchpad's Ref deposit (retryable).
    pub harvest_meme_pending: u128,
    pub harvest_linear_pending: u128,
    /// Lifetime totals.
    pub harvested_linear: u128,
    pub harvest_burned: u128,

    // Agent
    pub agent_account: AccountId,
    pub agent_persona: String,
    pub agent_budget_shares: u128,
    pub post_count: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Position {
    pub amount: U128,
    pub unlock_at: u64,
    pub weight: U128,
    /// Yield allocation preference in bps across the 5 buckets.
    pub alloc: Option<[u16; BUCKETS]>,
    pub reward_debt: U128,
    pub pending_reward: U128,
    pub delegated: U128,
    pub dao_registered: bool,
    pub sync_busy: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Trade {
    pub ts: u64,
    pub account: AccountId,
    pub is_buy: bool,
    pub near: U128,
    pub tokens: U128,
    pub v_near: U128,
    pub v_tokens: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Post {
    pub ts: u64,
    pub text: String,
    pub paid: U128,
}

/// One entry of a token's public mechanics log.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct MechEvent {
    pub ts: u64,
    /// graduation_burn | redeem_burn | buyback_burn | epoch | yield_funded | creator_release | creator_clawback
    pub kind: String,
    pub amount: U128,
    pub account: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct EpochReport {
    pub index: u32,
    pub ts: u64,
    pub price: U128,
    pub yield_shares: U128,
    /// Shares per bucket: floor, buyback, airdrop, agent, treasury.
    pub split: [U128; BUCKETS],
    pub tally: [U128; BUCKETS],
}

#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    Sell { min_near_out: Option<U128>, referrer: Option<AccountId> },
    Redeem { min_out: Option<U128> },
    Lock { days: u64 },
}

#[near(serializers = [json])]
pub struct FundYieldMsg {
    pub fund_yield: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub config: Config,
    pub tokens: Vector<TokenState>,
    pub token_index: LookupMap<AccountId, u32>,
    pub positions: LookupMap<(u32, AccountId), Position>,
    /// LiNEAR owed to accounts (redemptions, airdrops, agent pay).
    pub claimable_linear: LookupMap<AccountId, u128>,
    /// Meme tokens owed to accounts whose delivery failed.
    pub pending_tokens: LookupMap<(u32, AccountId), u128>,
    pub snipe_bought: LookupMap<(u32, AccountId), u128>,
    pub known_holders: LookupMap<(u32, AccountId), bool>,
    pub trades: LookupMap<(u32, u32), Trade>,
    pub posts: LookupMap<(u32, u32), Post>,
    pub epochs: LookupMap<(u32, u32), EpochReport>,
    pub platform_fees: u128,
    pub ref_registered: bool,
    /// NEAR/USD in micro-USD (1_590_000 = $1.59) and when it was set.
    pub near_usd_micro: u128,
    pub price_updated_at: u64,
    /// NEAR fees owed to referrers.
    pub referral_balance: LookupMap<AccountId, u128>,
    /// Instant-trading accounts: NEAR balance and per-token custody.
    pub trading_near: LookupMap<AccountId, u128>,
    pub custody: LookupMap<(u32, AccountId), Custody>,
    pub mech_log: LookupMap<(u32, u32), MechEvent>,
}

pub(crate) fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl Contract {
    #[init]
    pub fn new(config: Config) -> Self {
        require!(
            config.virtual_tokens.0 > config.curve_supply.0,
            "ERR_VIRTUAL_TOKENS_TOO_LOW"
        );
        require!(
            config.curve_supply.0 + config.lp_supply.0 == config.total_supply.0,
            "ERR_SUPPLY_SPLIT"
        );
        require!(
            config.fee_vault_bps as u128 + config.fee_creator_bps as u128 <= math::BPS,
            "ERR_FEE_SPLIT"
        );
        require!(
            config.grad_vault_bps as u128 + config.grad_platform_bps as u128 <= 5_000,
            "ERR_GRAD_SPLIT"
        );
        Self {
            config,
            tokens: Vector::new(StorageKey::Tokens),
            token_index: LookupMap::new(StorageKey::TokenIndex),
            positions: LookupMap::new(StorageKey::Positions),
            claimable_linear: LookupMap::new(StorageKey::Claimable),
            pending_tokens: LookupMap::new(StorageKey::PendingTokens),
            snipe_bought: LookupMap::new(StorageKey::SnipeBought),
            known_holders: LookupMap::new(StorageKey::KnownHolders),
            trades: LookupMap::new(StorageKey::Trades),
            posts: LookupMap::new(StorageKey::Posts),
            epochs: LookupMap::new(StorageKey::Epochs),
            platform_fees: 0,
            ref_registered: false,
            near_usd_micro: 0,
            price_updated_at: 0,
            referral_balance: LookupMap::new(StorageKey::Referrals),
            trading_near: LookupMap::new(StorageKey::TradingNear),
            custody: LookupMap::new(StorageKey::Custody),
            mech_log: LookupMap::new(StorageKey::Mech),
        }
    }

    // ---------- no admin ----------
    // There is no owner. The contract has no method that moves user funds, vault
    // principal, LP, custody, escrow or DAO money to anyone but their rightful owner.
    // The only outflow to the platform is accrued platform fees, and they can only
    // ever go to `treasury_id`. Combined with deleting the launchpad account's
    // full-access keys after deploy, nobody (including the deployer) can withdraw.

    /// Permissionless: send all accrued platform fees (NEAR) to the treasury.
    pub fn sweep_platform_fees(&mut self) -> near_sdk::Promise {
        let amount = self.platform_fees;
        require!(amount > 0, "ERR_NOTHING_TO_SWEEP");
        self.platform_fees = 0;
        near_sdk::Promise::new(self.config.treasury_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
    }

    /// Push the NEAR/USD price (micro-USD), feeder mode only (testnet). With a Ref price
    /// pool configured (mainnet) nobody can set the price. Moves are capped at 2x.
    pub fn set_near_usd_price(&mut self, price_micro_usd: U128) {
        require!(self.config.price_pool.is_none(), "ERR_PRICE_IS_ONCHAIN");
        require!(env::predecessor_account_id() == self.config.price_feeder, "ERR_NOT_FEEDER");
        let p = price_micro_usd.0;
        require!(p > 0, "ERR_PRICE");
        if self.near_usd_micro > 0 {
            let old = self.near_usd_micro;
            require!(p * 2 >= old && p <= old * 2, "ERR_PRICE_JUMP");
        }
        self.near_usd_micro = p;
        self.price_updated_at = now_secs();
    }

    /// (NEAR/USD in micro-USD, updated_at secs)
    pub fn get_near_usd_price(&self) -> (U128, u64) {
        (U128(self.near_usd_micro), self.price_updated_at)
    }

    // ---------- internal helpers ----------

    /// Virtual NEAR reserve that makes the curve graduate at `grad_mcap_usd`
    /// at the accepted NEAR/USD price.
    pub(crate) fn launch_virtual_near(&self) -> u128 {
        let c = &self.config;
        require!(self.near_usd_micro > 0, "ERR_NO_PRICE");
        if c.price_pool.is_none() {
            require!(
                now_secs() <= self.price_updated_at + c.max_price_age_secs,
                "ERR_PRICE_STALE"
            );
        }
        math::virtual_near_for_mcap(
            c.grad_mcap_usd,
            self.near_usd_micro,
            c.virtual_tokens.0,
            c.curve_supply.0,
            c.total_supply.0,
        )
    }

    /// Split a curve fee into vault, creator (instant + escrow), referrer and platform.
    pub(crate) fn distribute_fee(&mut self, idx: u32, fee: u128, referrer: Option<&AccountId>) {
        let c = self.config.clone();
        let vault = bps(fee, c.fee_vault_bps as u128);
        let creator = bps(fee, c.fee_creator_bps as u128);
        let instant = bps(creator, c.creator_instant_bps as u128);
        let mut platform = fee - vault - creator;
        {
            let tok = self.tok_mut(idx);
            tok.backing_near += vault;
            tok.creator_claimable += instant;
            tok.creator_escrow += creator - instant;
        }
        if let Some(r) = referrer {
            let cut = bps(platform, c.referral_bps as u128);
            platform -= cut;
            let cur = self.referral_balance.get(r).copied().unwrap_or(0);
            self.referral_balance.insert(r.clone(), cur + cut);
        }
        self.platform_fees += platform;
    }

    /// Accept a NEAR/USD observation, clamped to `max_price_move_bps_per_hour` x hours
    /// since the last accepted price (at most +/-90%). Returns the accepted price.
    pub(crate) fn accept_price(&mut self, observed_micro: u128) -> u128 {
        let now = now_secs();
        let old = self.near_usd_micro;
        let p = if old == 0 {
            observed_micro
        } else {
            let elapsed = now.saturating_sub(self.price_updated_at) as u128;
            let allowed = (self.config.max_price_move_bps_per_hour as u128 * elapsed / 3600).clamp(1, 9_000);
            let lo = old * (math::BPS - allowed) / math::BPS;
            let hi = old * (math::BPS + allowed) / math::BPS;
            observed_micro.clamp(lo, hi)
        };
        self.near_usd_micro = p;
        self.price_updated_at = now;
        p
    }

    pub(crate) fn idx_of(&self, token_id: &AccountId) -> u32 {
        *self.token_index.get(token_id).expect("ERR_UNKNOWN_TOKEN")
    }

    pub(crate) fn tok(&self, idx: u32) -> &TokenState {
        self.tokens.get(idx).expect("ERR_UNKNOWN_TOKEN")
    }

    pub(crate) fn tok_mut(&mut self, idx: u32) -> &mut TokenState {
        self.tokens.get_mut(idx).expect("ERR_UNKNOWN_TOKEN")
    }

    pub(crate) fn credit_linear(&mut self, account: &AccountId, shares: u128) {
        if shares == 0 {
            return;
        }
        let cur = self.claimable_linear.get(account).copied().unwrap_or(0);
        self.claimable_linear.insert(account.clone(), cur + shares);
    }

    pub(crate) fn record_trade(&mut self, idx: u32, t: Trade) {
        let tok = self.tok_mut(idx);
        let index = tok.trade_count;
        let slot = index % MAX_TRADES;
        tok.trade_count += 1;
        let token_id = tok.token_id.clone();
        // NEP-297 event so any indexer can follow trades without polling views.
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "floorpad", "version": "1.0.0", "event": "trade",
                "data": [{ "token_id": token_id, "index": index, "account": t.account, "is_buy": t.is_buy,
                           "near": t.near, "tokens": t.tokens, "v_near": t.v_near, "v_tokens": t.v_tokens, "ts": t.ts }]
            })
        ));
        self.trades.insert((idx, slot), t);
    }

    /// Append to the token's public mechanics log.
    pub(crate) fn log_mech(&mut self, idx: u32, kind: &str, amount: u128, account: Option<AccountId>) {
        let tok = self.tok_mut(idx);
        let slot = tok.mech_count % MAX_MECH;
        tok.mech_count += 1;
        let token_id = tok.token_id.clone();
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({ "standard": "floorpad", "version": "1.0.0", "event": kind,
                                "data": [{ "token_id": token_id, "amount": U128(amount), "account": account }] })
        ));
        self.mech_log.insert((idx, slot), MechEvent { ts: now_secs(), kind: kind.into(), amount: U128(amount), account });
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Entry point for sells, floor redemptions and locks.
    /// Only Floorpad meme tokens are accepted.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        require!(amount.0 > 0, "ERR_ZERO");
        // LiNEAR sent with {"fund_yield":"<meme token>"} tops up that token's yield pool:
        // it is split by the next epoch's holder vote like staking yield (never principal).
        if token_id == self.config.linear {
            let f: FundYieldMsg = serde_json::from_str(&msg).expect("ERR_BAD_MSG");
            let idx = self.idx_of(&f.fund_yield);
            let tok = self.tok_mut(idx);
            require!(tok.grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
            tok.linear_shares += amount.0;
            self.log_mech(idx, "yield_funded", amount.0, Some(sender_id));
            return PromiseOrValue::Value(U128(0));
        }
        let idx = self.idx_of(&token_id);
        let parsed: TransferMsg = serde_json::from_str(&msg).expect("ERR_BAD_MSG");
        match parsed {
            TransferMsg::Sell { min_near_out, referrer } => self.start_sell(
                idx,
                sender_id,
                amount.0,
                min_near_out.map(|v| v.0).unwrap_or(0),
                referrer,
            ),
            TransferMsg::Redeem { min_out } => {
                self.start_redeem(idx, sender_id, amount.0, min_out.map(|v| v.0).unwrap_or(0))
            }
            TransferMsg::Lock { days } => {
                self.internal_lock(idx, sender_id, amount.0, days);
                PromiseOrValue::Value(U128(0))
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests;
