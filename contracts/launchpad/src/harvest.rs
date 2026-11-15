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
use crate::guard::{cp_out, within_band, MAX_SWAP_POOL_BPS, SWAP_SLIPPAGE_BPS};
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

    /// Permissionless: claims accrued DEX pair taxes, burns the burn share and swaps the rest to
    /// LiNEAR for the treasury, creator and vault.
    ///
    /// Every amount is exact: tokens are deposited into the launchpad's Ref account, `swap`
    /// returns the LiNEAR it produced, and exactly that is withdrawn and credited. The swap only
    /// runs when the pool price is within the band of the reference price, at most
    /// `MAX_SWAP_POOL_BPS` of the pool per call, and with a real minimum output; anything not
    /// swapped stays tracked and is retried on the next call. Attach 300 Tgas.
    pub fn harvest_token_tax(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let tok = self.tok(idx);
        require!(tok.grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        let pool_id = tok.pool_id.expect("ERR_NO_POOL");
        let mut st = self.tax_state(idx);
        require!(!st.busy, "ERR_TAX_IN_FLIGHT");
        st.busy = true;
        self.set_tax_state(idx, &st);
        if st.lin() > 0 {
            return self.tax_withdraw(idx);
        }
        let me = env::current_account_id();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .tax_take()
            .and(ext_ref::ext(self.config.ref_exchange.clone()).with_static_gas(tgas(5)).get_pool(pool_id))
            .then(Self::ext(me).with_static_gas(tgas(230)).on_tax_taken(idx))
    }

    #[private]
    pub fn on_tax_taken(
        &mut self,
        idx: u32,
        #[callback_result] r: Result<(U128, U128), PromiseError>,
        #[callback_result] pool: Result<RefPoolInfo, PromiseError>,
    ) -> PromiseOrValue<()> {
        let mut st = self.tax_state(idx);
        let (token_id, burn_bps) = {
            let t = self.tok(idx);
            (t.token_id.clone(), t.tax_burn_bps)
        };
        if let Ok((plat, tax)) = r {
            let burn_amt = math::bps(tax.0, burn_bps as u128);
            st.held_plat += plat.0;
            st.held_tax += tax.0 - burn_amt;
            // held tokens are reserved (never mistaken for buyback output and burned)
            self.tok_mut(idx).tokens_in_flight += plat.0 + tax.0;
            if burn_amt > 0 {
                self.log_mech(idx, "tax_burn", burn_amt, None);
                ext_ft::ext(token_id.clone())
                    .with_static_gas(tgas(10))
                    .burn(U128(burn_amt))
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(tgas(5))
                            .on_tax_burned(idx, U128(burn_amt)),
                    )
                    .detach();
            }
        }
        if st.held() + st.in_ref() == 0 {
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        }
        let linear = self.config.linear.clone();
        let reserves = pool.ok().and_then(|p| {
            let m = p.token_account_ids.iter().position(|t| *t == token_id)?;
            let l = p.token_account_ids.iter().position(|t| *t == linear)?;
            Some((p.amounts.get(l)?.0, p.amounts.get(m)?.0))
        });
        let guarded = reserves.and_then(|(r_lin, r_meme)| {
            let (reference, spot) = self.observe_pool_price(idx, r_lin, r_meme)?;
            within_band(spot, reference).then_some((r_lin, r_meme, reference))
        });
        let Some((r_lin, r_meme, reference)) = guarded else {
            env::log_str("tax swap deferred: pool price outside the reference band");
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        };
        let cap = math::mul_div(r_meme, MAX_SWAP_POOL_BPS, math::BPS);
        let min_for = |amt: u128| {
            let quoted = cp_out(amt, r_meme, r_lin, self.config.ref_pool_fee);
            let at_ref = math::mul_div(amt, reference, math::PRICE_SCALE);
            math::mul_div(quoted.min(at_ref), math::BPS - SWAP_SLIPPAGE_BPS, math::BPS)
        };
        // Tokens already in Ref (an earlier swap failed) go first; then held tokens are deposited.
        if st.in_ref() > 0 {
            let amt = st.in_ref().min(cap);
            let p = math::mul_div(amt, st.in_ref_plat, st.in_ref());
            let min = min_for(amt);
            self.set_tax_state(idx, &st);
            return self.tax_swap(idx, p, amt - p, min).into();
        }
        let amt = st.held().min(cap);
        let p = math::mul_div(amt, st.held_plat, st.held());
        let min = min_for(amt);
        self.set_tax_state(idx, &st);
        if amt == 0 || min == 0 {
            let mut st = self.tax_state(idx);
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        }
        ext_ft::ext(token_id)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(40))
            .ft_transfer_call(self.config.ref_exchange.clone(), U128(amt), None, String::new())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(140))
                    .on_tax_deposited(idx, U128(p), U128(amt - p), U128(min)),
            )
            .into()
    }

    #[private]
    pub fn on_tax_deposited(&mut self, idx: u32, plat: U128, tax: U128, min_out: U128) -> PromiseOrValue<()> {
        let amt = plat.0 + tax.0;
        let used = match env::promise_result_checked(0, 64) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(0),
            Err(_) => 0,
        };
        let mut st = self.tax_state(idx);
        if used != amt {
            // refunded to the launchpad: still held, retried next time
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        }
        st.held_plat -= plat.0;
        st.held_tax -= tax.0;
        st.in_ref_plat += plat.0;
        st.in_ref_tax += tax.0;
        self.set_tax_state(idx, &st);
        let tok = self.tok_mut(idx);
        tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amt);
        self.tax_swap(idx, plat.0, tax.0, min_out.0).into()
    }

    #[private]
    pub fn on_tax_swapped(
        &mut self,
        idx: u32,
        plat: U128,
        tax: U128,
        #[callback_result] r: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        let mut st = self.tax_state(idx);
        let Ok(out) = r else {
            // stays in the launchpad's Ref account; the next call retries the swap
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        };
        let amt = plat.0 + tax.0;
        st.in_ref_plat -= plat.0;
        st.in_ref_tax -= tax.0;
        let plat_lin = if amt == 0 { 0 } else { math::mul_div(out.0, plat.0, amt) };
        let tax_lin = out.0 - plat_lin;
        let creator_lin = math::bps(tax_lin, self.tok(idx).tax_creator_bps as u128);
        st.lin_plat += plat_lin;
        st.lin_creator += creator_lin;
        st.lin_vault += tax_lin - creator_lin;
        self.set_tax_state(idx, &st);
        if st.lin() == 0 {
            let mut st = self.tax_state(idx);
            st.busy = false;
            self.set_tax_state(idx, &st);
            return PromiseOrValue::Value(());
        }
        self.tax_withdraw(idx).into()
    }

    /// Credits exactly the withdrawn LiNEAR; a failed withdrawal stays pending for a retry.
    #[private]
    pub fn on_tax_withdrawn(&mut self, idx: u32, #[callback_result] r: Result<(), PromiseError>) {
        let mut st = self.tax_state(idx);
        st.busy = false;
        if r.is_ok() {
            let (plat, creator_lin, vault) = (st.lin_plat, st.lin_creator, st.lin_vault);
            st.lin_plat = 0;
            st.lin_creator = 0;
            st.lin_vault = 0;
            self.set_tax_state(idx, &st);
            let treasury = self.config.treasury_id.clone();
            self.credit_linear(&treasury, plat);
            let creator = self.tok(idx).creator.clone();
            self.credit_linear(&creator, creator_lin);
            self.tok_mut(idx).linear_shares += vault;
            self.log_mech(idx, "tax_harvest", vault, None);
        } else {
            self.set_tax_state(idx, &st);
        }
    }

    #[private]
    pub fn on_tax_burned(&mut self, idx: u32, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amount.0);
        if r.is_ok() {
            tok.burned += amount.0;
        } else {
            env::log_str("tax burn failed; tokens remain held by launchpad");
        }
    }

    /// Tax harvest progress for a token (meme held / in Ref, LiNEAR awaiting withdrawal).
    pub fn get_tax_harvest(&self, token_id: AccountId) -> (U128, U128, U128, bool) {
        let st = self.tax_state(self.idx_of(&token_id));
        (U128(st.held()), U128(st.in_ref()), U128(st.lin()), st.busy)
    }
}

impl Contract {
    fn tax_swap(&mut self, idx: u32, plat: u128, tax: u128, min_out: u128) -> Promise {
        let cfg = self.config.clone();
        let tok = self.tok(idx);
        let action = near_sdk::serde_json::json!({
            "pool_id": tok.pool_id.expect("ERR_NO_POOL"),
            "token_in": tok.token_id,
            "amount_in": U128(plat + tax),
            "token_out": cfg.linear,
            "min_amount_out": U128(min_out),
        });
        ext_ref::ext(cfg.ref_exchange)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(30))
            .swap(vec![action], None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(70))
                    .on_tax_swapped(idx, U128(plat), U128(tax)),
            )
    }

    fn tax_withdraw(&mut self, idx: u32) -> Promise {
        let cfg = self.config.clone();
        let total = self.tax_state(idx).lin();
        ext_ref::ext(cfg.ref_exchange)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(40))
            .withdraw(cfg.linear, U128(total), None, Some(true))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(20))
                    .on_tax_withdrawn(idx),
            )
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
