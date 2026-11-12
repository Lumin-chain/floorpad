//! LP harvest: the locked Ref `MEME/LiNEAR` position grows from swap fees and
//! from LiNEAR's staking appreciation, but that growth would stay trapped in a
//! pool nobody can withdraw from. Once per epoch, anyone can call `harvest_lp`:
//!
//! 1. measure the launchpad's position depth `k = sqrt(LiNEAR side in NEAR x meme side)`;
//! 2. remove exactly the share of the position above the graduation baseline `lp_k0`,
//!    so the remaining liquidity is as deep (in NEAR terms) as at graduation;
//! 3. burn the meme side, and add the LiNEAR side to the vault as yield. The next
//!    `settle_epoch` splits it by the holders' vote like staking yield.
//!
//! Swaps can't lower `k` (constant product keeps x*y, fees raise it) and LiNEAR's
//! price only rises, so a trade can't make the harvest take principal.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, ext_linear, ext_ref, tgas, RefPoolInfo};
use crate::math;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{Promise, PromiseError};

/// Skip harvests smaller than 0.01% of the position (not worth the gas).
const MIN_HARVEST_BPS: u128 = 1;
/// Removal slippage guard against a trade landing between quote and removal.
const REMOVE_SLIPPAGE_BPS: u128 = 200;

