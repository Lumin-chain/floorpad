//! Which liquid staking token backs each meme token.
//!
//! Tokens launched before the switch keep LiNEAR (`config.linear`): their Rhea LP is locked
//! forever, so it can't move. New launches use the launchpad's launch staking token (stNEAR from
//! Meta Pool), which holders can turn into NEAR instantly. Two kinds of staking contract:
//!   * LiNEAR-style (LiNEAR, rNEAR): price `ft_price`.
//!   * Meta Pool (stNEAR): price `get_st_near_price`, and at least 1 NEAR per stake.
//! Both stake with `deposit_and_stake` (returns the shares minted) and are NEP-141 tokens.
//!
//! Everything lives under its own storage keys, so `TokenState` and `Config` keep their layout.
use crate::curve::ONE_YOCTO;
use crate::ext::{ext_ft, tgas};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::borsh::{self, BorshDeserialize};
use near_sdk::{Promise, PromiseError};

pub const KIND_LINEAR: u8 = 0;
pub const KIND_META: u8 = 1;
/// Meta Pool refuses stakes below 1 NEAR.
pub const META_MIN_STAKE: u128 = 1_000_000_000_000_000_000_000_000;

fn k(prefix: &[u8], rest: &[u8]) -> Vec<u8> {
    let mut v = prefix.to_vec();
    v.extend_from_slice(rest);
    v
}
/// token idx -> staking token (absent = LiNEAR)
fn asset_key(idx: u32) -> Vec<u8> {
    k(b"g:sa", &idx.to_le_bytes())
}
/// staking token -> kind
fn kind_key(asset: &AccountId) -> Vec<u8> {
    k(b"g:sk", asset.as_bytes())
}
/// the staking token new launches use
const LAUNCH_KEY: &[u8] = b"g:sdef";
/// staking tokens other than LiNEAR that were ever used (for withdrawals)
const ALL_KEY: &[u8] = b"g:sall";
/// claimable balance of a non-LiNEAR staking token
fn claim_key(asset: &AccountId, account: &AccountId) -> Vec<u8> {
    let mut v = b"g:cl".to_vec();
    v.extend_from_slice(asset.as_bytes());
    v.push(0);
    v.extend_from_slice(account.as_bytes());
    v
}

fn read_account(v: Vec<u8>) -> AccountId {
    String::from_utf8(v).expect("ERR_ASSET").parse().expect("ERR_ASSET")
}

impl Contract {
    /// The staking token backing token `idx`.
    pub(crate) fn asset(&self, idx: u32) -> AccountId {
        env::storage_read(&asset_key(idx)).map(read_account).unwrap_or_else(|| self.config.linear.clone())
    }

    pub(crate) fn asset_kind(&self, asset: &AccountId) -> u8 {
        if *asset == self.config.linear {
            return KIND_LINEAR;
        }
        env::storage_read(&kind_key(asset)).and_then(|v| v.first().copied()).unwrap_or(KIND_LINEAR)
    }

    /// Staking token for new launches (LiNEAR until one is set).
    pub(crate) fn launch_asset(&self) -> AccountId {
        env::storage_read(LAUNCH_KEY).map(read_account).unwrap_or_else(|| self.config.linear.clone())
    }

    /// Called when a token is created: it keeps the launch staking token for life.
    pub(crate) fn assign_launch_asset(&mut self, idx: u32) {
        let a = self.launch_asset();
        if a != self.config.linear {
            env::storage_write(&asset_key(idx), a.as_bytes());
        }
    }

    pub(crate) fn other_assets(&self) -> Vec<AccountId> {
        env::storage_read(ALL_KEY)
            .map(|v| Vec::<String>::try_from_slice(&v).expect("ERR_ASSET"))
            .unwrap_or_default()
            .into_iter()
            .map(|s| s.parse().expect("ERR_ASSET"))
            .collect()
    }

    /// NEAR per share of `asset`, scaled 1e24 (the price call differs between kinds).
    pub(crate) fn stake_price(&self, asset: &AccountId) -> Promise {
        let method = if self.asset_kind(asset) == KIND_META { "get_st_near_price" } else { "ft_price" };
        Promise::new(asset.clone()).function_call(method.to_string(), b"{}".to_vec(), NearToken::from_yoctonear(0), tgas(5))
    }

    /// Credit `shares` of token `idx`'s staking token to `account` (withdrawn with `withdraw_linear`).
    pub(crate) fn credit_stake(&mut self, idx: u32, account: &AccountId, shares: u128) {
        let asset = self.asset(idx);
        self.credit_asset(&asset, account, shares);
    }

