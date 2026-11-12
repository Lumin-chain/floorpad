//! Floorpad meme token.
//!
//! A NEP-141 token with:
//! * `ft_holding_since` – weighted-average acquisition timestamp per holder,
//!   used for the decaying quick-flip exit fee both on the bonding curve,
//!   in the floor vault, and on post-graduation DEX pair sells.
//! * `burn` – owner (launchpad) can burn tokens it holds (redemptions, buybacks, tax burns).
//! * Pair-targeted DEX tax (`pairs` + `exempt` + `pending_platform` / `pending_tax`) –
//!   normal wallet-to-wallet transfers stay 0% tax, while swaps touching a registered
//!   DEX contract (e.g. `v2.ref-finance.near`) pay the permanent 1% platform fee plus
//!   any active decaying creator/DAO token tax.

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
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

const BPS: u128 = 10_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Ft,
    Metadata,
    Since,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct TaxConfig {
    pub platform_fee_bps: u16,
    pub buy_tax_bps: u16,
    pub sell_tax_bps: u16,
    pub max_exit_fee_bps: u16,
    pub decay_secs: u64,
    pub tax_start_at: u64,
}

#[near(serializers = [json])]
pub struct TaxView {
    pub config: TaxConfig,
    pub decay_active: bool,
    pub pairs: Vec<AccountId>,
    pub exempt: Vec<AccountId>,
    pub pending_platform: U128,
    pub pending_tax: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
    /// Weighted-average acquisition time (seconds) per holder.
    holding_since: LookupMap<AccountId, u64>,
    tax: TaxConfig,
    pairs: Vec<AccountId>,
    exempt: Vec<AccountId>,
    pending_platform: u128,
    pending_tax: u128,
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn bps(amount: u128, b: u16) -> u128 {
    if b == 0 || amount == 0 {
        return 0;
    }
    amount.saturating_mul(b as u128) / BPS
}

fn exit_fee_bps(max_bps: u16, decay_secs: u64, age_secs: u64) -> u16 {
    if max_bps == 0 || decay_secs == 0 || age_secs >= decay_secs {
        return 0;
    }
    let rem = (decay_secs - age_secs) as u128;
    ((max_bps as u128 * rem) / (decay_secs as u128)) as u16
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        total_supply: U128,
        metadata: FungibleTokenMetadata,
        tax: Option<TaxConfig>,
    ) -> Self {
        metadata.assert_valid();
        let me = env::current_account_id();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Ft),
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            owner_id: owner_id.clone(),
            holding_since: LookupMap::new(StorageKey::Since),
            tax: tax.unwrap_or_default(),
            pairs: Vec::new(),
            exempt: vec![owner_id.clone(), me.clone()],
            pending_platform: 0,
            pending_tax: 0,
        };
        this.token.internal_register_account(&me);
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

    /// Owner (launchpad) registers a DEX contract (e.g. `v2.ref-finance.near`) as a taxed pair.
    pub fn tax_add_pair(&mut self, pair: AccountId) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
        if !self.pairs.contains(&pair) {
            self.pairs.push(pair);
        }
    }

    /// Owner (launchpad, via DAO vote) updates the token's tax & decay policy.
    pub fn set_tax_policy(
        &mut self,
        buy_tax_bps: u16,
        sell_tax_bps: u16,
        max_exit_fee_bps: u16,
        decay_secs: u64,
    ) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
        require!(buy_tax_bps <= 300 && sell_tax_bps <= 500 && max_exit_fee_bps <= 500, "ERR_TAX_BOUNDS");
        require!(decay_secs <= 30 * 86_400, "ERR_DECAY_BOUNDS");
        self.tax.buy_tax_bps = buy_tax_bps;
        self.tax.sell_tax_bps = sell_tax_bps;
        self.tax.max_exit_fee_bps = max_exit_fee_bps;
        self.tax.decay_secs = decay_secs;
    }

    /// Owner (launchpad) claims accrued `(pending_platform, pending_tax)` tokens to swap & distribute.
    pub fn tax_take(&mut self) -> (U128, U128) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
        let p = self.pending_platform;
        let t = self.pending_tax;
        let total = p + t;
        if total > 0 {
            self.pending_platform = 0;
            self.pending_tax = 0;
            let me = env::current_account_id();
            self.token
                .internal_transfer(&me, &self.owner_id, total, Some("floorpad tax take".into()));
        }
        (U128(p), U128(t))
    }

    pub fn get_tax(&self) -> TaxView {
        TaxView {
            config: self.tax.clone(),
            decay_active: self.decay_active(),
            pairs: self.pairs.clone(),
            exempt: self.exempt.clone(),
            pending_platform: U128(self.pending_platform),
            pending_tax: U128(self.pending_tax),
        }
    }

    /// Weighted-average time (unix seconds) at which `account_id` acquired its balance.
    /// `None` if the account never received tokens.
    pub fn ft_holding_since(&self, account_id: AccountId) -> Option<U64> {
        self.holding_since.get(&account_id).map(|s| U64(*s))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    fn decay_active(&self) -> bool {
        self.tax.decay_secs > 0 && now_secs() < self.tax.tax_start_at.saturating_add(self.tax.decay_secs)
    }

    fn is_exempt(&self, id: &AccountId) -> bool {
        id == &self.owner_id || id == &env::current_account_id() || self.exempt.contains(id)
    }

    /// Computes `(platform_fee, token_tax)` for a transfer between `sender` and `receiver`.
    fn compute_pair_tax(&self, sender: &AccountId, receiver: &AccountId, amount: u128) -> (u128, u128) {
        if amount == 0 || self.is_exempt(sender) || self.is_exempt(receiver) {
            return (0, 0);
        }
        let from_pair = self.pairs.contains(sender);
        let to_pair = self.pairs.contains(receiver);
        if !from_pair && !to_pair {
            return (0, 0);
        }
        let plat = bps(amount, self.tax.platform_fee_bps);
        let tok_tax = if !self.decay_active() {
            0
        } else if to_pair && !from_pair {
            // DEX sell: base sell tax + decaying quick-flip exit fee
            let age = self
                .holding_since
                .get(sender)
                .map(|s| now_secs().saturating_sub(*s))
                .unwrap_or(0);
            let exit_bps = exit_fee_bps(self.tax.max_exit_fee_bps, self.tax.decay_secs, age);
            bps(amount, self.tax.sell_tax_bps) + bps(amount, exit_bps)
        } else {
            // DEX buy
            bps(amount, self.tax.buy_tax_bps)
        };
        let max_total = amount.saturating_sub(1);
        let total = (plat + tok_tax).min(max_total);
        let plat_clamped = plat.min(total);
        (plat_clamped, total - plat_clamped)
    }

    fn collect_tax(&mut self, sender: &AccountId, plat: u128, tok_tax: u128) {
        let total = plat + tok_tax;
        if total == 0 {
            return;
        }
        let me = env::current_account_id();
        self.token
            .internal_transfer(sender, &me, total, Some("floorpad dex tax".into()));
        self.pending_platform += plat;
        self.pending_tax += tok_tax;
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
        let sender = env::predecessor_account_id();
        let (plat, tok_tax) = self.compute_pair_tax(&sender, &receiver_id, amount.0);
        if plat + tok_tax > 0 {
            near_sdk::assert_one_yocto();
            let net = amount.0 - plat - tok_tax;
            self.collect_tax(&sender, plat, tok_tax);
            self.touch_receive(&receiver_id, net);
            self.token.internal_transfer(&sender, &receiver_id, net, memo);
        } else {
            self.touch_receive(&receiver_id, amount.0);
            self.token.ft_transfer(receiver_id, amount, memo);
        }
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let sender = env::predecessor_account_id();
        let (plat, tok_tax) = self.compute_pair_tax(&sender, &receiver_id, amount.0);
        if plat + tok_tax > 0 {
            near_sdk::assert_one_yocto();
            let net = amount.0 - plat - tok_tax;
            self.collect_tax(&sender, plat, tok_tax);
            self.touch_receive(&receiver_id, net);
            self.token.ft_transfer_call(receiver_id, U128(net), memo, msg)
        } else {
            self.touch_receive(&receiver_id, amount.0);
            self.token.ft_transfer_call(receiver_id, amount, memo, msg)
        }
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
            .current_account_id(accounts(5))
            .predecessor_account_id(pred)
            .block_timestamp(ts_secs * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }

    #[test]
    fn holding_age_is_weighted() {
        ctx(accounts(0), 1000, 0);
        let mut c = Contract::new(accounts(0), U128(1_000), meta(), None);
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
        let mut c = Contract::new(accounts(0), U128(1_000), meta(), None);
        c.burn(U128(400));
        assert_eq!(c.ft_total_supply(), U128(600));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn others_cannot_burn() {
        ctx(accounts(0), 1, 0);
        let mut c = Contract::new(accounts(0), U128(1_000), meta(), None);
        ctx(accounts(1), 1, 0);
        c.burn(U128(1));
    }

    #[test]
    fn pair_tax_applies_only_to_registered_dex_and_respects_decay() {
        let tax = TaxConfig {
            platform_fee_bps: 100, // 1%
            buy_tax_bps: 50,       // 0.5%
            sell_tax_bps: 100,     // 1%
            max_exit_fee_bps: 300, // 3%
            decay_secs: 30 * 86_400,
            tax_start_at: 1000,
        };
        ctx(accounts(0), 1000, 0);
        let mut c = Contract::new(accounts(0), U128(1_000_000), meta(), Some(tax));
        // accounts(2) = DEX pair, accounts(1) = trader, accounts(3) = friend
        c.tax_add_pair(accounts(2));
        for a in [accounts(1), accounts(2), accounts(3)] {
            ctx(a, 1000, 10u128.pow(23));
            c.storage_deposit(None, None);
        }
        // Seed DEX with 100_000 (owner is exempt -> 0 tax)
        ctx(accounts(0), 1000, 1);
        c.ft_transfer(accounts(2), U128(100_000), None);
        assert_eq!(c.get_tax().pending_platform.0, 0);

        // DEX buy: pair -> trader (10_000 tokens): 1% platform (100) + 0.5% buy (50) = 9_850 net
        ctx(accounts(2), 1000, 1);
        c.ft_transfer(accounts(1), U128(10_000), None);
        assert_eq!(c.ft_balance_of(accounts(1)).0, 9_850);
        assert_eq!(c.get_tax().pending_platform.0, 100);
        assert_eq!(c.get_tax().pending_tax.0, 50);

        // Plain wallet transfer: trader -> friend (1_000 tokens): 0 tax!
        ctx(accounts(1), 1000, 1);
        c.ft_transfer(accounts(3), U128(1_000), None);
        assert_eq!(c.ft_balance_of(accounts(3)).0, 1_000);

        // DEX sell at t=1000 (age=0): trader -> pair (1_000 tokens): 1% plat (10) + 1% sell (10) + 3% exit (30) = 50 total
        ctx(accounts(1), 1000, 1);
        c.ft_transfer(accounts(2), U128(1_000), None);
        assert_eq!(c.get_tax().pending_platform.0, 110);
        assert_eq!(c.get_tax().pending_tax.0, 90);

        // After 30-day decay expires: only 1% platform fee applies
        ctx(accounts(1), 1000 + 30 * 86_400, 1);
        c.ft_transfer(accounts(2), U128(1_000), None);
        assert_eq!(c.get_tax().pending_platform.0, 120);
        assert_eq!(c.get_tax().pending_tax.0, 90);

        // Owner claims pending taxes
        ctx(accounts(0), 1000 + 30 * 86_400, 0);
        let (p, t) = c.tax_take();
        assert_eq!((p.0, t.0), (120, 90));
        assert_eq!(c.get_tax().pending_platform.0, 0);
        assert_eq!(c.get_tax().pending_tax.0, 0);
    }
}
