//! Pure math: bonding curve, fees, lock multipliers, reward accounting.
//! Everything here is deterministic and unit tested.

uint::construct_uint! {
    pub struct U256(4);
}

pub const BPS: u128 = 10_000;
/// Fixed-point scale for reward-per-weight accumulators.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000_000_000_000_000; // 1e30
/// LiNEAR `ft_price` is NEAR-per-LiNEAR scaled by 1e24.
pub const PRICE_SCALE: u128 = 1_000_000_000_000_000_000_000_000; // 1e24

pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "ERR_DIV_ZERO");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    assert!(r <= U256::from(u128::MAX), "ERR_OVERFLOW");
    r.as_u128()
}

pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "ERR_DIV_ZERO");
    let num = U256::from(a) * U256::from(b);
    let c = U256::from(c);
    let r = (num + c - U256::one()) / c;
    assert!(r <= U256::from(u128::MAX), "ERR_OVERFLOW");
    r.as_u128()
}

/// Tokens received for `near_in` on a constant-product virtual-reserve curve.
pub fn curve_tokens_out(v_near: u128, v_tokens: u128, near_in: u128) -> u128 {
    mul_div(v_tokens, near_in, v_near + near_in)
}

/// NEAR required (rounded up) to receive exactly `tokens_out`.
pub fn curve_near_for_tokens(v_near: u128, v_tokens: u128, tokens_out: u128) -> u128 {
    assert!(tokens_out < v_tokens, "ERR_CURVE_DEPLETED");
    mul_div_ceil(v_near, tokens_out, v_tokens - tokens_out)
}

/// NEAR received for selling `tokens_in` back to the curve.
pub fn curve_near_out(v_near: u128, v_tokens: u128, tokens_in: u128) -> u128 {
    mul_div(v_near, tokens_in, v_tokens + tokens_in)
}

pub fn bps(amount: u128, bps: u128) -> u128 {
    mul_div(amount, bps, BPS)
}

/// Exit fee that decays linearly from `max_bps` at age 0 to 0 at `decay_secs`.
pub fn exit_fee_bps(max_bps: u128, decay_secs: u64, age_secs: u64) -> u128 {
    if decay_secs == 0 || age_secs >= decay_secs {
        return 0;
    }
    max_bps * ((decay_secs - age_secs) as u128) / (decay_secs as u128)
}

/// Voting/reward multiplier in bps: 1x at `min_days`, 4x at `max_days`.
pub fn lock_mult_bps(days: u64, min_days: u64, max_days: u64) -> u128 {
    let d = days.clamp(min_days, max_days);
    if max_days == min_days {
        return BPS;
    }
    BPS + 3 * BPS * ((d - min_days) as u128) / ((max_days - min_days) as u128)
}

pub fn lock_weight(amount: u128, days: u64, min_days: u64, max_days: u64) -> u128 {
    mul_div(amount, lock_mult_bps(days, min_days, max_days), BPS)
}

/// LiNEAR shares minted for `near` at `price` (conservative: rounds down and
/// shaves 1e-9 to stay below what the staking pool actually mints).
pub fn near_to_shares_conservative(near: u128, price: u128) -> u128 {
    let s = mul_div(near, PRICE_SCALE, price);
    s.saturating_sub(s / 1_000_000_000 + 1)
}

pub fn shares_to_near(shares: u128, price: u128) -> u128 {
    mul_div(shares, price, PRICE_SCALE)
}

/// Virtual NEAR reserve such that selling `curve_supply` of `v_tokens` virtual
/// tokens ends at a fully-diluted market cap of `mcap_usd`.
/// mcap = V0 * T0 * S / Tf^2  =>  V0 = mcap * Tf^2 / (T0 * S)
pub fn virtual_near_for_mcap(
    mcap_usd: u64,
    near_usd_micro: u128,
    v_tokens: u128,
    curve_supply: u128,
    total_supply: u128,
) -> u128 {
    let mcap_near = mul_div(mcap_usd as u128 * 1_000_000, PRICE_SCALE, near_usd_micro);
    let tf = v_tokens - curve_supply;
    mul_div(mul_div(mcap_near, tf, v_tokens), tf, total_supply)
}

/// Fully-diluted market cap (yoctoNEAR) at the curve's spot price.
pub fn fdv_near(v_near: u128, v_tokens: u128, supply: u128) -> u128 {
    mul_div(v_near, supply, v_tokens)
}

