//! The floor: every token can always be redeemed for its share of the vault.
//!
//! * Before graduation the vault holds NEAR (curve fee share + exit fees).
//! * After graduation it holds LiNEAR, so the floor also grows with staking yield.
//! Redemptions burn the tokens, and the redemption fee stays in the vault,
//! so every redemption raises the floor for remaining holders.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, tgas};
use crate::math::{self, bps};
use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{Promise, PromiseError};

#[near]
impl Contract {
    #[private]
    pub fn on_redeem_age(
        &mut self,
        idx: u32,
        holder: AccountId,
        amount: U128,
        min_out: U128,
        #[callback_result] since: Result<Option<U64>, PromiseError>,
    ) -> U128 {
        let cfg = self.config.clone();
        let age = since
            .ok()
            .flatten()
            .map(|s| now_secs().saturating_sub(s.0))
            .unwrap_or(0);
        let fee_bps = cfg.redeem_fee_bps as u128
            + math::exit_fee_bps(cfg.max_exit_fee_bps as u128, cfg.exit_decay_secs, age);
        let total_supply = cfg.total_supply.0;
        let tok = self.tok_mut(idx);
        match tok.grad_stage {
            GradStage::Curve => {
                let circulating = tok.sold - tok.burned;
                if circulating == 0 {
                    return amount;
                }
                let gross = math::mul_div(tok.backing_near, amount.0, circulating);
                let net = gross - bps(gross, fee_bps);
                if net == 0 || net < min_out.0 {
                    return amount;
                }
                tok.backing_near -= net;
                Promise::new(holder.clone()).transfer(NearToken::from_yoctonear(net)).detach();
            }
            GradStage::Graduated => {
                let redeemable = total_supply - tok.burned;
                let gross = math::mul_div(tok.linear_shares, amount.0, redeemable);
                let net = gross - bps(gross, fee_bps);
                if net == 0 || net < min_out.0 {
                    return amount;
                }
                tok.principal_near -= math::mul_div(tok.principal_near, net, tok.linear_shares);
                tok.linear_shares -= net;
                self.credit_linear(&holder, net);
            }
            _ => return amount, // graduation in progress
        }
        self.log_mech(idx, "redeem_burn", amount.0, Some(holder.clone()));
        let tok = self.tok_mut(idx);
        tok.burned += amount.0;
        tok.tokens_in_flight += amount.0;
        let token_id = tok.token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .burn(amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(5))
                    .on_redeem_burned(idx, amount),
            ).detach();
        U128(0)
    }

    #[private]
    pub fn on_redeem_burned(
        &mut self,
        idx: u32,
        amount: U128,
        #[callback_result] r: Result<(), PromiseError>,
    ) {
        let tok = self.tok_mut(idx);
        if r.is_ok() {
            tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amount.0);
        } else {
            // Keep failed-burn tokens counted in `tokens_in_flight` so `on_buyback_balance`
            // does not treat them as excess and double-count `tok.burned`.
            env::log_str("redeem burn failed; tokens remain reserved");
        }
    }

    /// Withdraw all claimable LiNEAR (redemptions, airdrops, agent pay).
    /// The receiver must be registered on the LiNEAR contract.
    #[payable]
    pub fn withdraw_linear(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let amount = self.claimable_linear.remove(&account).unwrap_or(0);
        require!(amount > 0, "ERR_NOTHING_TO_WITHDRAW");
        ext_ft::ext(self.config.linear.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(10))
            .ft_transfer(account.clone(), U128(amount), Some("floorpad".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(5))
                    .on_linear_sent(account, U128(amount)),
            )
    }

    /// Re-credits LiNEAR if a transfer out failed.
    #[private]
    pub fn on_linear_sent(
        &mut self,
        account: AccountId,
        amount: U128,
        #[callback_result] r: Result<(), PromiseError>,
    ) {
        if r.is_err() {
            self.credit_linear(&account, amount.0);
        }
    }
}

impl Contract {
    pub(crate) fn start_redeem(
        &mut self,
        idx: u32,
        holder: AccountId,
        amount: u128,
        min_out: u128,
    ) -> PromiseOrValue<U128> {
        let stage = self.tok(idx).grad_stage;
        require!(
            stage == GradStage::Curve || stage == GradStage::Graduated,
            "ERR_GRADUATING"
        );
        let token_id = self.tok(idx).token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(5))
            .ft_holding_since(holder.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(25))
                    .on_redeem_age(idx, holder, U128(amount), U128(min_out)),
            )
            .into()
    }
}
