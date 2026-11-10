//! Token creation and bonding-curve trading.
use crate::ext::{ext_ft, tgas};
use crate::math::{self, bps};
use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{Promise, PromiseError};

/// Storage registration charged to first-time buyers of a token.
pub const STORAGE_FEE: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_ICON_LEN: usize = 12_000;

#[near]
impl Contract {
    /// Launches a token: deploys the NEP-141 contract, creates its Sputnik DAO
    /// and opens the bonding curve. Attach `creation_fee` and 300 Tgas.
    #[payable]
    pub fn create_token(&mut self, meta: TokenMeta, agent_persona: Option<String>) -> AccountId {
        let deposit = env::attached_deposit().as_yoctonear();
        let cfg = self.config.clone();
        require!(deposit >= cfg.creation_fee.as_yoctonear(), "ERR_CREATION_FEE");
        let sym = meta.symbol.clone();
        require!(
            (2..=10).contains(&sym.len()) && sym.chars().all(|c| c.is_ascii_alphanumeric()),
            "ERR_SYMBOL"
        );
        require!(!meta.name.is_empty() && meta.name.len() <= 40, "ERR_NAME");
        require!(meta.description.len() <= 600, "ERR_DESCRIPTION");
        require!(meta.icon.as_ref().map_or(true, |i| i.len() <= MAX_ICON_LEN), "ERR_ICON_TOO_BIG");
        let persona = agent_persona.unwrap_or_else(|| {
            format!("You are the voice of ${}. Be funny, upbeat and never give financial advice.", sym)
        });
        require!(persona.len() <= 1500, "ERR_PERSONA");

        let sub = sym.to_lowercase();
        let me = env::current_account_id();
        let token_id: AccountId = format!("{}.{}", sub, me).parse().expect("ERR_TOKEN_ID");
        require!(!self.token_index.contains_key(&token_id), "ERR_TICKER_TAKEN");
        let dao_id: AccountId =
            format!("{}-fp.{}", sub, cfg.sputnik_factory).parse().expect("ERR_DAO_ID");

        let idx = self.tokens.len();
        let creator = env::predecessor_account_id();
        self.tokens.push(TokenState {
            token_id: token_id.clone(),
            creator,
            meta: meta.clone(),
            created_at: now_secs(),
            deployed: false,
            dao_id,
            dao_stage: DaoStage::Creating,
            dao_attempt: 0,
            v_near: cfg.virtual_near.0,
            v_tokens: cfg.virtual_tokens.0,
            sold: 0,
            real_near: 0,
            burned: 0,
            holders: 0,
            volume_near: 0,
            trade_count: 0,
            backing_near: 0,
            linear_shares: 0,
            principal_near: 0,
            creator_escrow: 0,
            creator_released: 0,
            grad_stage: GradStage::Curve,
            grad_busy: false,
            pool_id: None,
            lp_near: 0,
            lp_shares: 0,
            lp_meme_deposited: false,
            lp_linear_deposited: false,
            graduated_at: 0,
            total_locked: 0,
            total_weight: 0,
            alloc_tally: [0; BUCKETS],
            acc_reward_per_weight: 0,
            stakers: 0,
            epoch_index: 0,
            last_epoch_at: 0,
            epoch_busy: false,
            last_linear_price: 0,
            tokens_in_flight: 0,
            owed_tokens: 0,
            agent_account: cfg.default_agent.clone(),
            agent_persona: persona,
            agent_budget_shares: 0,
            post_count: 0,
        });
        self.token_index.insert(token_id.clone(), idx);

        let costs = cfg.dao_deposit.as_yoctonear() + cfg.token_account_deposit.as_yoctonear();
        self.platform_fees += deposit.saturating_sub(costs);

        let init = json!({
            "owner_id": me,
            "total_supply": cfg.total_supply,
            "metadata": {
                "spec": "ft-1.0.0",
                "name": meta.name,
                "symbol": meta.symbol,
                "icon": meta.icon,
                "reference": null,
                "reference_hash": null,
                "decimals": 18
            }
        });
        Promise::new(token_id.clone())
            .create_account()
            .transfer(cfg.token_account_deposit)
            .use_global_contract_by_account_id(cfg.token_code_account.clone())
            .function_call(
                "new".to_string(),
                near_sdk::serde_json::to_vec(&init).unwrap(),
                NearToken::from_yoctonear(0),
                tgas(20),
            )
            .then(Self::ext(me).with_static_gas(tgas(10)).on_token_deployed(idx)).detach();

        self.internal_create_dao(idx);
        token_id
    }

