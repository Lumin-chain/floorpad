//! Interfaces of the external contracts the launchpad drives.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::Value;
use near_sdk::{ext_contract, AccountId, Gas};

pub const fn tgas(n: u64) -> Gas {
    Gas::from_tgas(n)
}

/// Floorpad meme token + generic NEP-141/145 (LiNEAR, meme tokens).
#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_holding_since(&self, account_id: AccountId) -> Option<U64>;
    fn burn(&mut self, amount: U128);
    fn tax_add_pair(&mut self, pair: AccountId);
    fn set_tax_policy(
        &mut self,
        buy_tax_bps: u16,
        sell_tax_bps: u16,
        max_exit_fee_bps: u16,
        decay_secs: u64,
    );
    fn tax_take(&mut self) -> (U128, U128);
}

/// LiNEAR liquid staking (linear-protocol.near / linear-protocol.testnet).
#[allow(dead_code)]
#[ext_contract(ext_linear)]
pub trait ExtLinear {
    fn deposit_and_stake(&mut self) -> U128;
    fn ft_price(&self) -> U128;
}

/// Ref Finance exchange (v2.ref-finance.near / ref-finance-101.testnet).
#[allow(dead_code)]
#[ext_contract(ext_ref)]
pub trait ExtRef {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn register_tokens(&mut self, token_ids: Vec<AccountId>);
    fn add_simple_pool(&mut self, tokens: Vec<AccountId>, fee: u32) -> u64;
    fn get_return(&self, pool_id: u64, token_in: AccountId, amount_in: U128, token_out: AccountId) -> U128;
    fn add_liquidity(
        &mut self,
        pool_id: u64,
        amounts: Vec<U128>,
        min_amounts: Option<Vec<U128>>,
    ) -> U128;
    fn get_pool(&self, pool_id: u64) -> RefPoolInfo;
    fn get_pool_shares(&self, pool_id: u64, account_id: AccountId) -> U128;
    /// Proportional removal; the tokens land in the caller's Ref deposit.
    fn remove_liquidity(&mut self, pool_id: u64, shares: U128, min_amounts: Vec<U128>) -> Vec<U128>;
    fn withdraw(
        &mut self,
        token_id: AccountId,
        amount: U128,
        unregister: Option<bool>,
        skip_unwrap_near: Option<bool>,
    );
}

/// The fields of Ref's `get_pool` answer that the launchpad reads.
#[derive(near_sdk::serde::Serialize, near_sdk::serde::Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct RefPoolInfo {
    pub token_account_ids: Vec<AccountId>,
    pub amounts: Vec<U128>,
    pub shares_total_supply: U128,
}

/// Sputnik DAO v2 (deployed per token by the Sputnik factory).
#[allow(dead_code)]
#[ext_contract(ext_dao)]
pub trait ExtDao {
    fn add_proposal(&mut self, proposal: Value) -> u64;
    fn act_proposal(&mut self, id: u64, action: String, proposal: Value, memo: Option<String>);
    fn register_delegation(&mut self, account_id: AccountId);
    fn delegate(&mut self, account_id: AccountId, amount: U128) -> (U128, U128, U128);
    fn undelegate(&mut self, account_id: AccountId, amount: U128) -> (U128, U128, U128);
    fn get_staking_contract(&self) -> String;
}

