//! In-place state migration from v1 launchpad state (`OldContract` / `OldTokenState`)
//! to the current `Contract` / `TokenState` layout.
//!
//! Reads the raw `STATE` and `StorageKey::Tokens` entries, verifies they are not
//! already migrated, reconstructs `lp_k0` & `last_harvest_at` for already-graduated
//! tokens, and leaves every other LookupMap prefix untouched in place.
use crate::*;
use near_sdk::borsh;

#[near(serializers = [borsh])]
pub(crate) struct OldTokenState {
    pub token_id: AccountId,
    creator: AccountId,
    meta: TokenMeta,
    created_at: u64,
    deployed: bool,
    dao_id: AccountId,
    dao_stage: DaoStage,
    dao_attempt: u8,
    v_near: u128,
    v_tokens: u128,
    sold: u128,
    real_near: u128,
    burned: u128,
    holders: u32,
    volume_near: u128,
    trade_count: u32,
    backing_near: u128,
    linear_shares: u128,
    principal_near: u128,
    creator_escrow: u128,
    creator_released: u128,
    creator_claimable: u128,
    grad_mcap_usd: u64,
    launch_near_usd: u128,
    pub grad_stage: GradStage,
    grad_busy: bool,
    pool_id: Option<u64>,
    lp_near: u128,
    lp_shares: u128,
    lp_tokens: u128,
    lp_meme_deposited: bool,
    lp_linear_deposited: bool,
    graduated_at: u64,
    total_locked: u128,
    total_weight: u128,
    alloc_tally: [u128; BUCKETS],
    acc_reward_per_weight: u128,
    stakers: u32,
    epoch_index: u32,
    last_epoch_at: u64,
    epoch_busy: bool,
    last_linear_price: u128,
    tokens_in_flight: u128,
    owed_tokens: u128,
    agent_account: AccountId,
    agent_persona: String,
    agent_budget_shares: u128,
    post_count: u32,
}

#[near(serializers = [borsh])]
pub(crate) struct OldContract {
    pub config: Config,
    pub tokens: Vector<OldTokenState>,
    pub token_index: LookupMap<AccountId, u32>,
    pub positions: LookupMap<(u32, AccountId), Position>,
    pub claimable_linear: LookupMap<AccountId, u128>,
    pub pending_tokens: LookupMap<(u32, AccountId), u128>,
    pub snipe_bought: LookupMap<(u32, AccountId), u128>,
    pub known_holders: LookupMap<(u32, AccountId), bool>,
    pub trades: LookupMap<(u32, u32), Trade>,
    pub posts: LookupMap<(u32, u32), Post>,
    pub epochs: LookupMap<(u32, u32), EpochReport>,
    pub platform_fees: u128,
    pub ref_registered: bool,
    pub near_usd_micro: u128,
    pub price_updated_at: u64,
    pub referral_balance: LookupMap<AccountId, u128>,
}

#[near]
impl Contract {
    /// Upgrades an existing v1 launchpad deployment in place while preserving all
    /// tokens, balances, positions, epochs, and trade history.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let raw = env::storage_read(b"STATE").expect("ERR_NO_STATE");
        if borsh::from_slice::<Contract>(&raw).is_ok() {
            env::panic_str("ERR_ALREADY_MIGRATED");
        }
        let old: OldContract = borsh::from_slice(&raw).expect("ERR_BAD_OLD_STATE");
        let count = old.tokens.len();