#[near]
impl Contract {
    /// Permissionless, once per epoch after graduation. Attach 300 Tgas.
    /// If an earlier harvest left tokens in the Ref deposit, this retries the withdrawal.
    pub fn harvest_lp(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let cfg = self.config.clone();
        let me = env::current_account_id();
        let tok = self.tok(idx);
        require!(tok.grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        require!(!tok.harvest_busy, "ERR_HARVEST_IN_FLIGHT");
        let pool_id = tok.pool_id.expect("ERR_NO_POOL");
        if tok.harvest_meme_pending > 0 || tok.harvest_linear_pending > 0 {
            self.tok_mut(idx).harvest_busy = true;
            return self.harvest_withdraw(idx);
        }
        require!(now_secs() >= tok.last_harvest_at + cfg.epoch_secs, "ERR_HARVEST_NOT_DUE");
        self.tok_mut(idx).harvest_busy = true;
        ext_linear::ext(cfg.linear.clone())
            .with_static_gas(tgas(5))
            .ft_price()
            .and(ext_ref::ext(cfg.ref_exchange.clone()).with_static_gas(tgas(5)).get_pool(pool_id))
            .and(
                ext_ref::ext(cfg.ref_exchange.clone())
                    .with_static_gas(tgas(5))
                    .get_pool_shares(pool_id, me.clone()),
            )
            .then(Self::ext(me).with_static_gas(tgas(220)).on_harvest_quote(idx))
    }

    #[private]
    pub fn on_harvest_quote(
        &mut self,
        idx: u32,
        #[callback_result] price: Result<U128, PromiseError>,
        #[callback_result] pool: Result<RefPoolInfo, PromiseError>,
        #[callback_result] shares: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        let (Ok(price), Ok(pool), Ok(shares)) = (price, pool, shares) else {
            self.tok_mut(idx).harvest_busy = false;
            return PromiseOrValue::Value(());
        };
        let tok = self.tok(idx);
        let total = pool.shares_total_supply.0;
        let (meme_i, lin_i) = match pool_index(&pool, &tok.token_id, &self.config.linear) {
            Some(ix) if total > 0 && shares.0 > 0 => ix,
            _ => {
                self.tok_mut(idx).harvest_busy = false;
                return PromiseOrValue::Value(());
            }
        };
        let my_meme = math::mul_div(pool.amounts[meme_i].0, shares.0, total);
        let my_lin = math::mul_div(pool.amounts[lin_i].0, shares.0, total);
        let k_now = math::lp_depth(my_lin, my_meme, price.0);
        let remove = math::harvest_shares(shares.0, k_now, tok.lp_k0);
        if remove == 0 || remove < math::bps(shares.0, MIN_HARVEST_BPS) {
            let tok = self.tok_mut(idx);
            tok.harvest_busy = false;
            tok.last_harvest_at = now_secs();
            return PromiseOrValue::Value(());
        }
        let keep = math::BPS - REMOVE_SLIPPAGE_BPS;
        let mut min = vec![U128(0); pool.amounts.len()];
        min[meme_i] = U128(math::mul_div(math::mul_div(my_meme, remove, shares.0), keep, math::BPS));
        min[lin_i] = U128(math::mul_div(math::mul_div(my_lin, remove, shares.0), keep, math::BPS));
        let pool_id = tok.pool_id.expect("ERR_NO_POOL");
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(20))
            .remove_liquidity(pool_id, U128(remove), min)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(150))
                    .on_harvest_removed(idx, meme_i as u8, lin_i as u8),
            )
            .into()
    }

    #[private]
    pub fn on_harvest_removed(
        &mut self,
        idx: u32,
        meme_i: u8,
        lin_i: u8,
        #[callback_result] r: Result<Vec<U128>, PromiseError>,
    ) -> PromiseOrValue<()> {
        let amounts = match r {
            Ok(a) if a.len() > meme_i.max(lin_i) as usize => a,
            _ => {
                self.tok_mut(idx).harvest_busy = false;
                return PromiseOrValue::Value(());
            }
        };
        let (meme, lin) = (amounts[meme_i as usize].0, amounts[lin_i as usize].0);
        let tok = self.tok_mut(idx);
        tok.last_harvest_at = now_secs();
        if meme == 0 && lin == 0 {
            tok.harvest_busy = false;
            return PromiseOrValue::Value(());
        }
        tok.harvest_meme_pending += meme;
        tok.harvest_linear_pending += lin;
        // The remaining position is back at the baseline depth (rounding stays in the pool).
        self.log_mech(idx, "lp_harvest", lin, None);
        self.harvest_withdraw(idx).into()
    }

    /// Settles the Ref withdrawals: burn the meme side, credit the LiNEAR side to the
    /// vault as yield. A failed withdrawal stays pending and `harvest_lp` retries it.
    #[private]
    pub fn on_harvest_withdrawn(&mut self, idx: u32, meme: U128, lin: U128) -> PromiseOrValue<()> {
        let ok = |i: u64| env::promise_result_checked(i, 64).is_ok();
        let (mut i, mut meme_ok, mut lin_ok) = (0, false, false);
        if meme.0 > 0 {
            meme_ok = ok(i);
            i += 1;
        }
        if lin.0 > 0 {
            lin_ok = ok(i);
        }
        let tok = self.tok_mut(idx);
        tok.harvest_busy = false;
        if lin_ok {
            tok.harvest_linear_pending -= lin.0;
            tok.harvested_linear += lin.0;
            // Above principal, so the next epoch splits it by vote.
            tok.linear_shares += lin.0;
        }
        if !meme_ok {
            return PromiseOrValue::Value(());
        }
        tok.harvest_meme_pending -= meme.0;
        tok.tokens_in_flight += meme.0;
        let token_id = tok.token_id.clone();
        self.log_mech(idx, "lp_harvest_burn", meme.0, None);
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .burn(meme)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(5))
                    .on_harvest_burned(idx, meme),
            )
            .into()
    }

    #[private]
    pub fn on_harvest_burned(&mut self, idx: u32, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amount.0);
        if r.is_ok() {
            tok.burned += amount.0;
            tok.harvest_burned += amount.0;
        } else {
            // Tokens stay held here; the next buyback's excess-balance burn picks them up.
            env::log_str("harvest burn failed; tokens remain held by launchpad");
        }
    }

    /// Permissionless: claims accrued DEX pair taxes (`pending_platform` + `pending_tax`)
    /// from the graduated token, burns the buyback-and-burn share, and swaps the rest to LiNEAR.
    pub fn harvest_token_tax(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let tok = self.tok(idx);
        require!(tok.grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        let me = env::current_account_id();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .tax_take()
            .and(ext_ft::ext(self.config.linear.clone()).with_static_gas(tgas(5)).ft_balance_of(me.clone()))
            .then(
                Self::ext(me)
                    .with_static_gas(tgas(130))
                    .on_tax_taken(idx),
            )
    }

    #[private]
    pub fn on_tax_taken(
        &mut self,
        idx: u32,
        #[callback_result] r: Result<(U128, U128), PromiseError>,
        #[callback_result] pre_lin: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        let Ok((plat, tax)) = r else {
            return PromiseOrValue::Value(());
        };
        let total = plat.0 + tax.0;
        if total == 0 {
            return PromiseOrValue::Value(());
        }
        let (token_id, pool_id, burn_bps, vault_bps, creator_bps) = {
            let t = self.tok(idx);
            (t.token_id.clone(), t.pool_id, t.tax_burn_bps, t.tax_vault_bps, t.tax_creator_bps)
        };
        let burn_amt = math::bps(tax.0, burn_bps as u128);
        let swap_amt = total - burn_amt;
        if burn_amt > 0 {
            self.tok_mut(idx).tokens_in_flight += burn_amt;
            self.log_mech(idx, "tax_burn", burn_amt, None);
            ext_ft::ext(token_id.clone())
                .with_static_gas(tgas(10))
                .burn(U128(burn_amt))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(tgas(5))
                        .on_harvest_burned(idx, U128(burn_amt)),
                )
                .detach();
        }
        let Some(pid) = pool_id else {
            return PromiseOrValue::Value(());
        };
        if swap_amt == 0 {
            return PromiseOrValue::Value(());
        }
        let cfg = self.config.clone();
        let me = env::current_account_id();
        let pre_bal = pre_lin.map(|v| v.0).unwrap_or(0);
        let msg = near_sdk::serde_json::json!({
            "force": 0,
            "actions": [{
                "pool_id": pid,
                "token_in": token_id,
                "token_out": cfg.linear,
                "min_amount_out": "1"
            }]
        })
        .to_string();
        ext_ft::ext(token_id)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(50))
            .ft_transfer_call(cfg.ref_exchange, U128(swap_amt), None, msg)
            .then(ext_ft::ext(cfg.linear).with_static_gas(tgas(5)).ft_balance_of(me.clone()))
            .then(
                Self::ext(me)
                    .with_static_gas(tgas(25))
                    .on_tax_swapped(idx, plat, U128(tax.0 - burn_amt), vault_bps, creator_bps, U128(pre_bal)),
            )
            .into()
    }

    #[private]
    pub fn on_tax_swapped(
        &mut self,
        idx: u32,
        plat_tokens: U128,
        tax_tokens: U128,
        _vault_bps: u16,
        creator_bps: u16,
        pre_lin: U128,
        #[callback_result] post_lin: Result<U128, PromiseError>,
    ) {
        let Ok(post) = post_lin else {
            return;
        };
        let lin_out = post.0.saturating_sub(pre_lin.0);
        if lin_out == 0 {
            return;
        }
        let denom = plat_tokens.0 + tax_tokens.0;
        if denom == 0 {
            return;
        }
        let plat_lin = math::mul_div(lin_out, plat_tokens.0, denom);
        let tax_lin = lin_out - plat_lin;
        self.credit_linear(&self.config.treasury_id.clone(), plat_lin);
        let creator_lin = math::bps(tax_lin, creator_bps as u128);
        let vault_lin = tax_lin - creator_lin;
        let creator = self.tok(idx).creator.clone();
        self.credit_linear(&creator, creator_lin);
        self.tok_mut(idx).linear_shares += vault_lin;
        self.log_mech(idx, "tax_harvest", vault_lin, None);
    }
}