/// Split `total` across buckets proportionally to `tally`. Rounding dust goes to bucket 0.
pub fn split_by_tally(total: u128, tally: &[u128; 5]) -> [u128; 5] {
    let sum: u128 = tally.iter().sum();
    let mut out = [0u128; 5];
    if sum == 0 {
        out[0] = total;
        return out;
    }
    let mut used = 0;
    for i in 1..5 {
        out[i] = mul_div(total, tally[i], sum);
        used += out[i];
    }
    out[0] = total - used;
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const TOK: u128 = 1_000_000_000_000_000_000;

    #[test]
    fn curve_buy_then_sell_never_profits() {
        let (v_n, v_t) = (30 * NEAR, 1_073_000_000 * TOK);
        let out = curve_tokens_out(v_n, v_t, 5 * NEAR);
        let back = curve_near_out(v_n + 5 * NEAR, v_t - out, out);
        assert!(back <= 5 * NEAR);
        assert!(5 * NEAR - back < 10); // only rounding lost
    }

    #[test]
    fn exact_out_costs_at_least_quote() {
        let (v_n, v_t) = (30 * NEAR, 1_073_000_000 * TOK);
        let want = 100_000_000 * TOK;
        let cost = curve_near_for_tokens(v_n, v_t, want);
        assert!(curve_tokens_out(v_n, v_t, cost) >= want);
    }

    #[test]
    fn full_curve_raise_matches_design() {
        // 800M of 1.073B virtual tokens sold => ~2.93x virtual NEAR raised.
        let (v_n, v_t) = (30 * NEAR, 1_073_000_000 * TOK);
        let cost = curve_near_for_tokens(v_n, v_t, 800_000_000 * TOK);
        let raised = cost / NEAR;
        assert!((87..=89).contains(&raised), "raised {raised}");
    }

    #[test]
    fn exit_fee_decays() {
        assert_eq!(exit_fee_bps(1000, 100, 0), 1000);
        assert_eq!(exit_fee_bps(1000, 100, 50), 500);
        assert_eq!(exit_fee_bps(1000, 100, 100), 0);
        assert_eq!(exit_fee_bps(1000, 100, 1000), 0);
    }

    #[test]
    fn lock_multiplier_range() {
        assert_eq!(lock_mult_bps(7, 7, 180), 10_000);
        assert_eq!(lock_mult_bps(180, 7, 180), 40_000);
        assert_eq!(lock_mult_bps(1, 7, 180), 10_000);
        assert_eq!(lock_mult_bps(999, 7, 180), 40_000);
        assert_eq!(lock_weight(100, 180, 7, 180), 400);
    }

    #[test]
    fn curve_sized_for_15k_usd() {
        // NEAR = $3.59 -> $15k = ~4,178 NEAR FDV at graduation
        let v0 = virtual_near_for_mcap(15_000, 3_590_000, 1_073_000_000 * TOK, 800_000_000 * TOK, 1_000_000_000 * TOK);
        let out = 800_000_000 * TOK;
        let cost = curve_near_for_tokens(v0, 1_073_000_000 * TOK, out);
        let (vf, tf) = (v0 + cost, 273_000_000 * TOK);
        let fdv = fdv_near(vf, tf, 1_000_000_000 * TOK) / NEAR;
        assert!((4_170..=4_190).contains(&fdv), "fdv {fdv}");
        // ~850 NEAR (~$3.05k) raised on the curve
        assert!((845..=856).contains(&(cost / NEAR)), "raise {}", cost / NEAR);
    }

    #[test]
    fn split_is_exact() {
        let s = split_by_tally(1_000_003, &[1, 1, 1, 0, 0]);
        assert_eq!(s.iter().sum::<u128>(), 1_000_003);
        assert_eq!(s[3], 0);
        let s = split_by_tally(77, &[0; 5]);
        assert_eq!(s, [77, 0, 0, 0, 0]);
    }

    #[test]
    fn shares_conversion_is_conservative() {
        let price = 1_150_000_000_000_000_000_000_000; // 1.15 NEAR per LiNEAR
        let s = near_to_shares_conservative(100 * NEAR, price);
        assert!(shares_to_near(s, price) <= 100 * NEAR);
        assert!(100 * NEAR - shares_to_near(s, price) < NEAR / 1_000_000);
    }
}
