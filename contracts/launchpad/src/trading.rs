//! Instant trading account (pro console).
//!
//! Wallet trades need a wallet confirmation each time. For a pro console the user
//! deposits NEAR once into a trading account and adds a *function-call access key*
//! limited to `quick_buy` / `quick_sell` on this contract. Those two methods are
//! non-payable and fully synchronous (no cross-contract calls), so a session key
//! can trade instantly while it can never withdraw: withdrawals need the wallet
//! (1 yoctoNEAR, which function-call keys cannot attach).
//!
//! Tokens bought this way sit in custody here until withdrawn to the wallet.
//! Custody tracks its own weighted holding age, so the decaying exit fee applies
//! exactly as for wallet holders. Same curve, fees, referrals and anti-snipe caps.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, tgas};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::Promise;

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Custody {
    pub amount: U128,
    /// weighted-average acquisition time (secs)
    pub since: u64,
}

#[near(serializers = [json])]
pub struct TradingAccount {
    pub near: U128,
}

#[near]
impl Contract {
    /// Deposit NEAR into the instant-trading account.
    #[payable]
    pub fn deposit_trading(&mut self) -> U128 {
        let a = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ERR_ZERO");
        let bal = self.trading_near.get(&a).copied().unwrap_or(0) + amount;
        self.trading_near.insert(a, bal);
        U128(bal)
    }

    /// Withdraw NEAR from the trading account. Needs the wallet (1 yoctoNEAR).
    #[payable]
    pub fn withdraw_trading(&mut self, amount: Option<U128>) -> Promise {
        near_sdk::assert_one_yocto();
        let a = env::predecessor_account_id();
        let bal = self.trading_near.get(&a).copied().unwrap_or(0);
        let amt = amount.map(|x| x.0).unwrap_or(bal);
        require!(amt > 0 && amt <= bal, "ERR_AMOUNT");
        self.trading_near.insert(a.clone(), bal - amt);
        Promise::new(a).transfer(NearToken::from_yoctonear(amt))
    }

    /// Instant buy from the trading balance into custody. Non-payable: callable with a
    /// function-call key. Returns tokens bought.
    pub fn quick_buy(
        &mut self,
        token_id: AccountId,
        near_in: U128,
        min_tokens_out: U128,
        referrer: Option<AccountId>,
    ) -> U128 {
        let idx = self.idx_of(&token_id);
        let buyer = env::predecessor_account_id();
        let bal = self.trading_near.get(&buyer).copied().unwrap_or(0);
        require!(near_in.0 > 0 && near_in.0 <= bal, "ERR_TRADING_BALANCE");
        let (out, refund) = self.curve_buy_core(idx, &buyer, near_in.0, min_tokens_out.0, referrer);
        self.trading_near.insert(buyer.clone(), bal - near_in.0 + refund);
        let key = (idx, buyer);
        let mut c = self.custody.get(&key).cloned().unwrap_or_default();
        let now = now_secs();
        c.since = if c.amount.0 == 0 {
            now
        } else {
            ((c.amount.0 * c.since as u128 + out * now as u128) / (c.amount.0 + out)) as u64
        };
        c.amount = U128(c.amount.0 + out);
        self.custody.insert(key, c);
        self.tok_mut(idx).custody_total += out;
        U128(out)
    }

    /// Instant sell from custody back to the curve; NEAR lands in the trading balance.
    /// Non-payable: callable with a function-call key. Returns NEAR received.
    pub fn quick_sell(
        &mut self,
        token_id: AccountId,
        amount: U128,
        min_near_out: U128,
        referrer: Option<AccountId>,
    ) -> U128 {
        let idx = self.idx_of(&token_id);
        let seller = env::predecessor_account_id();
        let key = (idx, seller.clone());
        let mut c = self.custody.get(&key).cloned().expect("ERR_NO_CUSTODY");
        require!(amount.0 > 0 && amount.0 <= c.amount.0, "ERR_AMOUNT");
        let age = now_secs().saturating_sub(c.since);
        let net = self
            .curve_sell_core(idx, &seller, amount.0, min_near_out.0, referrer, age)
            .unwrap_or_else(|| env::panic_str("ERR_SLIPPAGE_OR_CLOSED"));
        c.amount = U128(c.amount.0 - amount.0);
        self.custody.insert(key, c);
        self.tok_mut(idx).custody_total -= amount.0;
        let bal = self.trading_near.get(&seller).copied().unwrap_or(0) + net;
        self.trading_near.insert(seller, bal);
        U128(net)
    }

    /// Move custody tokens to the wallet (to lock, redeem, or trade on Ref). Needs the wallet.
    /// The wallet must be registered on the token (storage_deposit).
    #[payable]
    pub fn withdraw_custody(&mut self, token_id: AccountId, amount: Option<U128>) -> Promise {
        near_sdk::assert_one_yocto();
        let idx = self.idx_of(&token_id);
        let a = env::predecessor_account_id();
        let key = (idx, a.clone());
        let mut c = self.custody.get(&key).cloned().expect("ERR_NO_CUSTODY");
        let amt = amount.map(|x| x.0).unwrap_or(c.amount.0);
        require!(amt > 0 && amt <= c.amount.0, "ERR_AMOUNT");
        c.amount = U128(c.amount.0 - amt);
        self.custody.insert(key, c);
        let tok = self.tok_mut(idx);
        tok.custody_total -= amt;
        tok.tokens_in_flight += amt;
        ext_ft::ext(token_id)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(10))
            .ft_transfer(a.clone(), U128(amt), Some("floorpad custody withdrawal".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(10))
                    .on_tokens_delivered(idx, a, U128(amt)),
            )
    }

    pub fn get_trading_account(&self, account_id: AccountId) -> TradingAccount {
        TradingAccount { near: U128(self.trading_near.get(&account_id).copied().unwrap_or(0)) }
    }

    pub fn get_custody(&self, token_id: AccountId, account_id: AccountId) -> Custody {
        let idx = self.idx_of(&token_id);
        self.custody.get(&(idx, account_id)).cloned().unwrap_or_default()
    }
}