        let mut migrated = Vec::with_capacity(count as usize);
        for i in 0..count {
            let mut key = Vec::with_capacity(5);
            key.push(0u8); // StorageKey::Tokens prefix byte
            key.extend_from_slice(&i.to_le_bytes());
            let raw_tok = env::storage_read(&key).expect("ERR_MISSING_TOKEN_STATE");
            let ot: OldTokenState = borsh::from_slice(&raw_tok).expect("ERR_BAD_OLD_TOKEN");
            let lp_k0 = if ot.grad_stage == GradStage::Graduated {
                math::lp_depth(ot.lp_shares, ot.lp_tokens, ot.last_linear_price)
            } else {
                0
            };
            migrated.push(TokenState {
                token_id: ot.token_id,
                creator: ot.creator,
                meta: ot.meta,
                created_at: ot.created_at,
                deployed: ot.deployed,
                dao_id: ot.dao_id,
                dao_stage: ot.dao_stage,
                dao_attempt: ot.dao_attempt,
                v_near: ot.v_near,
                v_tokens: ot.v_tokens,
                sold: ot.sold,
                real_near: ot.real_near,
                burned: ot.burned,
                holders: ot.holders,
                volume_near: ot.volume_near,
                trade_count: ot.trade_count,
                backing_near: ot.backing_near,
                linear_shares: ot.linear_shares,
                principal_near: ot.principal_near,
                creator_escrow: ot.creator_escrow,
                creator_released: ot.creator_released,
                creator_claimable: ot.creator_claimable,
                grad_mcap_usd: ot.grad_mcap_usd,
                launch_near_usd: ot.launch_near_usd,
                grad_stage: ot.grad_stage,
                grad_busy: ot.grad_busy,
                pool_id: ot.pool_id,
                lp_near: ot.lp_near,
                lp_shares: ot.lp_shares,
                lp_tokens: ot.lp_tokens,
                lp_meme_deposited: ot.lp_meme_deposited,
                lp_linear_deposited: ot.lp_linear_deposited,
                graduated_at: ot.graduated_at,
                total_locked: ot.total_locked,
                total_weight: ot.total_weight,
                alloc_tally: ot.alloc_tally,
                acc_reward_per_weight: ot.acc_reward_per_weight,
                stakers: ot.stakers,
                epoch_index: ot.epoch_index,
                last_epoch_at: ot.last_epoch_at,
                epoch_busy: ot.epoch_busy,
                last_linear_price: ot.last_linear_price,
                tokens_in_flight: ot.tokens_in_flight,
                owed_tokens: ot.owed_tokens,
                custody_total: 0,
                mech_count: 0,
                lp_k0,
                last_harvest_at: ot.graduated_at,
                harvest_busy: false,
                harvest_meme_pending: 0,
                harvest_linear_pending: 0,
                harvested_linear: 0,
                harvest_burned: 0,
                agent_account: ot.agent_account,
                agent_persona: ot.agent_persona,
                agent_budget_shares: ot.agent_budget_shares,
                post_count: ot.post_count,
            });
        }

        let config = old.config.clone();
        let platform_fees = old.platform_fees;
        let ref_registered = old.ref_registered;
        let near_usd_micro = old.near_usd_micro;
        let price_updated_at = old.price_updated_at;
        drop(old);

        let mut tokens = Vector::new(StorageKey::Tokens);
        for t in migrated {
            tokens.push(t);
        }

        Self {
            config,
            tokens,
            token_index: LookupMap::new(StorageKey::TokenIndex),
            positions: LookupMap::new(StorageKey::Positions),
            claimable_linear: LookupMap::new(StorageKey::Claimable),
            pending_tokens: LookupMap::new(StorageKey::PendingTokens),
            snipe_bought: LookupMap::new(StorageKey::SnipeBought),
            known_holders: LookupMap::new(StorageKey::KnownHolders),
            trades: LookupMap::new(StorageKey::Trades),
            posts: LookupMap::new(StorageKey::Posts),
            epochs: LookupMap::new(StorageKey::Epochs),
            platform_fees,
            ref_registered,
            near_usd_micro,
            price_updated_at,
            referral_balance: LookupMap::new(StorageKey::Referrals),
            trading_near: LookupMap::new(StorageKey::TradingNear),
            custody: LookupMap::new(StorageKey::Custody),
            mech_log: LookupMap::new(StorageKey::Mech),
        }
    }
}
