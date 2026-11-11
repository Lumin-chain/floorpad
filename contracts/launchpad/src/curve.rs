//! Token creation and bonding-curve trading.
use crate::ext::{ext_ft, ext_ref, tgas};
use crate::math;
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
    /// Launches a token: reads NEAR/USD on-chain (Ref pool), deploys the NEP-141
    /// contract, creates its Sputnik DAO and opens the bonding curve.
    /// Attach `creation_fee` and 300 Tgas.
    #[payable]
    pub fn create_token(&mut self, meta: TokenMeta, agent_persona: Option<String>) -> PromiseOrValue<Option<AccountId>> {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.config.creation_fee.as_yoctonear(), "ERR_CREATION_FEE");
        let persona = self.validate_launch(&meta, &agent_persona);
        let creator = env::predecessor_account_id();
        match self.config.price_pool.clone() {
            None => {
                let v0 = self.launch_virtual_near();
                PromiseOrValue::Value(Some(self.internal_launch(creator, deposit, meta, persona, v0)))
            }
            Some(p) => ext_ref::ext(self.config.ref_exchange.clone())
                .with_static_gas(tgas(10))
                .get_return(p.pool_id, p.near_token, U128(math::PRICE_SCALE), p.usd_token)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(tgas(200))
                        .on_launch_price(creator, U128(deposit), meta, persona),
                )
                .into(),
        }
    }

    /// Permissionless: refresh the accepted NEAR/USD price from the Ref pool.
    pub fn refresh_near_usd_price(&mut self) -> Promise {
        let p = self.config.price_pool.clone().expect("ERR_NO_PRICE_POOL");
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_static_gas(tgas(10))
            .get_return(p.pool_id, p.near_token, U128(math::PRICE_SCALE), p.usd_token)
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(10)).on_price_quote())
    }

    #[private]
    pub fn on_price_quote(&mut self, #[callback_result] r: Result<U128, PromiseError>) -> U128 {
        let q = r.expect("ERR_PRICE_QUOTE");
        U128(self.accept_price(self.quote_to_micro_usd(q.0)))
    }

    #[private]
    pub fn on_launch_price(
        &mut self,
        creator: AccountId,
        deposit: U128,
        meta: TokenMeta,
        persona: String,
        #[callback_result] r: Result<U128, PromiseError>,
    ) -> Option<AccountId> {
        let token_id = self.token_account_for(&meta.symbol);
        let ok = r.as_ref().map(|q| q.0 > 0).unwrap_or(false);
        if !ok || self.token_index.contains_key(&token_id) {
            env::log_str("launch aborted (price unavailable or ticker taken); refunding");
            Promise::new(creator).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            return None;
        }
        self.accept_price(self.quote_to_micro_usd(r.unwrap().0));
        let v0 = self.launch_virtual_near();
        Some(self.internal_launch(creator, deposit.0, meta, persona, v0))
    }
}

impl Contract {
    fn token_account_for(&self, symbol: &str) -> AccountId {
        format!("{}.{}", symbol.to_lowercase(), env::current_account_id()).parse().expect("ERR_TOKEN_ID")
    }

    /// Ref `get_return` for 1 NEAR -> micro-USD per NEAR, grossed up by the pool fee.
    fn quote_to_micro_usd(&self, out: u128) -> u128 {
        let p = self.config.price_pool.as_ref().expect("ERR_NO_PRICE_POOL");
        let micro = math::mul_div(out, 1_000_000, 10u128.pow(p.usd_decimals as u32));
        math::mul_div(micro, math::BPS, math::BPS - p.pool_fee_bps as u128)
    }

    fn validate_launch(&self, meta: &TokenMeta, agent_persona: &Option<String>) -> String {
        let sym = meta.symbol.clone();
        require!(
            (2..=10).contains(&sym.len()) && sym.chars().all(|c| c.is_ascii_alphanumeric()),
            "ERR_SYMBOL"
        );
        require!(!meta.name.is_empty() && meta.name.len() <= 40, "ERR_NAME");
        require!(meta.description.len() <= 600, "ERR_DESCRIPTION");
        require!(meta.icon.as_ref().map_or(true, |i| i.len() <= MAX_ICON_LEN), "ERR_ICON_TOO_BIG");
        let persona = agent_persona.clone().unwrap_or_else(|| {
            format!("You are the voice of ${}. Be funny, upbeat and never give financial advice.", sym)
        });
        require!(persona.len() <= 1500, "ERR_PERSONA");
        require!(!self.token_index.contains_key(&self.token_account_for(&sym)), "ERR_TICKER_TAKEN");
        persona
    }

