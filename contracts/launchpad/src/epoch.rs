//! Epochs: each epoch the vault's staking yield (LiNEAR appreciation above
//! principal) is split by the ve-weighted holder vote:
//! floor (compound), buyback & burn, airdrop to lockers, AI agent budget, DAO treasury.
//! Principal is never distributed: the floor can only go up.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, ext_linear, tgas};
use crate::math::{self, ACC_SCALE, PRICE_SCALE};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{Promise, PromiseError};

#[near]
impl Contract {
    /// Permissionless once per epoch after graduation. Attach 300 Tgas.
    pub fn settle_epoch(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let epoch_secs = self.config.epoch_secs;
        let tok = self.tok(idx);
        require!(tok.grad_stage == GradStage::Graduated, "ERR_NOT_GRADUATED");
        require!(!tok.epoch_busy, "ERR_EPOCH_IN_FLIGHT");
        require!(now_secs() >= tok.last_epoch_at + epoch_secs, "ERR_EPOCH_NOT_DUE");
        self.tok_mut(idx).epoch_busy = true;
        ext_linear::ext(self.config.linear.clone())
            .with_static_gas(tgas(5))
            .ft_price()
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(200))
                    .on_epoch_price(idx),
            )
    }

    #[private]
    pub fn on_epoch_price(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) {
        let Ok(price) = r else {
            self.tok_mut(idx).epoch_busy = false;
            return;
        };
        let price = price.0;
        let cfg = self.config.clone();
        let me = env::current_account_id();
        let now = now_secs();

        let tok = self.tok(idx);
        let principal_shares = math::mul_div_ceil(tok.principal_near, PRICE_SCALE, price);
        let yield_shares = tok.linear_shares.saturating_sub(principal_shares);
        let platform_cut = math::mul_div(yield_shares, cfg.yield_platform_bps as u128, math::BPS);
        let mut split = math::split_by_tally(yield_shares - platform_cut, &tok.alloc_tally);
        if tok.total_weight == 0 {
            split[BUCKET_FLOOR] += split[BUCKET_AIRDROP];
            split[BUCKET_AIRDROP] = 0;
        }
        if tok.dao_stage != DaoStage::Ready {
            split[BUCKET_FLOOR] += split[BUCKET_TREASURY];
            split[BUCKET_TREASURY] = 0;
        }
        let tally = tok.alloc_tally;
        let (dao_id, token_id, pool_id) =
            (tok.dao_id.clone(), tok.token_id.clone(), tok.pool_id.unwrap_or(0));

        let tok = self.tok_mut(idx);
        // Floor: shares stay in the vault and become principal.
        tok.principal_near += math::shares_to_near(split[BUCKET_FLOOR], price);
        // Airdrop: shares leave the vault into the lockers' reward pool.
        if split[BUCKET_AIRDROP] > 0 {
            tok.acc_reward_per_weight +=
                math::mul_div(split[BUCKET_AIRDROP], ACC_SCALE, tok.total_weight);
        }
        tok.agent_budget_shares += split[BUCKET_AGENT];
        tok.linear_shares -= platform_cut;
        tok.linear_shares -= split[BUCKET_BUYBACK]
            + split[BUCKET_AIRDROP]
            + split[BUCKET_AGENT]
            + split[BUCKET_TREASURY];
        tok.last_linear_price = price;
        tok.last_epoch_at = now;
        tok.epoch_busy = false;
        let epoch = tok.epoch_index;
        tok.epoch_index += 1;

        let treasury = cfg.treasury_id.clone();
        self.credit_linear(&treasury, platform_cut);
        self.log_mech(idx, "epoch", yield_shares, None);
        self.epochs.insert(
            (idx, epoch % MAX_EPOCHS),
            EpochReport {
                index: epoch,
                ts: now,
                price: U128(price),
                yield_shares: U128(yield_shares),
                split: split.map(U128),
                tally: tally.map(U128),
            },
        );

        if split[BUCKET_TREASURY] > 0 {
            ext_ft::ext(cfg.linear.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(10))
                .ft_transfer(dao_id.clone(), U128(split[BUCKET_TREASURY]), Some("floorpad epoch".into()))
                .then(
                    Self::ext(me.clone())
                        .with_static_gas(tgas(5))
                        .on_linear_sent(dao_id, U128(split[BUCKET_TREASURY])),
                ).detach();
        }
        if split[BUCKET_BUYBACK] > 0 {
            let msg = format!(
                r#"{{"actions":[{{"pool_id":{},"token_in":"{}","token_out":"{}","amount_in":"{}","min_amount_out":"1"}}]}}"#,
                pool_id, cfg.linear, token_id, split[BUCKET_BUYBACK]
            );
            ext_ft::ext(cfg.linear)
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(60))
                .ft_transfer_call(cfg.ref_exchange, U128(split[BUCKET_BUYBACK]), None, msg)
                .then(
                    Self::ext(me)
                        .with_static_gas(tgas(50))
                        .on_buyback_swapped(idx, U128(split[BUCKET_BUYBACK])),
                ).detach();
        }
    }

    #[private]
    pub fn on_buyback_swapped(
        &mut self,
        idx: u32,
        amount: U128,
        #[callback_result] r: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        let used = r.map(|u| u.0).unwrap_or(0);
        let tok = self.tok_mut(idx);
        // Unused LiNEAR (failed swap) goes back to the floor.
        tok.linear_shares += amount.0 - used.min(amount.0);
        if used == 0 {
            return PromiseOrValue::Value(());
        }
        let token_id = tok.token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(5))
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(25))
                    .on_buyback_balance(idx),
            )
            .into()
    }

    /// Burns every meme token held here that isn't locked, owed or in flight
    /// (i.e. the tokens the buyback just bought).
    #[private]
    pub fn on_buyback_balance(&mut self, idx: u32, #[callback_result] r: Result<U128, PromiseError>) -> PromiseOrValue<()> {
        let Ok(bal) = r else { return PromiseOrValue::Value(()) };
        let tok = self.tok_mut(idx);
        let reserved = tok.total_locked + tok.owed_tokens + tok.tokens_in_flight + tok.custody_total;
        let excess = bal.0.saturating_sub(reserved);
        if excess == 0 {
            return PromiseOrValue::Value(());
        }
        tok.tokens_in_flight += excess;
        let token_id = tok.token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(10))
            .burn(U128(excess))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(5))
                    .on_buyback_burned(idx, U128(excess)),
            )
            .into()
    }

    #[private]
    pub fn on_buyback_burned(&mut self, idx: u32, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amount.0);
        if r.is_ok() {
            tok.burned += amount.0;
            self.log_mech(idx, "buyback_burn", amount.0, None);
        }
    }
}
