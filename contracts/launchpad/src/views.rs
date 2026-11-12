//! Read-only views consumed by the UI and the agent/keeper service.
use crate::math::{self, bps};
use crate::*;
use near_sdk::json_types::U128;

#[near(serializers = [json])]
pub struct TokenView {
    pub index: u32,
    pub token_id: AccountId,
    pub creator: AccountId,
    pub meta: TokenMeta,
    pub created_at: u64,
    pub deployed: bool,
    pub dao_id: AccountId,
    pub dao_stage: DaoStage,
    pub v_near: U128,
    pub v_tokens: U128,
    pub sold: U128,
    pub curve_supply: U128,
    pub total_supply: U128,
    pub real_near: U128,
    pub burned: U128,
    pub holders: u32,
    pub volume_near: U128,
    pub trade_count: u32,
    pub backing_near: U128,
    pub linear_shares: U128,
    pub principal_near: U128,
    pub creator_escrow: U128,
    pub creator_released: U128,
    pub creator_claimable: U128,
    pub grad_mcap_usd: u64,
    pub launch_near_usd: U128,
    /// Fully-diluted market cap now (curve spot price x live supply), yoctoNEAR.
    pub fdv_near: U128,
    /// FDV at which the curve graduates, yoctoNEAR.
    pub grad_fdv_near: U128,
    pub grad_stage: GradStage,
    pub grad_busy: bool,
    pub pool_id: Option<u64>,
    pub lp_near: U128,
    pub lp_shares: U128,
    pub lp_tokens: U128,
    pub graduated_at: u64,
    pub total_locked: U128,
    pub total_weight: U128,
    pub alloc_tally: [U128; BUCKETS],
    pub stakers: u32,
    pub epoch_index: u32,
    pub last_epoch_at: u64,
    pub next_epoch_at: u64,
    pub epoch_busy: bool,
    pub last_linear_price: U128,
    pub agent_account: AccountId,
    pub agent_persona: String,
    pub agent_budget_shares: U128,
    pub post_count: u32,
    pub snipe_window_ends: u64,
    pub custody_total: U128,
    pub mech_count: u32,
    pub platform_fee_bps: u16,
    pub buy_tax_bps: u16,
    pub sell_tax_bps: u16,
    pub max_exit_fee_bps: u16,
    pub exit_decay_secs: u64,
    pub tax_vault_bps: u16,
    pub tax_creator_bps: u16,
    pub tax_burn_bps: u16,
    pub lp_k0: U128,
    pub last_harvest_at: u64,
    pub next_harvest_at: u64,
    pub harvest_busy: bool,
    pub harvest_pending: bool,
    pub harvested_linear: U128,
    pub harvest_burned: U128,
}

#[near(serializers = [json])]
pub struct Quote {
    pub amount_out: U128,
    pub fee: U128,
    pub exit_fee: U128,
    pub refund: U128,
}

#[near]
impl Contract {
    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_token_count(&self) -> u32 {
        self.tokens.len()
    }