    #[private]
    pub fn on_token_deployed(&mut self, idx: u32, #[callback_result] r: Result<(), PromiseError>) {
        let tok = self.tok_mut(idx);
        if r.is_ok() {
            tok.deployed = true;
        } else {
            env::log_str(&format!("token deploy failed for {}", tok.token_id));
        }
    }

    /// Buy on the bonding curve. Attach NEAR; first buy of a token also pays
    /// 0.00125 NEAR storage. Excess past the graduation cap is refunded.
    #[payable]
    pub fn buy(&mut self, token_id: AccountId, min_tokens_out: U128) -> U128 {
        let idx = self.idx_of(&token_id);
        let cfg = self.config.clone();
        let buyer = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let now = now_secs();
        {
            let tok = self.tok(idx);
            require!(tok.deployed, "ERR_NOT_DEPLOYED");
            require!(tok.grad_stage == GradStage::Curve, "ERR_CURVE_CLOSED");
        }
        let key = (idx, buyer.clone());
        let new_holder = !self.known_holders.contains_key(&key);
        let storage_fee = if new_holder { STORAGE_FEE } else { 0 };
        require!(
            deposit >= storage_fee + cfg.min_trade.as_yoctonear(),
            "ERR_BELOW_MIN_TRADE"
        );
        let gross = deposit - storage_fee;
        let mut fee = bps(gross, cfg.trade_fee_bps as u128);
        let mut used = gross - fee;
        let mut refund = 0u128;

        let (v_near, v_tokens, sold, created_at) = {
            let t = self.tok(idx);
            (t.v_near, t.v_tokens, t.sold, t.created_at)
        };
        let remaining = cfg.curve_supply.0 - sold;
        let mut out = math::curve_tokens_out(v_near, v_tokens, used);
        if out >= remaining {
            out = remaining;
            used = math::curve_near_for_tokens(v_near, v_tokens, out);
            fee = bps(used, cfg.trade_fee_bps as u128);
            refund = gross - used - fee;
        }
        require!(out > 0 && out >= min_tokens_out.0, "ERR_SLIPPAGE");

        if now < created_at + cfg.snipe_window_secs {
            let b = self.snipe_bought.get(&key).copied().unwrap_or(0) + out;
            require!(b <= cfg.snipe_max_tokens.0, "ERR_LAUNCH_WALLET_CAP");
            self.snipe_bought.insert(key.clone(), b);
        }
        if new_holder {
            self.known_holders.insert(key, true);
        }

        let creator_fee;
        {
            let tok = self.tok_mut(idx);
            tok.v_near += used;
            tok.v_tokens -= out;
            tok.sold += out;
            tok.real_near += used;
            tok.volume_near += used;
            tok.tokens_in_flight += out;
            if new_holder {
                tok.holders += 1;
            }
            let vault = bps(fee, cfg.fee_vault_bps as u128);
            creator_fee = bps(fee, cfg.fee_creator_bps as u128);
            tok.backing_near += vault;
            tok.creator_escrow += creator_fee;
            self.platform_fees += fee - vault - creator_fee;
        }
        let (vn, vt) = (self.tok(idx).v_near, self.tok(idx).v_tokens);
        self.record_trade(
            idx,
            Trade {
                ts: now,
                account: buyer.clone(),
                is_buy: true,
                near: U128(used),
                tokens: U128(out),
                v_near: U128(vn),
                v_tokens: U128(vt),
            },
        );
        if self.tok(idx).sold == cfg.curve_supply.0 {
            self.enter_graduation(idx);
        }

        let me = env::current_account_id();
        let deliver = ext_ft::ext(token_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(10))
            .ft_transfer(buyer.clone(), U128(out), Some("floorpad buy".into()));
        let deliver = if storage_fee > 0 {
            ext_ft::ext(token_id)
                .with_attached_deposit(NearToken::from_yoctonear(storage_fee))
                .with_static_gas(tgas(10))
                .storage_deposit(Some(buyer.clone()), Some(true))
                .then(deliver)
        } else {
            deliver
        };
        deliver.then(
            Self::ext(me)
                .with_static_gas(tgas(10))
                .on_tokens_delivered(idx, buyer.clone(), U128(out)),
        ).detach();
        if refund > 0 {
            Promise::new(buyer).transfer(NearToken::from_yoctonear(refund)).detach();
        }
        U128(out)
    }