impl Contract {
    /// Withdraw everything pending in the Ref deposit back to the launchpad.
    fn harvest_withdraw(&mut self, idx: u32) -> Promise {
        let cfg = self.config.clone();
        let tok = self.tok(idx);
        let (meme, lin) = (tok.harvest_meme_pending, tok.harvest_linear_pending);
        let w = |token: AccountId, amount: u128| {
            ext_ref::ext(cfg.ref_exchange.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(40))
                .withdraw(token, U128(amount), None, Some(true))
        };
        let p = match (meme > 0, lin > 0) {
            (true, true) => w(tok.token_id.clone(), meme).and(w(cfg.linear.clone(), lin)),
            (true, false) => w(tok.token_id.clone(), meme),
            (false, true) => w(cfg.linear.clone(), lin),
            (false, false) => env::panic_str("ERR_NOTHING_PENDING"),
        };
        p.then(
            Self::ext(env::current_account_id())
                .with_static_gas(tgas(40))
                .on_harvest_withdrawn(idx, U128(meme), U128(lin)),
        )
    }
}

/// Positions of the meme token and LiNEAR in the pool's token list.
fn pool_index(pool: &RefPoolInfo, meme: &AccountId, linear: &AccountId) -> Option<(usize, usize)> {
    let ids = &pool.token_account_ids;
    let m = ids.iter().position(|t| t == meme)?;
    let l = ids.iter().position(|t| t == linear)?;
    (pool.amounts.len() == ids.len()).then_some((m, l))
}