    pub(crate) fn credit_asset(&mut self, asset: &AccountId, account: &AccountId, shares: u128) {
        if shares == 0 {
            return;
        }
        if *asset == self.config.linear {
            self.credit_linear(account, shares);
            return;
        }
        let key = claim_key(asset, account);
        let cur = env::storage_read(&key).map(|v| u128::from_le_bytes(v.try_into().unwrap())).unwrap_or(0);
        env::storage_write(&key, &(cur + shares).to_le_bytes());
    }

    fn claimable_of(&self, asset: &AccountId, account: &AccountId) -> u128 {
        if *asset == self.config.linear {
            return self.claimable_linear.get(account).copied().unwrap_or(0);
        }
        env::storage_read(&claim_key(asset, account)).map(|v| u128::from_le_bytes(v.try_into().unwrap())).unwrap_or(0)
    }

    fn take_claimable(&mut self, asset: &AccountId, account: &AccountId) -> u128 {
        if *asset == self.config.linear {
            return self.claimable_linear.remove(account).unwrap_or(0);
        }
        let key = claim_key(asset, account);
        let v = self.claimable_of(asset, account);
        env::storage_remove(&key);
        v
    }
}

#[near]
impl Contract {
    /// Launchpad account only: new launches stake into `token` (`kind` 0 = LiNEAR-style,
    /// 1 = Meta Pool). Tokens already launched keep the staking token they launched with.
    #[private]
    pub fn set_launch_stake_token(&mut self, token: AccountId, kind: u8) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_NOT_LAUNCHPAD");
        require!(kind == KIND_LINEAR || kind == KIND_META, "ERR_KIND");
        if token != self.config.linear {
            env::storage_write(&kind_key(&token), &[kind]);
            let mut all: Vec<String> = self.other_assets().into_iter().map(|a| a.to_string()).collect();
            if !all.contains(&token.to_string()) {
                all.push(token.to_string());
                env::storage_write(ALL_KEY, &borsh::to_vec(&all).expect("ERR_ASSET"));
            }
        }
        env::storage_write(LAUNCH_KEY, token.as_bytes());
        env::log_str(&format!("new launches stake into {token}"));
    }

    /// Staking token new launches use.
    pub fn get_launch_stake_token(&self) -> AccountId {
        self.launch_asset()
    }

    /// Staking token backing `token_id` (its floor vault and Rhea pool pair).
    pub fn get_stake_token(&self, token_id: AccountId) -> AccountId {
        self.asset(self.idx_of(&token_id))
    }

    /// Everything `account_id` can withdraw with `withdraw_linear`, per staking token.
    pub fn get_claimable(&self, account_id: AccountId) -> Vec<(AccountId, U128)> {
        std::iter::once(self.config.linear.clone())
            .chain(self.other_assets())
            .map(|a| {
                let v = self.claimable_of(&a, &account_id);
                (a, U128(v))
            })
            .filter(|(_, v)| v.0 > 0)
            .collect()
    }

    /// Withdraw all claimable staking tokens (redemptions, airdrops, agent pay, refunds): LiNEAR
    /// and stNEAR alike. The receiver must be registered on each token contract.
    #[payable]
    pub fn withdraw_linear(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let me = env::current_account_id();
        let mut out: Option<Promise> = None;
        for asset in std::iter::once(self.config.linear.clone()).chain(self.other_assets()) {
            let amount = self.take_claimable(&asset, &account);
            if amount == 0 {
                continue;
            }
            let p = ext_ft::ext(asset.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(10))
                .ft_transfer(account.clone(), U128(amount), Some("floorpad".into()))
                .then(Self::ext(me.clone()).with_static_gas(tgas(5)).on_linear_sent(account.clone(), U128(amount), Some(asset)));
            out = Some(match out {
                None => p,
                Some(prev) => prev.and(p),
            });
        }
        out.unwrap_or_else(|| env::panic_str("ERR_NOTHING_TO_WITHDRAW"))
    }

    /// Re-credits the staking token if a transfer out failed (`asset` absent = LiNEAR).
    #[private]
    pub fn on_linear_sent(
        &mut self,
        account: AccountId,
        amount: U128,
        asset: Option<AccountId>,
        #[callback_result] r: Result<(), PromiseError>,
    ) {
        if r.is_err() {
            let asset = asset.unwrap_or_else(|| self.config.linear.clone());
            self.credit_asset(&asset, &account, amount.0);
        }
    }
}