    /// Settles an outgoing meme-token transfer; on failure the tokens become claimable.
    #[private]
    pub fn on_tokens_delivered(
        &mut self,
        idx: u32,
        account: AccountId,
        amount: U128,
        #[callback_result] r: Result<(), PromiseError>,
    ) {
        let tok = self.tok_mut(idx);
        tok.tokens_in_flight = tok.tokens_in_flight.saturating_sub(amount.0);
        if r.is_err() {
            tok.owed_tokens += amount.0;
            let key = (idx, account);
            let cur = self.pending_tokens.get(&key).copied().unwrap_or(0);
            self.pending_tokens.insert(key, cur + amount.0);
        }
    }

    /// Retry delivery of tokens whose transfer failed (e.g. missing storage).
    pub fn claim_tokens(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let account = env::predecessor_account_id();
        let key = (idx, account.clone());
        let amount = self.pending_tokens.remove(&key).expect("ERR_NOTHING_OWED");
        let tok = self.tok_mut(idx);
        tok.owed_tokens -= amount;
        tok.tokens_in_flight += amount;
        ext_ft::ext(token_id)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(10))
            .ft_transfer(account.clone(), U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(10))
                    .on_tokens_delivered(idx, account, U128(amount)),
            )
    }

    #[private]
    pub fn on_sell_age(
        &mut self,
        idx: u32,
        seller: AccountId,
        amount: U128,
        min_near_out: U128,
        #[callback_result] since: Result<Option<U64>, PromiseError>,
    ) -> U128 {
        let cfg = self.config.clone();
        let now = now_secs();
        if self.tok(idx).grad_stage != GradStage::Curve {
            return amount; // refund: curve closed meanwhile
        }
        let age = since.ok().flatten().map(|s| now.saturating_sub(s.0)).unwrap_or(0);
        let (v_near, v_tokens) = (self.tok(idx).v_near, self.tok(idx).v_tokens);
        let gross = math::curve_near_out(v_near, v_tokens, amount.0);
        let fee = bps(gross, cfg.trade_fee_bps as u128);
        let exit = bps(
            gross,
            math::exit_fee_bps(cfg.max_exit_fee_bps as u128, cfg.exit_decay_secs, age),
        );
        let net = gross - fee - exit;
        if net < min_near_out.0 || net == 0 || gross > self.tok(idx).real_near {
            return amount;
        }
        {
            let tok = self.tok_mut(idx);
            tok.v_near -= gross;
            tok.v_tokens += amount.0;
            tok.sold -= amount.0;
            tok.real_near -= gross;
            tok.volume_near += gross;
            let vault = bps(fee, cfg.fee_vault_bps as u128);
            let creator = bps(fee, cfg.fee_creator_bps as u128);
            tok.backing_near += vault + exit;
            tok.creator_escrow += creator;
            self.platform_fees += fee - vault - creator;
        }
        let (vn, vt) = (self.tok(idx).v_near, self.tok(idx).v_tokens);
        self.record_trade(
            idx,
            Trade {
                ts: now,
                account: seller.clone(),
                is_buy: false,
                near: U128(gross),
                tokens: amount,
                v_near: U128(vn),
                v_tokens: U128(vt),
            },
        );
        Promise::new(seller).transfer(NearToken::from_yoctonear(net)).detach();
        U128(0)
    }
}

impl Contract {
    pub(crate) fn start_sell(
        &mut self,
        idx: u32,
        seller: AccountId,
        amount: u128,
        min_near_out: u128,
    ) -> PromiseOrValue<U128> {
        require!(self.tok(idx).grad_stage == GradStage::Curve, "ERR_CURVE_CLOSED");
        let token_id = self.tok(idx).token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(5))
            .ft_holding_since(seller.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(15))
                    .on_sell_age(idx, seller, U128(amount), U128(min_near_out)),
            )
            .into()
    }
}