    /// Newest first.
    pub fn get_tokens(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<TokenView> {
        let len = self.tokens.len();
        let skip = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (0..len)
            .rev()
            .skip(skip as usize)
            .take(limit as usize)
            .map(|i| self.view(i))
            .collect()
    }

    pub fn get_token(&self, token_id: AccountId) -> Option<TokenView> {
        self.token_index.get(&token_id).map(|i| self.view(*i))
    }

    pub fn get_position(&self, token_id: AccountId, account_id: AccountId) -> Option<Position> {
        let idx = *self.token_index.get(&token_id)?;
        let mut p = self.positions.get(&(idx, account_id))?.clone();
        self.settle_rewards(idx, &mut p);
        Some(p)
    }

    pub fn get_claimable_linear(&self, account_id: AccountId) -> U128 {
        U128(self.claimable_linear.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_pending_tokens(&self, token_id: AccountId, account_id: AccountId) -> U128 {
        let idx = self.idx_of(&token_id);
        U128(self.pending_tokens.get(&(idx, account_id)).copied().unwrap_or(0))
    }

    pub fn get_referral_balance(&self, account_id: AccountId) -> U128 {
        U128(self.referral_balance.get(&account_id).copied().unwrap_or(0))
    }

    /// Plain-language statement of who can move funds, for auditors and the UI.
    pub fn get_admin_powers(&self) -> Vec<String> {
        vec![
            "owner: none (no admin methods; config is immutable after init)".into(),
            format!("platform fees: accrue in-contract; anyone can sweep them, only to treasury {}", self.config.treasury_id),
            format!("platform yield cut: claimable LiNEAR credited to treasury {}", self.config.treasury_id),
            format!("price: {}", if self.config.price_pool.is_some() { "read on-chain from Ref; nobody can set it" } else { "feeder mode (testnet), capped at 2x per update" }),
            "upgrades: only possible if the launchpad account still has a full-access key (deploy script deletes it)".into(),
        ]
    }

    pub fn get_platform_fees(&self) -> U128 {
        U128(self.platform_fees)
    }

    /// Most recent trades, newest first.
    pub fn get_trades(&self, token_id: AccountId, limit: Option<u32>) -> Vec<Trade> {
        let idx = self.idx_of(&token_id);
        let n = self.tok(idx).trade_count;
        ring(n, MAX_TRADES, limit.unwrap_or(MAX_TRADES))
            .filter_map(|s| self.trades.get(&(idx, s)).cloned())
            .collect()
    }

    /// Trades with their global index, oldest first, starting at `from_index`
    /// (only the last MAX_TRADES are retained on-chain). For indexers.
    pub fn get_trades_from(&self, token_id: AccountId, from_index: u32, limit: Option<u32>) -> Vec<(u32, Trade)> {
        let idx = self.idx_of(&token_id);
        let n = self.tok(idx).trade_count;
        let start = from_index.max(n.saturating_sub(MAX_TRADES));
        let end = n.min(start + limit.unwrap_or(MAX_TRADES).min(MAX_TRADES));
        (start..end).filter_map(|i| self.trades.get(&(idx, i % MAX_TRADES)).cloned().map(|t| (i, t))).collect()
    }

    /// Public mechanics log (burns, epochs, yield funding, escrow moves), newest first.
    pub fn get_mech_log(&self, token_id: AccountId, limit: Option<u32>) -> Vec<MechEvent> {
        let idx = self.idx_of(&token_id);
        let n = self.tok(idx).mech_count;
        ring(n, MAX_MECH, limit.unwrap_or(MAX_MECH))
            .filter_map(|s| self.mech_log.get(&(idx, s)).cloned())
            .collect()
    }

    /// Most recent agent posts, newest first.
    pub fn get_posts(&self, token_id: AccountId, limit: Option<u32>) -> Vec<Post> {
        let idx = self.idx_of(&token_id);
        let n = self.tok(idx).post_count;
        ring(n, MAX_POSTS, limit.unwrap_or(MAX_POSTS))
            .filter_map(|s| self.posts.get(&(idx, s)).cloned())
            .collect()
    }

    /// Most recent epoch reports, newest first.
    pub fn get_epochs(&self, token_id: AccountId, limit: Option<u32>) -> Vec<EpochReport> {
        let idx = self.idx_of(&token_id);
        let n = self.tok(idx).epoch_index;
        ring(n, MAX_EPOCHS, limit.unwrap_or(MAX_EPOCHS))
            .filter_map(|s| self.epochs.get(&(idx, s)).cloned())
            .collect()
    }

    pub fn quote_buy(&self, token_id: AccountId, near_in: U128, account_id: Option<AccountId>) -> Quote {
        let idx = self.idx_of(&token_id);
        let cfg = &self.config;
        let t = self.tok(idx);
        let new_holder = account_id
            .map(|a| !self.known_holders.contains_key(&(idx, a)))
            .unwrap_or(true);
        let storage = if new_holder { crate::curve::STORAGE_FEE } else { 0 };
        let gross = near_in.0.saturating_sub(storage);
        let fee_bps = PLATFORM_FEE_BPS as u128 + t.buy_tax_bps as u128;
        let mut fee = bps(gross, fee_bps);
        let mut used = gross - fee;
        let remaining = cfg.curve_supply.0 - t.sold;
        let mut out = math::curve_tokens_out(t.v_near, t.v_tokens, used);
        let mut refund = 0;
        if out >= remaining && remaining > 0 {
            out = remaining;
            used = math::curve_near_for_tokens(t.v_near, t.v_tokens, out);
            fee = bps(used, fee_bps);
            refund = gross - used - fee;
        }
        Quote { amount_out: U128(out), fee: U128(fee), exit_fee: U128(0), refund: U128(refund) }
    }

    /// `age_secs`: seconds since the seller's `ft_holding_since`.
    pub fn quote_sell(&self, token_id: AccountId, tokens_in: U128, age_secs: u64) -> Quote {
        let idx = self.idx_of(&token_id);
        let t = self.tok(idx);
        let gross = math::curve_near_out(t.v_near, t.v_tokens, tokens_in.0);
        let fee = bps(gross, PLATFORM_FEE_BPS as u128 + t.sell_tax_bps as u128);
        let exit = bps(gross, math::exit_fee_bps(t.max_exit_fee_bps as u128, t.exit_decay_secs, age_secs));
        Quote { amount_out: U128(gross - fee - exit), fee: U128(fee), exit_fee: U128(exit), refund: U128(0) }
    }

    /// Floor redemption quote. Before graduation `amount_out` is NEAR; after, LiNEAR shares.
    pub fn quote_redeem(&self, token_id: AccountId, tokens_in: U128, age_secs: u64) -> Quote {
        let idx = self.idx_of(&token_id);
        let cfg = &self.config;
        let t = self.tok(idx);
        let gross = match t.grad_stage {
            GradStage::Curve if t.sold > t.burned => {
                math::mul_div(t.backing_near, tokens_in.0, t.sold - t.burned)
            }
            GradStage::Graduated => {
                math::mul_div(t.linear_shares, tokens_in.0, cfg.total_supply.0 - t.burned)
            }
            _ => 0,
        };
        let base = bps(gross, cfg.redeem_fee_bps as u128);
        let exit = bps(gross, math::exit_fee_bps(t.max_exit_fee_bps as u128, t.exit_decay_secs, age_secs));
        Quote { amount_out: U128(gross - base - exit), fee: U128(base), exit_fee: U128(exit), refund: U128(0) }
    }
}

impl Contract {
    fn view(&self, i: u32) -> TokenView {
        let t = self.tok(i);
        let c = &self.config;
        TokenView {
            index: i,
            token_id: t.token_id.clone(),
            creator: t.creator.clone(),
            meta: t.meta.clone(),
            created_at: t.created_at,
            deployed: t.deployed,
            dao_id: t.dao_id.clone(),
            dao_stage: t.dao_stage,
            v_near: U128(t.v_near),
            v_tokens: U128(t.v_tokens),
            sold: U128(t.sold),
            curve_supply: c.curve_supply,
            total_supply: c.total_supply,
            real_near: U128(t.real_near),
            burned: U128(t.burned),
            holders: t.holders,
            volume_near: U128(t.volume_near),
            trade_count: t.trade_count,
            backing_near: U128(t.backing_near),
            linear_shares: U128(t.linear_shares),
            principal_near: U128(t.principal_near),
            creator_escrow: U128(t.creator_escrow),
            creator_released: U128(t.creator_released),
            creator_claimable: U128(t.creator_claimable),
            grad_mcap_usd: t.grad_mcap_usd,
            launch_near_usd: U128(t.launch_near_usd),
            fdv_near: U128(math::fdv_near(t.v_near, t.v_tokens, c.total_supply.0 - t.burned)),
            grad_fdv_near: U128(grad_fdv(t, c)),
            grad_stage: t.grad_stage,
            grad_busy: t.grad_busy,
            pool_id: t.pool_id,
            lp_near: U128(t.lp_near),
            lp_shares: U128(t.lp_shares),
            lp_tokens: U128(t.lp_tokens),
            graduated_at: t.graduated_at,
            total_locked: U128(t.total_locked),
            total_weight: U128(t.total_weight),
            alloc_tally: t.alloc_tally.map(U128),
            stakers: t.stakers,
            epoch_index: t.epoch_index,
            last_epoch_at: t.last_epoch_at,
            next_epoch_at: if t.grad_stage == GradStage::Graduated {
                t.last_epoch_at + c.epoch_secs
            } else {
                0
            },
            epoch_busy: t.epoch_busy,
            last_linear_price: U128(t.last_linear_price),
            agent_account: t.agent_account.clone(),
            agent_persona: t.agent_persona.clone(),
            agent_budget_shares: U128(t.agent_budget_shares),
            post_count: t.post_count,
            snipe_window_ends: t.created_at + c.snipe_window_secs,
            custody_total: U128(t.custody_total),
            mech_count: t.mech_count,
            platform_fee_bps: PLATFORM_FEE_BPS,
            buy_tax_bps: t.buy_tax_bps,
            sell_tax_bps: t.sell_tax_bps,
            max_exit_fee_bps: t.max_exit_fee_bps,
            exit_decay_secs: t.exit_decay_secs,
            tax_vault_bps: t.tax_vault_bps,
            tax_creator_bps: t.tax_creator_bps,
            tax_burn_bps: t.tax_burn_bps,
            lp_k0: U128(t.lp_k0),
            last_harvest_at: t.last_harvest_at,
            next_harvest_at: if t.grad_stage == GradStage::Graduated {
                t.last_harvest_at + c.epoch_secs
            } else {
                0
            },
            harvest_busy: t.harvest_busy,
            harvest_pending: t.harvest_meme_pending > 0 || t.harvest_linear_pending > 0,
            harvested_linear: U128(t.harvested_linear),
            harvest_burned: U128(t.harvest_burned),
        }
    }
}

/// FDV (yoctoNEAR) at the end of this token's curve.
fn grad_fdv(t: &TokenState, c: &Config) -> u128 {
    // Invariant k = v_near * v_tokens; at the end v_tokens = v_tokens0 - curve_supply.
    let tf = c.virtual_tokens.0 - c.curve_supply.0;
    let v_end = math::mul_div(t.v_near, t.v_tokens, tf);
    math::fdv_near(v_end, tf, c.total_supply.0)
}

/// Slots of a ring buffer of size `cap` holding `n` total writes, newest first.
fn ring(n: u32, cap: u32, limit: u32) -> impl Iterator<Item = u32> {
    let count = n.min(cap).min(limit);
    (0..count).map(move |k| (n - 1 - k) % cap)
}
