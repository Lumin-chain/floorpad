//! Side state kept under its own storage keys, so `TokenState`'s borsh layout (and therefore
//! the deployed contract's state) is unchanged: upgrading needs no migration.
//!
//! * **Reference pool price** per graduated token, used to price-check the protocol's own
//!   swaps (epoch buyback, DEX-tax harvest). It moves toward the observed Ref spot price by at
//!   most `max_price_move_bps_per_hour` per hour, so one manipulated block can't drag it.
//! * **Tax-harvest state**: meme tokens and LiNEAR moving through the tax swap, tracked exactly.
//! * **Lock-expiry buckets**: accounts grouped by the day their lock expires, so expired
//!   locks can lose their weight without enumerating every position.
use crate::math;
use crate::*;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};

/// A protocol swap only runs if the pool's spot price is within this band of the reference.
pub const MAX_SWAP_DEVIATION_BPS: u128 = 1_000; // 10%
/// Minimum output below the quote (pool fee rounding and small moves between quote and swap).
pub const SWAP_SLIPPAGE_BPS: u128 = 300; // 3%
/// Largest protocol swap per call, as a share of the input-side pool reserve.
pub const MAX_SWAP_POOL_BPS: u128 = 500; // 5%

const DAY: u64 = 86_400;
/// Day buckets scanned per `process_expired_locks` call (bounds gas on empty stretches).
pub const MAX_EMPTY_DAYS_PER_CALL: u64 = 400;

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Default)]
#[borsh(crate = "near_sdk::borsh")]
pub struct RefPrice {
    /// LiNEAR (raw) per meme token (raw), scaled by `PRICE_SCALE`.
    pub price: u128,
    pub at: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Default, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct TaxState {
    pub busy: bool,
    /// Meme tokens held by the launchpad waiting to be swapped, split by origin.
    pub held_plat: u128,
    pub held_tax: u128,
    /// Meme tokens deposited in the launchpad's Ref account, waiting for `swap`.
    pub in_ref_plat: u128,
    pub in_ref_tax: u128,
    /// LiNEAR swapped and sitting in the launchpad's Ref account, waiting for `withdraw`,
    /// already split by destination.
    pub lin_plat: u128,
    pub lin_creator: u128,
    pub lin_vault: u128,
}

impl TaxState {
    pub fn held(&self) -> u128 {
        self.held_plat + self.held_tax
    }
    pub fn in_ref(&self) -> u128 {
        self.in_ref_plat + self.in_ref_tax
    }
    pub fn lin(&self) -> u128 {
        self.lin_plat + self.lin_creator + self.lin_vault
    }
}

fn key(tag: &[u8], idx: u32, extra: Option<u64>) -> Vec<u8> {
    let mut k = b"g:".to_vec();
    k.extend_from_slice(tag);
    k.extend_from_slice(&idx.to_le_bytes());
    if let Some(e) = extra {
        k.extend_from_slice(&e.to_le_bytes());
    }
    k
}

fn read<T: BorshDeserialize>(k: &[u8]) -> Option<T> {
    env::storage_read(k).map(|v| T::try_from_slice(&v).expect("ERR_SIDE_STATE"))
}

fn write<T: BorshSerialize>(k: &[u8], v: &T) {
    env::storage_write(k, &borsh::to_vec(v).expect("ERR_SIDE_STATE"));
}

impl Contract {
    // ---------- reference pool price ----------

    pub(crate) fn ref_price(&self, idx: u32) -> Option<RefPrice> {
        read(&key(b"rp", idx, None))
    }

    pub(crate) fn set_ref_price(&mut self, idx: u32, price: u128) {
        write(&key(b"rp", idx, None), &RefPrice { price, at: now_secs() });
    }

    /// Feed an observed pool spot price. The reference moves toward it by at most the configured
    /// hourly cap (first observation initialises it). Returns `(reference, spot)`.
    pub(crate) fn observe_pool_price(&mut self, idx: u32, r_lin: u128, r_meme: u128) -> Option<(u128, u128)> {
        if r_lin == 0 || r_meme == 0 {
            return None;
        }
        let spot = math::mul_div(r_lin, math::PRICE_SCALE, r_meme);
        let next = match self.ref_price(idx) {
            None => spot,
            Some(old) => {
                let elapsed = now_secs().saturating_sub(old.at) as u128;
                let allowed = (self.config.max_price_move_bps_per_hour as u128 * elapsed / 3600).clamp(0, 9_000);
                let lo = old.price * (math::BPS - allowed) / math::BPS;
                let hi = old.price * (math::BPS + allowed) / math::BPS;
                spot.clamp(lo, hi)
            }
        };
        self.set_ref_price(idx, next);
        Some((next, spot))
    }

    // ---------- tax harvest state ----------

    pub(crate) fn tax_state(&self, idx: u32) -> TaxState {
        read(&key(b"tx", idx, None)).unwrap_or_default()
    }

    pub(crate) fn set_tax_state(&mut self, idx: u32, s: &TaxState) {
        write(&key(b"tx", idx, None), s);
    }

    // ---------- lock expiry buckets ----------

    /// Queue `account` to lose its weight once its lock (ending `unlock_at`) expires.
    pub(crate) fn enqueue_lock_expiry(&mut self, idx: u32, account: &AccountId, unlock_at: u64) {
        let day = unlock_at.div_ceil(DAY);
        let k = key(b"lx", idx, Some(day));
        let mut list: Vec<AccountId> = read(&k).unwrap_or_default();
        if !list.contains(account) {
            list.push(account.clone());
            write(&k, &list);
        }
        let ck = key(b"lc", idx, None);
        let cursor: Option<u64> = read(&ck);
        if cursor.map_or(true, |c| day < c) {
            write(&ck, &day);
        }
    }

    pub(crate) fn lock_expiry_cursor(&self, idx: u32) -> Option<u64> {
        read(&key(b"lc", idx, None))
    }

    pub(crate) fn take_expiry_bucket(&mut self, idx: u32, day: u64) -> Vec<AccountId> {
        let k = key(b"lx", idx, Some(day));
        let list = read(&k).unwrap_or_default();
        env::storage_remove(&k);
        list
    }

    pub(crate) fn put_expiry_bucket(&mut self, idx: u32, day: u64, list: &Vec<AccountId>) {
        if !list.is_empty() {
            write(&key(b"lx", idx, Some(day)), list);
        }
    }

    pub(crate) fn has_expiry_bucket(&self, idx: u32, day: u64) -> bool {
        env::storage_has_key(&key(b"lx", idx, Some(day)))
    }

    pub(crate) fn set_lock_expiry_cursor(&mut self, idx: u32, day: u64) {
        write(&key(b"lc", idx, None), &day);
    }
}

/// Constant-product output for `amount_in` with a Ref fee in bps (fee: 30 = 0.3%).
pub fn cp_out(amount_in: u128, r_in: u128, r_out: u128, fee_bps: u32) -> u128 {
    if amount_in == 0 || r_in == 0 || r_out == 0 {
        return 0;
    }
    let in_after_fee = math::mul_div(amount_in, math::BPS - fee_bps as u128, math::BPS);
    math::mul_div(in_after_fee, r_out, r_in + in_after_fee)
}

/// True if `spot` is within `MAX_SWAP_DEVIATION_BPS` of `reference`.
pub fn within_band(spot: u128, reference: u128) -> bool {
    reference > 0 && spot.abs_diff(reference) <= math::mul_div(reference, MAX_SWAP_DEVIATION_BPS, math::BPS)
}