    pub(crate) fn internal_launch(
        &mut self,
        creator: AccountId,
        deposit: u128,
        meta: TokenMeta,
        persona: String,
        v0: u128,
    ) -> AccountId {
        let cfg = self.config.clone();
        let me = env::current_account_id();
        let sub = meta.symbol.to_lowercase();
        let token_id = self.token_account_for(&meta.symbol);
        let dao_id: AccountId = format!("{}-dao.{}", sub, me).parse().expect("ERR_DAO_ID");
        let idx = self.tokens.len();
        self.tokens.push(TokenState {
            token_id: token_id.clone(),
            creator,
            meta: meta.clone(),
            created_at: now_secs(),
            deployed: false,
            dao_id,
            dao_stage: DaoStage::Creating,
            dao_attempt: 0,
            v_near: v0,
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
            creator_claimable: 0,
            grad_mcap_usd: cfg.grad_mcap_usd,
            launch_near_usd: self.near_usd_micro,
            grad_stage: GradStage::Curve,
            grad_busy: false,
            pool_id: None,
            lp_near: 0,
            lp_shares: 0,
            lp_tokens: 0,
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
            custody_total: 0,
            mech_count: 0,
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
            .use_global_contract(cfg.token_code_hash)
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
}

#[near]
impl Contract {

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
    pub fn buy(&mut self, token_id: AccountId, min_tokens_out: U128, referrer: Option<AccountId>) -> U128 {
        let idx = self.idx_of(&token_id);
        let buyer = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let new_holder = !self.known_holders.contains_key(&(idx, buyer.clone()));
        let storage_fee = if new_holder { STORAGE_FEE } else { 0 };
        require!(deposit > storage_fee, "ERR_BELOW_MIN_TRADE");
        let (out, refund) = self.curve_buy_core(idx, &buyer, deposit - storage_fee, min_tokens_out.0, referrer);
        self.tok_mut(idx).tokens_in_flight += out;

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

    /// Referrers withdraw their share of platform fees.
    pub fn claim_referral_fees(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self.referral_balance.remove(&account).unwrap_or(0);
        require!(amount > 0, "ERR_NOTHING_TO_CLAIM");
        Promise::new(account).transfer(NearToken::from_yoctonear(amount))
    }

    /// Creator withdraws the instantly-claimable part of their fees.
    pub fn claim_creator_fees(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let tok = self.tok_mut(idx);
        require!(env::predecessor_account_id() == tok.creator, "ERR_NOT_CREATOR");
        let amount = tok.creator_claimable;
        require!(amount > 0, "ERR_NOTHING_TO_CLAIM");
        tok.creator_claimable = 0;
        tok.creator_released += amount;
        Promise::new(tok.creator.clone()).transfer(NearToken::from_yoctonear(amount))
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
        referrer: Option<AccountId>,
        #[callback_result] since: Result<Option<U64>, PromiseError>,
    ) -> U128 {
        let age = since.ok().flatten().map(|s| now_secs().saturating_sub(s.0)).unwrap_or(0);
        let Some(net) = self.curve_sell_core(idx, &seller, amount.0, min_near_out.0, referrer, age) else {
            return amount; // refund: curve closed meanwhile or slippage
        };
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
        referrer: Option<AccountId>,
    ) -> PromiseOrValue<U128> {
        require!(self.tok(idx).grad_stage == GradStage::Curve, "ERR_CURVE_CLOSED");
        let token_id = self.tok(idx).token_id.clone();
        ext_ft::ext(token_id)
            .with_static_gas(tgas(5))
            .ft_holding_since(seller.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(15))
                    .on_sell_age(idx, seller, U128(amount), U128(min_near_out), referrer),
            )
            .into()
    }
}
