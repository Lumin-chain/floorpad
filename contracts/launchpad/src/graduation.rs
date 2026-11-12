//! Graduation: curve sold out -> Ref `MEME/LiNEAR` pool with permanently locked LP.
//!
//! Pairing against LiNEAR (not NEAR) means the locked liquidity earns staking
//! yield while it stays in the pool. Each step is a permissionless
//! `advance_graduation` call (UI or keeper) so a failed step can simply be retried.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, ext_linear, ext_ref, tgas};
use crate::math::{self, bps};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{Promise, PromiseError};

const MILLI: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR

#[near]
impl Contract {
    /// Run the next graduation step. Attach 300 Tgas.
    pub fn advance_graduation(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let cfg = self.config.clone();
        let me = env::current_account_id();
        let tok = self.tok(idx).clone();
        require!(!tok.grad_busy, "ERR_STEP_IN_FLIGHT");
        let cb = Self::ext(me.clone()).with_static_gas(tgas(30));
        let p = match tok.grad_stage {
            GradStage::Curve => env::panic_str("ERR_CURVE_NOT_SOLD_OUT"),
            GradStage::Graduated => env::panic_str("ERR_ALREADY_GRADUATED"),
            GradStage::CreatePool => ext_ref::ext(cfg.ref_exchange.clone())
                .with_attached_deposit(NearToken::from_yoctonear(50 * MILLI))
                .with_static_gas(tgas(10))
                .storage_deposit(Some(me.clone()), None)
                .then(
                    ext_ref::ext(cfg.ref_exchange.clone())
                        .with_attached_deposit(ONE_YOCTO)
                        .with_static_gas(tgas(10))
                        .register_tokens(vec![tok.token_id.clone(), cfg.linear.clone()]),
                )
                .then(
                    ext_ft::ext(tok.token_id.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(13 * MILLI / 10))
                        .with_static_gas(tgas(10))
                        .storage_deposit(Some(cfg.ref_exchange.clone()), Some(true)),
                )
                .then(
                    ext_ft::ext(cfg.linear.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(13 * MILLI / 10))
                        .with_static_gas(tgas(10))
                        .storage_deposit(Some(tok.dao_id.clone()), Some(true)),
                )
                .then(
                    ext_ref::ext(cfg.ref_exchange.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(100 * MILLI))
                        .with_static_gas(tgas(20))
                        .add_simple_pool(
                            vec![tok.token_id.clone(), cfg.linear.clone()],
                            cfg.ref_pool_fee,
                        ),
                )
                .then(cb.on_grad_pool_created(idx)),
            GradStage::Stake => ext_linear::ext(cfg.linear.clone())
                .with_static_gas(tgas(5))
                .ft_price()
                .then(Self::ext(me).with_static_gas(tgas(80)).on_grad_price(idx)),
            GradStage::Deposit => {
                let ref_id = cfg.ref_exchange.clone();
                let meme = ext_ft::ext(tok.token_id.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(tgas(60))
                    .ft_transfer_call(ref_id.clone(), U128(tok.lp_tokens), None, String::new());
                let lin = ext_ft::ext(cfg.linear.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(tgas(60))
                    .ft_transfer_call(ref_id, U128(tok.lp_shares), None, String::new());
                let (send_meme, send_lin) = (!tok.lp_meme_deposited, !tok.lp_linear_deposited);
                let joined = match (send_meme, send_lin) {
                    (true, true) => meme.and(lin),
                    (true, false) => meme,
                    (false, true) => lin,
                    (false, false) => env::panic_str("ERR_NOTHING_TO_DEPOSIT"),
                };
                joined.then(cb.on_grad_deposited(idx, send_meme, send_lin))
            }
            GradStage::AddLiquidity => ext_ref::ext(cfg.ref_exchange.clone())
                .with_attached_deposit(NearToken::from_yoctonear(50 * MILLI))
                .with_static_gas(tgas(30))
                .add_liquidity(
                    tok.pool_id.expect("ERR_NO_POOL"),
                    vec![U128(tok.lp_tokens), U128(tok.lp_shares)],
                    None,
                )
                .then(cb.on_grad_liquidity(idx)),
        };
        self.tok_mut(idx).grad_busy = true;
        p
    }

    #[private]
    pub fn on_grad_pool_created(&mut self, idx: u32, #[callback_result] r: Result<u64, PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.grad_busy = false;
        if let Ok(pool_id) = r {
            tok.pool_id = Some(pool_id);
            tok.grad_stage = GradStage::Stake;
        }
    }

    #[private]
    pub fn on_grad_price(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) -> PromiseOrValue<()> {
        let Ok(price) = r else {
            self.tok_mut(idx).grad_busy = false;
            return PromiseOrValue::Value(());
        };
        let tok = self.tok(idx);
        let amount = tok.lp_near + tok.backing_near;
        ext_linear::ext(self.config.linear.clone())
            .with_attached_deposit(NearToken::from_yoctonear(amount))
            .with_static_gas(tgas(40))
            .deposit_and_stake()
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(10))
                    .on_grad_staked(idx, price, U128(amount)),
            )
            .into()
    }