impl Contract {
    /// Shared curve buy: fees, anti-snipe, state, trade log, graduation trigger.
    /// Returns (tokens out, NEAR refund). Delivery is the caller's job.
    pub(crate) fn curve_buy_core(
        &mut self,
        idx: u32,
        buyer: &AccountId,
        gross: u128,
        min_tokens_out: u128,
        referrer: Option<AccountId>,
    ) -> (u128, u128) {
        let cfg = self.config.clone();
        let now = now_secs();
        {
            let tok = self.tok(idx);
            require!(tok.deployed, "ERR_NOT_DEPLOYED");
            require!(tok.grad_stage == GradStage::Curve, "ERR_CURVE_CLOSED");
        }
        require!(gross >= cfg.min_trade.as_yoctonear(), "ERR_BELOW_MIN_TRADE");
        let (v_near, v_tokens, sold, created_at, buy_tax_bps) = {
            let t = self.tok(idx);
            (t.v_near, t.v_tokens, t.sold, t.created_at, t.buy_tax_bps)
        };
        let mut plat = math::bps(gross, PLATFORM_FEE_BPS as u128);
        let mut tok_tax = math::bps(gross, buy_tax_bps as u128);
        let mut used = gross - plat - tok_tax;
        let mut refund = 0u128;
        let remaining = cfg.curve_supply.0 - sold;
        let mut out = math::curve_tokens_out(v_near, v_tokens, used);
        if out >= remaining {
            out = remaining;
            used = math::curve_near_for_tokens(v_near, v_tokens, out);
            plat = math::bps(used, PLATFORM_FEE_BPS as u128);
            tok_tax = math::bps(used, buy_tax_bps as u128);
            refund = gross - used - plat - tok_tax;
        }
        require!(out > 0 && out >= min_tokens_out, "ERR_SLIPPAGE");
        let key = (idx, buyer.clone());
        if now < created_at + cfg.snipe_window_secs {
            let b = self.snipe_bought.get(&key).copied().unwrap_or(0) + out;
            require!(b <= cfg.snipe_max_tokens.0, "ERR_LAUNCH_WALLET_CAP");
            self.snipe_bought.insert(key.clone(), b);
        }
        let new_holder = !self.known_holders.contains_key(&key);
        if new_holder {
            self.known_holders.insert(key, true);
        }
        {
            let tok = self.tok_mut(idx);
            tok.v_near += used;
            tok.v_tokens -= out;
            tok.sold += out;
            tok.real_near += used;
            tok.volume_near += used;
            if new_holder {
                tok.holders += 1;
            }
        }
        let referrer = referrer.filter(|r| r != buyer);
        self.distribute_trade_fees(idx, plat, tok_tax, referrer.as_ref());
        let (vn, vt) = (self.tok(idx).v_near, self.tok(idx).v_tokens);
        self.record_trade(
            idx,
            Trade { ts: now, account: buyer.clone(), is_buy: true, near: U128(used), tokens: U128(out), v_near: U128(vn), v_tokens: U128(vt) },
        );
        if self.tok(idx).sold == cfg.curve_supply.0 {
            self.enter_graduation(idx);
        }
        (out, refund)
    }

    /// Shared curve sell. Returns NEAR owed to the seller, or None if it must be refunded
    /// (curve closed, slippage). Payout is the caller's job.
    pub(crate) fn curve_sell_core(
        &mut self,
        idx: u32,
        seller: &AccountId,
        amount: u128,
        min_near_out: u128,
        referrer: Option<AccountId>,
        age: u64,
    ) -> Option<u128> {
        let now = now_secs();
        if self.tok(idx).grad_stage != GradStage::Curve {
            return None;
        }
        let (v_near, v_tokens, sell_tax_bps, max_exit_bps, decay_secs) = {
            let t = self.tok(idx);
            (t.v_near, t.v_tokens, t.sell_tax_bps, t.max_exit_fee_bps, t.exit_decay_secs)
        };
        let gross = math::curve_near_out(v_near, v_tokens, amount);
        let plat = math::bps(gross, PLATFORM_FEE_BPS as u128);
        let tok_tax = math::bps(gross, sell_tax_bps as u128);
        let exit = math::bps(gross, math::exit_fee_bps(max_exit_bps as u128, decay_secs, age));
        let net = gross - plat - tok_tax - exit;
        if net < min_near_out || net == 0 || gross > self.tok(idx).real_near {
            return None;
        }
        {
            let tok = self.tok_mut(idx);
            tok.v_near -= gross;
            tok.v_tokens += amount;
            tok.sold -= amount;
            tok.real_near -= gross;
            tok.volume_near += gross;
            tok.backing_near += exit;
        }
        let referrer = referrer.filter(|r| r != seller);
        self.distribute_trade_fees(idx, plat, tok_tax, referrer.as_ref());
        let (vn, vt) = (self.tok(idx).v_near, self.tok(idx).v_tokens);
        self.record_trade(
            idx,
            Trade { ts: now, account: seller.clone(), is_buy: false, near: U128(gross), tokens: U128(amount), v_near: U128(vn), v_tokens: U128(vt) },
        );
        Some(net)
    }
}

