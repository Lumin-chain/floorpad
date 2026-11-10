//! Floorpad meme token.
//!
//! A standard NEP-141 token with two additions:
//! * `ft_holding_since` – a weighted-average acquisition time per holder. The
//!   launchpad reads it to apply the decaying exit fee on curve sells and floor
//!   redemptions, so tokens bought anywhere (Ref, wallets, Intents) age the same way.
//! * `burn` – the launchpad (owner) can burn tokens it holds (redemptions, buybacks).
//!
//! There is no transfer tax: plain transfers stay fully composable.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LazyOption, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Ft,
    Metadata,
    Since,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
    /// Weighted-average acquisition time (seconds) per holder.
    holding_since: LookupMap<AccountId, u64>,
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128, metadata: FungibleTokenMetadata) -> Self {
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Ft),
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            owner_id: owner_id.clone(),
            holding_since: LookupMap::new(StorageKey::Since),
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.0);
        FtMint { owner_id: &owner_id, amount: total_supply, memo: Some("launch") }.emit();
        this
    }

    /// Burns `amount` from the owner's own balance.
    pub fn burn(&mut self, amount: U128) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
        self.token.internal_withdraw(&self.owner_id, amount.0);
        FtBurn { owner_id: &self.owner_id, amount, memo: Some("floorpad burn") }.emit();
    }

    /// Weighted-average time (unix seconds) at which `account_id` acquired its balance.
    /// `None` if the account never received tokens.
    pub fn ft_holding_since(&self, account_id: AccountId) -> Option<U64> {
        self.holding_since.get(&account_id).map(|s| U64(*s))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    fn touch_receive(&mut self, receiver: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let now = now_secs();
        let bal = self.token.accounts.get(receiver).unwrap_or(0);
        let since = match (bal, self.holding_since.get(receiver)) {
            (0, _) | (_, None) => now,
            (b, Some(s)) => {
                let weighted = (b * (*s as u128) + amount * (now as u128)) / (b + amount);
                weighted as u64
            }
        };
        self.holding_since.insert(receiver.clone(), since);
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.touch_receive(&receiver_id, amount.0);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.touch_receive(&receiver_id, amount.0);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        // Refunds go back without touching the sender's holding age.
        let (used, burned) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            FtBurn { owner_id: &sender_id, amount: U128(burned), memo: None }.emit();
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_contract_standards::fungible_token::metadata::FT_METADATA_SPEC;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn meta() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test".into(),
            symbol: "TST".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }

    fn ctx(pred: AccountId, ts_secs: u64, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred)
            .block_timestamp(ts_secs * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }

    #[test]
    fn holding_age_is_weighted() {
        ctx(accounts(0), 1000, 0);
        let mut c = Contract::new(accounts(0), U128(1_000), meta());
        ctx(accounts(1), 1000, 10u128.pow(23));
        c.storage_deposit(None, None);
        ctx(accounts(0), 1000, 1);
        c.ft_transfer(accounts(1), U128(100), None);
        assert_eq!(c.ft_holding_since(accounts(1)), Some(U64(1000)));
        ctx(accounts(0), 2000, 1);
        c.ft_transfer(accounts(1), U128(100), None);
        // 100 @1000 + 100 @2000 -> 1500
        assert_eq!(c.ft_holding_since(accounts(1)), Some(U64(1500)));
    }

    #[test]
    fn owner_can_burn() {
        ctx(accounts(0), 1, 0);
        let mut c = Contract::new(accounts(0), U128(1_000), meta());
        c.burn(U128(400));
        assert_eq!(c.ft_total_supply(), U128(600));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn others_cannot_burn() {
        ctx(accounts(0), 1, 0);
        let mut c = Contract::new(accounts(0), U128(1_000), meta());
        ctx(accounts(1), 1, 0);
        c.burn(U128(1));
    }
}