    #[private]
    pub fn on_grad_staked(
        &mut self,
        idx: u32,
        price: U128,
        amount: U128,
        #[callback_result] r: Result<U128, PromiseError>,
    ) {
        let tok = self.tok_mut(idx);
        tok.grad_busy = false;
        // LiNEAR returns the exact number of shares minted.
        let Ok(minted) = r else {
            return; // NEAR refunded by LiNEAR; retry the step
        };
        let total = minted.0;
        tok.lp_shares = math::mul_div(total, tok.lp_near, amount.0);
        tok.linear_shares += total - tok.lp_shares;
        tok.principal_near += tok.backing_near;
        tok.backing_near = 0;
        tok.last_linear_price = price.0;
        tok.grad_stage = GradStage::Deposit;
    }

    #[private]
    pub fn on_grad_deposited(&mut self, idx: u32, sent_meme: bool, sent_lin: bool) {
        let tok = self.tok_mut(idx);
        let lp_tokens = tok.lp_tokens;
        tok.grad_busy = false;
        let used = |i: u64| -> u128 {
            match env::promise_result_checked(i, 64) {
                Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v)
                    .map(|u| u.0)
                    .unwrap_or(0),
                _ => 0,
            }
        };
        let mut i = 0;
        if sent_meme {
            if used(i) == lp_tokens {
                tok.lp_meme_deposited = true;
            }
            i += 1;
        }
        if sent_lin && used(i) == tok.lp_shares {
            tok.lp_linear_deposited = true;
        }
        if tok.lp_meme_deposited && tok.lp_linear_deposited {
            tok.grad_stage = GradStage::AddLiquidity;
        }
    }

    #[private]
    pub fn on_grad_liquidity(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.grad_busy = false;
        if r.is_ok() {
            tok.grad_stage = GradStage::Graduated;
            tok.graduated_at = now_secs();
            tok.last_epoch_at = tok.graduated_at;
            tok.last_harvest_at = tok.graduated_at;
            // Baseline depth of the locked LP; harvests only take growth above it.
            tok.lp_k0 = math::lp_depth(tok.lp_shares, tok.lp_tokens, tok.last_linear_price);
            let token_id = tok.token_id.clone();
            let ref_id = self.config.ref_exchange.clone();
            ext_ft::ext(token_id).with_static_gas(tgas(10)).tax_add_pair(ref_id).detach();
        }
    }

    /// Permissionless retry: ensures the graduated token has `ref_exchange` registered in `pairs`.
    pub fn ensure_dex_tax_pair(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        require!(self.tok(idx).grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .tax_add_pair(self.config.ref_exchange.clone())
    }
}

impl Contract {
    /// Called by the buy that sells out the curve. Splits the raise:
    /// * `grad_vault_bps` seeds the floor vault,
    /// * `grad_platform_bps` is the platform's graduation fee,
    /// * `graduation_reserve` pays Ref/LiNEAR storage,
    /// * the rest becomes liquidity, paired with exactly as many tokens as keep
    ///   the Ref price equal to the final curve price. Unused LP tokens are burned.
    pub(crate) fn enter_graduation(&mut self, idx: u32) {
        let cfg = self.config.clone();
        let (raise, v_near, v_tokens) = {
            let t = self.tok(idx);
            (t.real_near, t.v_near, t.v_tokens)
        };
        let vault_seed = bps(raise, cfg.grad_vault_bps as u128);
        let platform = bps(raise, cfg.grad_platform_bps as u128);
        let reserve = cfg.graduation_reserve.as_yoctonear().min(raise - vault_seed - platform);
        let mut lp_near = raise - vault_seed - platform - reserve;
        let mut lp_tokens = math::mul_div(lp_near, v_tokens, v_near);
        let mut extra_vault = 0;
        if lp_tokens > cfg.lp_supply.0 {
            lp_tokens = cfg.lp_supply.0;
            let needed = math::mul_div(lp_tokens, v_near, v_tokens);
            extra_vault = lp_near - needed;
            lp_near = needed;
        }
        let burn = cfg.lp_supply.0 - lp_tokens;
        self.platform_fees += platform;
        let tok = self.tok_mut(idx);
        tok.lp_near = lp_near;
        tok.lp_tokens = lp_tokens;
        tok.backing_near += vault_seed + extra_vault;
        tok.real_near = 0;
        tok.grad_stage = GradStage::CreatePool;
        if burn > 0 {
            tok.burned += burn;
            tok.tokens_in_flight += burn;
            let token_id = tok.token_id.clone();
            self.log_mech(idx, "graduation_burn", burn, None);
            ext_ft::ext(token_id)
                .with_static_gas(tgas(10))
                .burn(U128(burn))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(tgas(5))
                        .on_redeem_burned(idx, U128(burn)),
                )
                .detach();
        }
    }
}
