#![allow(unused_must_use)]
use super::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseOrValue, PromiseResult, RuntimeFeesConfig};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const TOK: u128 = 1_000_000_000_000_000_000;
const DAY: u64 = 86_400;
const T0: u64 = 1_700_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn lp() -> AccountId {
    acc("floorpad.testnet")
}
fn token() -> AccountId {
    acc("moon.floorpad.testnet")
}

fn cfg() -> Config {
    Config {
        treasury_id: acc("treasury.testnet"),
        token_code_hash: "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ".parse().unwrap(),
        dao_code_hash: "DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF".parse().unwrap(),
        ref_exchange: acc("ref-finance-101.testnet"),
        linear: acc("linear-protocol.testnet"),
        default_agent: acc("agent.floorpad.testnet"),
        creation_fee: NearToken::from_millinear(1500),
        dao_deposit: NearToken::from_millinear(500),
        token_account_deposit: NearToken::from_millinear(300),
        graduation_reserve: NearToken::from_millinear(500),
        min_trade: NearToken::from_millinear(100),
        total_supply: U128(1_000_000_000 * TOK),
        curve_supply: U128(760_000_000 * TOK),
        lp_supply: U128(240_000_000 * TOK),
        virtual_tokens: U128(1_160_000_000 * TOK),
        grad_mcap_usd: 15_000,
        price_pool: None,
        max_price_move_bps_per_hour: 2000,
        max_price_age_secs: 6 * 3600,
        price_feeder: acc("owner.testnet"),
        referral_bps: 2000,
        buy_fee_bps: 125,
        sell_fee_bps: 250,
        fee_vault_bps: 4000,
        fee_creator_bps: 2500,
        creator_instant_bps: 5000,
        grad_vault_bps: 1500,
        grad_platform_bps: 100,
        yield_platform_bps: 1000,
        max_exit_fee_bps: 1000,
        exit_decay_secs: 7 * DAY,
        redeem_fee_bps: 200,
        snipe_window_secs: 120,
        snipe_max_tokens: U128(20_000_000 * TOK),
        lock_min_days: 7,
        lock_max_days: 180,
        epoch_secs: 3600,
        dao_proposal_period_secs: 3 * DAY,
        dao_proposal_bond: NearToken::from_millinear(100),
        dao_quorum: U128(0),
        ref_pool_fee: 30,
        agent_post_cost: NearToken::from_millinear(10),
    }
}

fn ctx(pred: &AccountId, deposit: u128, ts: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(lp())
        .predecessor_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

fn ctx_results(ts: u64, results: Vec<PromiseResult>) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(lp())
            .predecessor_account_id(lp())
            .block_timestamp(ts * 1_000_000_000)
            .prepaid_gas(Gas::from_tgas(300))
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

use near_sdk::Gas;

fn meta() -> TokenMeta {
    TokenMeta {
        name: "Moon".into(),
        symbol: "MOON".into(),
        icon: None,
        description: "to the moon".into(),
        website: None,
        twitter: None,
        telegram: None,
    }
}

/// Launch MOON with DAO ready.
fn launched() -> Contract {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000)); // $3.59
    ctx(&acc("alice.testnet"), 3 * NEAR / 2, T0);
    let id = match c.create_token(meta(), None) {
        PromiseOrValue::Value(v) => v.unwrap(),
        _ => panic!("feeder mode launches synchronously"),
    };
    assert_eq!(id, token());
    ctx(&lp(), 0, T0);
    c.on_token_deployed(0, Ok(()));
    c.on_dao_created(0, Ok(()));
    assert_eq!(c.tok(0).dao_stage, DaoStage::Created);
    c.tok_mut(0).dao_stage = DaoStage::Finalizing;
    c.on_dao_finalized(0, Ok(lp().to_string()));
    assert_eq!(c.tok(0).dao_stage, DaoStage::Ready);
    c
}

fn buy(c: &mut Contract, who: &str, near: u128, ts: u64) -> u128 {
    ctx(&acc(who), near, ts);
    c.buy(token(), U128(0), None).0
}

#[test]
fn create_sets_up_curve_and_dao_ids() {
    let c = launched();
    let t = c.get_token(token()).unwrap();
    assert_eq!(t.dao_id, acc("moon-dao.floorpad.testnet"));
    assert!(t.deployed);
    // 1.5 NEAR fee - 0.5 DAO - 0.3 token account
    assert_eq!(c.platform_fees, 7 * NEAR / 10);
    // curve sized so it graduates at ~$15k FDV with NEAR at $3.59 (~4,178 NEAR)
    let grad = t.grad_fdv_near.0 / NEAR;
    assert!((4_165..=4_190).contains(&grad), "grad fdv {grad}");
    assert_eq!(t.grad_mcap_usd, 15_000);
}

#[test]
#[should_panic(expected = "ERR_TICKER_TAKEN")]
fn duplicate_ticker_rejected() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 3 * NEAR / 2, T0);
    c.create_token(meta(), None);
}

#[test]
fn buy_splits_fees_into_floor_creator_platform() {
    let mut c = launched();
    let before_platform = c.platform_fees;
    let storage = curve::STORAGE_FEE;
    let out = buy(&mut c, "bob.testnet", NEAR + storage, T0 + 200);
    let t = c.tok(0);
    assert_eq!(t.sold, out);
    let fee = NEAR * 125 / 10_000;
    assert_eq!(t.backing_near, fee * 40 / 100);
    assert_eq!(t.creator_claimable, fee * 125 / 1000);
    assert_eq!(t.creator_escrow, fee * 125 / 1000);
    assert_eq!(c.platform_fees - before_platform, fee * 35 / 100);
    assert_eq!(t.real_near, NEAR - fee);
    assert_eq!(t.holders, 1);
    assert_eq!(c.get_trades(token(), None).len(), 1);
}

#[test]
#[should_panic(expected = "ERR_LAUNCH_WALLET_CAP")]
fn anti_snipe_caps_launch_wallets() {
    let mut c = launched();
    buy(&mut c, "sniper.testnet", 20 * NEAR, T0 + 5);
}

#[test]
fn snipe_cap_lifts_after_window() {
    let mut c = launched();
    let out = buy(&mut c, "whale.testnet", 20 * NEAR, T0 + 200);
    assert!(out > 20_000_000 * TOK);
}

#[test]
fn sell_exit_fee_decays_with_holding_age() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    let backing0 = c.tok(0).backing_near;

    // Fresh holder: full 10% exit fee lands in the floor.
    let q_new = c.quote_sell(token(), U128(out / 2), 0);
    let q_old = c.quote_sell(token(), U128(out / 2), 40 * DAY);
    assert!(q_new.exit_fee.0 > 0 && q_old.exit_fee.0 == 0);

    ctx(&lp(), 0, T0 + 300);
    let r = c.on_sell_age(0, acc("bob.testnet"), U128(out / 2), U128(0), None, Ok(Some(U64(T0 + 200))));
    assert_eq!(r, U128(0));
    let t = c.tok(0);
    assert!(t.backing_near > backing0 + q_new.exit_fee.0 * 9 / 10);
    assert_eq!(t.sold, out - out / 2);
}

#[test]
fn sell_slippage_refunds_tokens() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&lp(), 0, T0 + 300);
    let r = c.on_sell_age(0, acc("bob.testnet"), U128(out), U128(100 * NEAR), None, Ok(None));
    assert_eq!(r, U128(out));
}

#[test]
fn ve_lock_weight_and_allocation_tally() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&token(), 0, T0 + 300);
    c.ft_on_transfer(acc("bob.testnet"), U128(out), r#"{"action":"lock","days":180}"#.into());
    let p = c.get_position(token(), acc("bob.testnet")).unwrap();
    assert_eq!(p.weight.0, out * 4);
    assert_eq!(c.tok(0).total_weight, out * 4);

    ctx(&acc("bob.testnet"), 0, T0 + 301);
    c.set_allocation(token(), [2000, 2000, 2000, 2000, 2000]);
    assert_eq!(c.tok(0).alloc_tally[3], out * 4 * 2000);
    c.set_allocation(token(), [10_000, 0, 0, 0, 0]);
    assert_eq!(c.tok(0).alloc_tally[3], 0);
    assert_eq!(c.tok(0).alloc_tally[0], out * 4 * 10_000);
}

#[test]
#[should_panic(expected = "ERR_STILL_LOCKED")]
fn unlock_before_expiry_fails() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&token(), 0, T0 + 300);
    c.ft_on_transfer(acc("bob.testnet"), U128(out), r#"{"action":"lock","days":7}"#.into());
    ctx(&acc("bob.testnet"), 0, T0 + 300 + 6 * DAY);
    c.unlock(token());
}

#[test]
fn unlock_after_expiry_clears_weight() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&lp(), 0, T0 + 201);
    c.on_tokens_delivered(0, acc("bob.testnet"), U128(out), Ok(()));
    ctx(&token(), 0, T0 + 300);
    c.ft_on_transfer(acc("bob.testnet"), U128(out), r#"{"action":"lock","days":7}"#.into());
    ctx(&acc("bob.testnet"), 0, T0 + 300 + 8 * DAY);
    c.unlock(token());
    assert_eq!(c.tok(0).total_weight, 0);
    assert_eq!(c.tok(0).total_locked, 0);
    assert_eq!(c.tok(0).tokens_in_flight, out); // delivery in flight
}

/// Sells out the curve and walks graduation with simulated callbacks.
fn graduated() -> (Contract, u128) {
    let mut c = launched();
    let bob = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    buy(&mut c, "whale.testnet", 2_500 * NEAR, T0 + 201);
    assert_eq!(c.tok(0).grad_stage, GradStage::CreatePool);
    assert_eq!(c.tok(0).sold, 760_000_000 * TOK);

    ctx(&lp(), 0, T0 + 300);
    c.on_grad_pool_created(0, Ok(42));
    assert_eq!(c.tok(0).grad_stage, GradStage::Stake);

    let price = NEAR * 12 / 10; // 1.2 NEAR per LiNEAR
    let amount = c.tok(0).lp_near + c.tok(0).backing_near;
    c.on_grad_staked(0, U128(price), U128(amount), Ok(U128(math::mul_div(amount, math::PRICE_SCALE, price))));
    let t = c.tok(0);
    assert_eq!(t.grad_stage, GradStage::Deposit);
    assert!(t.lp_shares > 0 && t.linear_shares > 0);

    let (lp_shares, lp_tokens) = (t.lp_shares, t.lp_tokens);
    let ok = |v: u128| PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(v)).unwrap());
    ctx_results(T0 + 301, vec![ok(lp_tokens), ok(lp_shares)]);
    c.on_grad_deposited(0, true, true);
    assert_eq!(c.tok(0).grad_stage, GradStage::AddLiquidity);

    ctx(&lp(), 0, T0 + 302);
    c.on_grad_liquidity(0, Ok(U128(1)));
    assert_eq!(c.tok(0).grad_stage, GradStage::Graduated);
    (c, bob)
}

#[test]
fn graduation_prices_lp_continuously_and_funds_floor() {
    let (c, _) = graduated();
    let t = c.tok(0);
    // Raise ~1,095 NEAR (vs ~850 with the old curve): 15% seeds the floor,
    // 1% platform, 0.5 NEAR reserve, rest is LP -> ~29% deeper liquidity at the same $15k.
    let lp_near = t.lp_near / NEAR;
    assert!((900..=930).contains(&lp_near), "lp_near {lp_near}");
    // Ref opens exactly at the final curve price: lp_near / lp_tokens == v_near / v_tokens.
    let lhs = math::mul_div(t.lp_near, 1_000_000_000_000, t.lp_tokens);
    let rhs = math::mul_div(t.v_near, 1_000_000_000_000, t.v_tokens);
    assert!(lhs.abs_diff(rhs) <= 1, "{lhs} vs {rhs}");
    // Unused LP tokens are burned.
    assert!(t.lp_tokens < 240_000_000 * TOK);
    assert_eq!(t.burned, 240_000_000 * TOK - t.lp_tokens);
    // The floor starts at ~4% of the graduation price (vs ~0.4% in v1).
    let fdv = math::fdv_near(t.v_near, t.v_tokens, 1_000_000_000 * TOK - t.burned);
    let vault = math::shares_to_near(t.linear_shares, NEAR * 12 / 10);
    let pct = vault * 10_000 / fdv;
    assert!((350..=500).contains(&pct), "floor/price bps {pct}");
    // Vault principal = pre-graduation fee backing + leftover raise.
    assert!(t.principal_near > 0);
    assert_eq!(t.backing_near, 0);
}

#[test]
fn partial_deposit_is_retryable() {
    let mut c = launched();
    buy(&mut c, "whale.testnet", 2_500 * NEAR, T0 + 201);
    ctx(&lp(), 0, T0 + 300);
    c.on_grad_pool_created(0, Ok(1));
    let amount = c.tok(0).lp_near + c.tok(0).backing_near;
    c.on_grad_staked(0, U128(NEAR), U128(amount), Ok(U128(amount)));
    let lp_tokens = c.tok(0).lp_tokens;
    ctx_results(
        T0 + 301,
        vec![
            PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(lp_tokens)).unwrap()),
            PromiseResult::Failed,
        ],
    );
    c.on_grad_deposited(0, true, true);
    let t = c.tok(0);
    assert!(t.lp_meme_deposited && !t.lp_linear_deposited);
    assert_eq!(t.grad_stage, GradStage::Deposit);
}

#[test]
fn epoch_splits_only_yield_by_vote() {
    let (mut c, bob) = graduated();
    ctx(&token(), 0, T0 + 400);
    c.ft_on_transfer(acc("bob.testnet"), U128(bob), r#"{"action":"lock","days":30}"#.into());
    ctx(&acc("bob.testnet"), 0, T0 + 401);
    // 50% airdrop to lockers, 50% AI agent
    c.set_allocation(token(), [0, 0, 5000, 5000, 0]);

    let shares0 = c.tok(0).linear_shares;
    let principal0 = c.tok(0).principal_near;
    // LiNEAR appreciated 10%: 1.2 -> 1.32
    let new_price = NEAR * 132 / 100;
    ctx(&lp(), 0, T0 + 4000);
    c.tok_mut(0).epoch_busy = true;
    c.on_epoch_price(0, Ok(U128(new_price)));

    let t = c.tok(0);
    assert_eq!(t.epoch_index, 1);
    let principal_shares = math::mul_div_ceil(principal0, math::PRICE_SCALE, new_price);
    let yield_shares = shares0 - principal_shares;
    assert!(yield_shares > 0);
    // Principal untouched except rounding dust compounding into the floor.
    assert!(t.principal_near - principal0 < NEAR / 1_000_000);
    assert!(t.linear_shares >= principal_shares);
    let after_platform = yield_shares - yield_shares * 1000 / 10_000;
    assert!(t.agent_budget_shares.abs_diff(after_platform / 2) <= 1);
    assert_eq!(c.get_claimable_linear(acc("treasury.testnet")).0, yield_shares * 1000 / 10_000);

    ctx(&acc("bob.testnet"), 0, T0 + 4001);
    let r = c.claim_rewards(token());
    assert!(r.0 + 1_000 >= after_platform / 2 && r.0 <= after_platform / 2 + 1);
    assert_eq!(c.get_claimable_linear(acc("bob.testnet")), r);

    let reports = c.get_epochs(token(), None);
    assert_eq!(reports.len(), 1);
}

#[test]
fn epoch_without_votes_compounds_into_floor() {
    let (mut c, _) = graduated();
    let shares0 = c.tok(0).linear_shares;
    ctx(&lp(), 0, T0 + 4000);
    c.on_epoch_price(0, Ok(U128(NEAR * 15 / 10)));
    let t = c.tok(0);
    // only the 10% platform cut of the yield leaves; the rest compounds
    let platform = c.get_claimable_linear(acc("treasury.testnet")).0;
    assert!(platform > 0);
    assert_eq!(t.linear_shares, shares0 - platform);
    assert!(math::shares_to_near(t.linear_shares, NEAR * 15 / 10) >= t.principal_near);
}

#[test]
fn redeem_after_graduation_pays_linear_and_burns() {
    let (mut c, bob) = graduated();
    let shares0 = c.tok(0).linear_shares;
    let burned0 = c.tok(0).burned;
    let q = c.quote_redeem(token(), U128(bob), 300);
    ctx(&lp(), 0, T0 + 500);
    let r = c.on_redeem_age(0, acc("bob.testnet"), U128(bob), U128(0), Ok(Some(U64(T0 + 200))));
    assert_eq!(r, U128(0));
    let t = c.tok(0);
    assert_eq!(t.burned, burned0 + bob);
    let paid = c.get_claimable_linear(acc("bob.testnet")).0;
    assert!(paid > 0 && paid <= q.amount_out.0 + 1);
    assert_eq!(t.linear_shares, shares0 - paid);
}

#[test]
fn redemption_raises_floor_for_remaining_holders() {
    let (mut c, bob) = graduated();
    let floor = |c: &Contract| {
        let t = c.tok(0);
        math::mul_div(t.linear_shares, 1_000_000 * TOK, 1_000_000_000 * TOK - t.burned)
    };
    let f0 = floor(&c);
    ctx(&lp(), 0, T0 + 500);
    c.on_redeem_age(0, acc("bob.testnet"), U128(bob), U128(0), Ok(None));
    assert!(floor(&c) > f0);
}

#[test]
fn agent_posts_are_paid_from_budget() {
    let (mut c, _) = graduated();
    c.tok_mut(0).agent_budget_shares = NEAR / 50; // ~2 posts
    ctx(&acc("agent.floorpad.testnet"), agent::POST_DEPOSIT, T0 + 600);
    c.agent_post(token(), "gm $MOON".into());
    assert!(c.tok(0).agent_budget_shares < NEAR / 50);
    assert!(c.get_claimable_linear(acc("agent.floorpad.testnet")).0 > 0);
    assert_eq!(c.get_posts(token(), None)[0].text, "gm $MOON");
}

#[test]
#[should_panic(expected = "ERR_AGENT_BUDGET_EMPTY")]
fn agent_sleeps_without_budget() {
    let (mut c, _) = graduated();
    ctx(&acc("agent.floorpad.testnet"), agent::POST_DEPOSIT, T0 + 600);
    c.agent_post(token(), "gm".into());
}

#[test]
#[should_panic(expected = "ERR_NOT_DAO")]
fn only_dao_can_change_agent() {
    let mut c = launched();
    ctx(&acc("alice.testnet"), 0, T0 + 10);
    c.dao_set_agent(token(), None, Some("evil".into()));
}

#[test]
fn dao_can_set_persona_and_release_creator_escrow() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    let dao = acc("moon-dao.floorpad.testnet");
    ctx(&dao, 0, T0 + 300);
    c.dao_set_agent(token(), None, Some("You are a wise owl.".into()));
    assert_eq!(c.tok(0).agent_persona, "You are a wise owl.");
    let esc = c.tok(0).creator_escrow;
    c.dao_release_creator(token(), U128(esc / 2));
    assert_eq!(c.tok(0).creator_released, esc / 2);
}

#[test]
fn holders_policy_is_token_weighted() {
    let c = launched();
    let p = c.holders_policy();
    assert_eq!(p["default_vote_policy"]["weight_kind"], "TokenWeight");
    // everyone may only submit finished bounties; lockers do everything else
    assert_eq!(p["roles"][0]["kind"], "Everyone");
    assert_eq!(p["roles"][0]["permissions"], near_sdk::serde_json::json!(["bounty_done:AddProposal"]));
    assert_eq!(p["roles"][1]["kind"]["Member"], "1");
    assert!(p["roles"][1]["permissions"].as_array().unwrap().iter().any(|x| x == "*:AddProposal"));
    // > 70% of lock weight to pass; > 80% for policy / upgrades
    assert_eq!(p["default_vote_policy"]["threshold"], near_sdk::serde_json::json!([7, 10]));
    assert_eq!(p["roles"][1]["vote_policy"]["policy"]["threshold"], near_sdk::serde_json::json!([4, 5]));
}

#[test]
fn testnet_deploy_config_parses() {
    let raw = include_str!("../../../deploy/config.testnet.json")
        .replace("TREASURY_ID", "treasury.testnet").replace("FEEDER_ID", "owner.testnet")
        .replace("LAUNCHPAD_ID", "floorpad.testnet")
        .replace("TOKEN_CODE_HASH", "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ");
    let c: Config = near_sdk::serde_json::from_str(&raw).expect("config.testnet.json must match Config");
    ctx(&acc("owner.testnet"), 0, T0);
    let lp = Contract::new(c);
    // testnet demo: $100 graduation target -> ~7.3 NEAR raise at $3.59
    let c = &lp.config;
    let v0 = math::virtual_near_for_mcap(c.grad_mcap_usd, 3_590_000, c.virtual_tokens.0, c.curve_supply.0, c.total_supply.0);
    let raise = math::curve_near_for_tokens(v0, c.virtual_tokens.0, c.curve_supply.0);
    assert!((6 * NEAR..9 * NEAR).contains(&raise), "testnet raise {}", raise / NEAR);
}

#[test]
fn creator_claims_instant_share() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 10 * NEAR, T0 + 200);
    let claimable = c.tok(0).creator_claimable;
    assert!(claimable > 0);
    ctx(&acc("alice.testnet"), 0, T0 + 300);
    c.claim_creator_fees(token());
    assert_eq!(c.tok(0).creator_claimable, 0);
    assert_eq!(c.tok(0).creator_released, claimable);
}

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn only_creator_claims_fees() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 10 * NEAR, T0 + 200);
    ctx(&acc("bob.testnet"), 0, T0 + 300);
    c.claim_creator_fees(token());
}

#[test]
fn selling_costs_more_than_buying() {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 10 * NEAR, T0 + 200);
    let q_buy = c.quote_buy(token(), U128(10 * NEAR), Some(acc("bob.testnet")));
    let q_sell = c.quote_sell(token(), U128(out), 365 * DAY);
    let sell_gross = q_sell.amount_out.0 + q_sell.fee.0;
    assert_eq!(q_buy.fee.0, 10 * NEAR * 125 / 10_000); // 1.25%
    assert_eq!(q_sell.fee.0, sell_gross * 250 / 10_000); // 2.5%
}

#[test]
#[should_panic(expected = "ERR_PRICE_STALE")]
fn launch_needs_fresh_price() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000));
    ctx(&acc("alice.testnet"), 3 * NEAR / 2, T0 + 7 * 3600);
    c.create_token(meta(), None);
}

#[test]
#[should_panic(expected = "ERR_PRICE_JUMP")]
fn feeder_cannot_move_price_more_than_2x() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000));
    ctx(&acc("owner.testnet"), 0, T0 + 60);
    c.set_near_usd_price(U128(3_600_000));
    c.set_near_usd_price(U128(9_000_000));
}

#[test]
fn launch_price_tracks_near_usd() {
    // NEAR doubling halves the virtual NEAR so the USD target stays $15k
    let v_a = math::virtual_near_for_mcap(15_000, 1_590_000, 1_160_000_000 * TOK, 760_000_000 * TOK, 1_000_000_000 * TOK);
    let v_b = math::virtual_near_for_mcap(15_000, 3_180_000, 1_160_000_000 * TOK, 760_000_000 * TOK, 1_000_000_000 * TOK);
    assert!(v_a.abs_diff(v_b * 2) <= 2);
}

#[test]
fn referrer_earns_share_of_platform_fee() {
    let mut c = launched();
    let before = c.platform_fees;
    ctx(&acc("bob.testnet"), 10 * NEAR, T0 + 200);
    c.buy(token(), U128(0), Some(acc("kol.testnet")));
    let fee = (10 * NEAR - curve::STORAGE_FEE) * 125 / 10_000;
    let platform = fee - fee * 40 / 100 - fee * 25 / 100;
    let referral = platform * 2000 / 10_000;
    assert_eq!(c.get_referral_balance(acc("kol.testnet")).0, referral);
    assert_eq!(c.platform_fees - before, platform - referral);
}

#[test]
fn self_referral_is_ignored() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 10 * NEAR, T0 + 200);
    c.buy(token(), U128(0), Some(acc("bob.testnet")));
    assert_eq!(c.get_referral_balance(acc("bob.testnet")).0, 0);
}

#[test]
fn ref_price_is_clamped_against_manipulation() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000));
    // 6 minutes later someone pumps the pool 3x: only +2% (20%/h * 0.1h) is accepted
    ctx(&acc("owner.testnet"), 0, T0 + 360);
    let p = c.accept_price(3 * 3_590_000);
    assert_eq!(p, 3_590_000 * 10_200 / 10_000);
    // a day later the allowed move is wide enough to follow a real repricing
    ctx(&acc("owner.testnet"), 0, T0 + 360 + 86_400);
    let p2 = c.accept_price(5_000_000);
    assert_eq!(p2, 5_000_000);
}

#[test]
fn ref_quote_launch_path() {
    let mut cfg = cfg();
    cfg.price_pool = Some(PricePool {
        pool_id: 4512,
        near_token: acc("wrap.near"),
        usd_token: acc("usdc.near"),
        usd_decimals: 6,
        pool_fee_bps: 30,
    });
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg);
    c.accept_price(3_590_000); // first on-chain observation
    // Ref quote for 1 NEAR = 3.579230 USDC after the 0.3% fee
    ctx(&lp(), 0, T0 + 3600);
    let id = c.on_launch_price(acc("alice.testnet"), U128(3 * NEAR / 2), meta(), "p".into(), Ok(U128(3_579_230)));
    assert_eq!(id, Some(token()));
    let (price, _) = c.get_near_usd_price();
    assert!(price.0.abs_diff(3_590_000) < 100, "{}", price.0);
}

#[test]
fn failed_quote_refunds_launch() {
    let mut cfg = cfg();
    cfg.price_pool = Some(PricePool { pool_id: 1, near_token: acc("wrap.near"), usd_token: acc("usdc.near"), usd_decimals: 6, pool_fee_bps: 30 });
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg);
    ctx(&lp(), 0, T0 + 10);
    let id = c.on_launch_price(acc("alice.testnet"), U128(3 * NEAR / 2), meta(), "p".into(), Err(near_sdk::PromiseError::Failed));
    assert_eq!(id, None);
    assert_eq!(c.get_token_count(), 0);
}

#[test]
fn linear_donation_funds_next_epoch_yield() {
    let (mut c, _) = graduated();
    let shares0 = c.tok(0).linear_shares;
    let principal0 = c.tok(0).principal_near;
    ctx(&acc("linear-protocol.testnet"), 0, T0 + 500);
    let r = c.ft_on_transfer(acc("sponsor.testnet"), U128(NEAR), r#"{"fund_yield":"moon.floorpad.testnet"}"#.into());
    assert!(matches!(r, PromiseOrValue::Value(U128(0))));
    assert_eq!(c.tok(0).linear_shares, shares0 + NEAR);
    assert_eq!(c.tok(0).principal_near, principal0); // counts as yield, not principal
}

#[test]
#[should_panic(expected = "ERR_UNKNOWN_TOKEN")]
fn random_tokens_are_rejected() {
    let mut c = launched();
    ctx(&acc("scam.testnet"), 0, T0 + 500);
    c.ft_on_transfer(acc("x.testnet"), U128(1), "{}".into());
}

/// Writes the exact DAO policies the launchpad sends to Sputnik, for the on-chain DAO check (e2e/dao-check.mjs).
#[test]
fn export_dao_policies() {
    let c = launched();
    let out = near_sdk::serde_json::json!({ "holders_policy": c.holders_policy() });
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../e2e/fixtures/holders_policy.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, near_sdk::serde_json::to_string_pretty(&out).unwrap()).unwrap();
}

#[test]
#[should_panic(expected = "ERR_PRICE_IS_ONCHAIN")]
fn nobody_sets_price_when_it_is_onchain() {
    let mut cfg = cfg();
    cfg.price_pool = Some(PricePool { pool_id: 1, near_token: acc("wrap.near"), usd_token: acc("usdc.near"), usd_decimals: 6, pool_fee_bps: 30 });
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg);
    c.set_near_usd_price(U128(1)); // even the owner
}

#[test]
fn instant_trading_buy_sell_withdraw() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 10 * NEAR, T0 + 200);
    c.deposit_trading();
    // function-call keys attach no deposit
    ctx(&acc("bob.testnet"), 0, T0 + 201);
    let out = c.quick_buy(token(), U128(4 * NEAR), U128(0), None).0;
    assert!(out > 0);
    assert_eq!(c.get_trading_account(acc("bob.testnet")).near.0, 6 * NEAR);
    let cu = c.get_custody(token(), acc("bob.testnet"));
    assert_eq!(cu.amount.0, out);
    assert_eq!(c.tok(0).custody_total, out);
    // same curve, same trade log
    assert_eq!(c.tok(0).sold, out);
    assert_eq!(c.get_trades_from(token(), 0, None).len(), 1);
    // sell half: fresh holder pays the max exit fee; NEAR returns to the trading balance
    ctx(&acc("bob.testnet"), 0, T0 + 202);
    let q = c.quote_sell(token(), U128(out / 2), 1);
    let net = c.quick_sell(token(), U128(out / 2), U128(0), None).0;
    assert!(net > 0 && net.abs_diff(q.amount_out.0) <= q.amount_out.0 / 100);
    assert_eq!(c.get_trading_account(acc("bob.testnet")).near.0, 6 * NEAR + net);
    assert_eq!(c.tok(0).custody_total, out - out / 2);
    // withdrawing needs the wallet (1 yocto) and moves custody to the wallet
    ctx(&acc("bob.testnet"), 1, T0 + 203);
    c.withdraw_custody(token(), None);
    assert_eq!(c.get_custody(token(), acc("bob.testnet")).amount.0, 0);
    assert_eq!(c.tok(0).custody_total, 0);
    c.withdraw_trading(None);
    assert_eq!(c.get_trading_account(acc("bob.testnet")).near.0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn session_key_cannot_withdraw() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 5 * NEAR, T0 + 200);
    c.deposit_trading();
    ctx(&acc("bob.testnet"), 0, T0 + 201); // function-call key: no deposit possible
    c.withdraw_trading(None);
}

#[test]
#[should_panic(expected = "ERR_TRADING_BALANCE")]
fn quick_buy_needs_balance() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 0, T0 + 200);
    c.quick_buy(token(), U128(NEAR), U128(0), None);
}

#[test]
fn trade_index_and_mechanics_log() {
    let (c, _) = graduated();
    let all = c.get_trades_from(token(), 0, None);
    assert!(all.len() >= 2);
    assert!(all.windows(2).all(|w| w[1].0 == w[0].0 + 1), "indexes are consecutive");
    let tail = c.get_trades_from(token(), all.last().unwrap().0, None);
    assert_eq!(tail.len(), 1);
    let log = c.get_mech_log(token(), None);
    assert!(log.iter().any(|e| e.kind == "graduation_burn" && e.amount.0 > 0));
}

#[test]
fn fees_only_flow_to_treasury_and_anyone_can_sweep() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 10 * NEAR, T0 + 200);
    let fees = c.platform_fees;
    assert!(fees > 0);
    ctx(&acc("random.testnet"), 0, T0 + 300); // anyone
    c.sweep_platform_fees();
    assert_eq!(c.platform_fees, 0);
    assert!(c.get_admin_powers()[0].starts_with("owner: none"));
}

#[test]
#[should_panic(expected = "ERR_NOT_FEEDER")]
fn deployer_cannot_set_price() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    ctx(&acc("deployer.testnet"), 0, T0 + 1);
    c.set_near_usd_price(U128(1));
}

// ---- LP harvest ----

fn pool_info(meme: u128, lin: u128, shares: u128) -> crate::ext::RefPoolInfo {
    crate::ext::RefPoolInfo {
        token_account_ids: vec![token(), acc("linear-protocol.testnet")],
        amounts: vec![U128(meme), U128(lin)],
        shares_total_supply: U128(shares),
    }
}

#[test]
fn harvest_math_takes_only_growth() {
    let p = NEAR * 12 / 10;
    let (lin, meme) = (750 * NEAR, 200_000_000 * TOK);
    let k0 = math::lp_depth(lin, meme, p);
    // no growth -> nothing
    assert_eq!(math::harvest_shares(1_000 * NEAR, k0, k0), 0);
    // fees grew x*y by ~2% (both sides +1%)
    let k = math::lp_depth(lin * 101 / 100, meme * 101 / 100, p);
    let s = 1_000 * NEAR;
    let rm = math::harvest_shares(s, k, k0);
    let left = math::lp_depth(math::mul_div(lin * 101 / 100, s - rm, s), math::mul_div(meme * 101 / 100, s - rm, s), p);
    assert!(left.abs_diff(k0) * 1_000_000 <= k0, "depth after harvest {left} vs {k0}");
    // LiNEAR +10% -> depth +sqrt(1.1) ~ 4.88% -> remove ~4.65% of shares
    let k = math::lp_depth(lin, meme, p * 11 / 10);
    let pct = math::harvest_shares(10_000, k, k0);
    assert!((464..=466).contains(&pct), "removed bps {pct}");
}

#[test]
fn harvest_depth_ignores_trades_and_handles_big_pools() {
    // a fee-less constant-product swap leaves depth unchanged
    let p = NEAR * 13 / 10;
    let (lin, meme) = (5_000 * NEAR, 100_000_000 * TOK);
    let k0 = math::lp_depth(lin, meme, p);
    let lin2 = lin + 1_000 * NEAR;
    let meme2 = math::mul_div_ceil(lin, meme, lin2);
    let k1 = math::lp_depth(lin2, meme2, p);
    assert!(k1.abs_diff(k0) * 1_000_000_000 <= k0);
    // 10M LiNEAR x 1B tokens at 3 NEAR doesn't overflow
    let big = math::lp_depth(10_000_000 * NEAR, 1_000_000_000 * TOK, 3 * NEAR);
    assert!(big > 0);
}

#[test]
#[should_panic(expected = "ERR_HARVEST_NOT_DUE")]
fn harvest_waits_one_epoch() {
    let (mut c, _) = graduated();
    ctx(&acc("anyone.testnet"), 0, T0 + 400);
    c.harvest_lp(token());
}

#[test]
fn harvest_burns_meme_and_feeds_epoch_yield() {
    let (mut c, _) = graduated();
    let t = c.tok(0).clone();
    assert!(t.lp_k0 > 0);
    let price0 = t.last_linear_price;
    let shares = 1_000 * NEAR;
    let epoch = cfg().epoch_secs;

    // anyone can start it once an epoch has passed
    ctx(&acc("anyone.testnet"), 0, T0 + 302 + epoch);
    c.harvest_lp(token());
    assert!(c.tok(0).harvest_busy);

    // pool grew 1% on both sides from fees; LiNEAR +5%
    let (meme, lin) = (t.lp_tokens * 101 / 100, t.lp_shares * 101 / 100);
    let new_price = price0 * 105 / 100;
    ctx(&lp(), 0, T0 + 303 + epoch);
    let _ = c.on_harvest_quote(0, Ok(U128(new_price)), Ok(pool_info(meme, lin, shares)), Ok(U128(shares)));
    let k = math::lp_depth(lin, meme, new_price);
    let rm = math::harvest_shares(shares, k, t.lp_k0);
    assert!(rm > 0);
    let (out_meme, out_lin) = (math::mul_div(meme, rm, shares), math::mul_div(lin, rm, shares));

    ctx(&lp(), 0, T0 + 303 + epoch);
    let _ = c.on_harvest_removed(0, 0, 1, Ok(vec![U128(out_meme), U128(out_lin)]));
    assert_eq!(c.tok(0).harvest_meme_pending, out_meme);
    assert_eq!(c.tok(0).harvest_linear_pending, out_lin);

    // both withdrawals land
    let shares_before = c.tok(0).linear_shares;
    let in_flight0 = c.tok(0).tokens_in_flight;
    ctx_results(T0 + 304 + epoch, vec![PromiseResult::Successful(vec![]), PromiseResult::Successful(vec![])]);
    let _ = c.on_harvest_withdrawn(0, U128(out_meme), U128(out_lin));
    let t2 = c.tok(0);
    assert!(!t2.harvest_busy);
    assert_eq!(t2.harvest_linear_pending + t2.harvest_meme_pending, 0);
    assert_eq!(t2.linear_shares, shares_before + out_lin);
    assert_eq!(t2.harvested_linear, out_lin);
    assert_eq!(t2.tokens_in_flight, in_flight0 + out_meme);

    let burned0 = c.tok(0).burned;
    ctx(&lp(), 0, T0 + 305 + epoch);
    c.on_harvest_burned(0, U128(out_meme), Ok(()));
    assert_eq!(c.tok(0).burned, burned0 + out_meme);
    assert_eq!(c.tok(0).harvest_burned, out_meme);

    // the harvested LiNEAR is yield, not principal: the next epoch splits it
    let principal = c.tok(0).principal_near;
    let principal_shares = math::mul_div_ceil(principal, math::PRICE_SCALE, new_price);
    assert!(c.tok(0).linear_shares - principal_shares >= out_lin);
}

#[test]
fn failed_harvest_withdrawal_is_retried() {
    let (mut c, _) = graduated();
    let epoch = cfg().epoch_secs;
    c.tok_mut(0).harvest_busy = true;
    ctx(&lp(), 0, T0 + 303 + epoch);
    let _ = c.on_harvest_removed(0, 0, 1, Ok(vec![U128(5 * TOK), U128(NEAR)]));
    // LiNEAR withdrawal fails, meme lands
    ctx_results(T0 + 304 + epoch, vec![PromiseResult::Successful(vec![]), PromiseResult::Failed]);
    let _ = c.on_harvest_withdrawn(0, U128(5 * TOK), U128(NEAR));
    let t = c.tok(0);
    assert_eq!(t.harvest_meme_pending, 0);
    assert_eq!(t.harvest_linear_pending, NEAR);
    assert!(!t.harvest_busy);
    // retry is allowed right away (no epoch wait) and only withdraws what's pending
    ctx(&acc("anyone.testnet"), 0, T0 + 305 + epoch);
    c.harvest_lp(token());
    assert!(c.tok(0).harvest_busy);
}

#[test]
fn tiny_harvest_is_skipped() {
    let (mut c, _) = graduated();
    let t = c.tok(0).clone();
    c.tok_mut(0).harvest_busy = true;
    ctx(&lp(), 0, T0 + 999_999);
    let r = c.on_harvest_quote(0, Ok(U128(t.last_linear_price)), Ok(pool_info(t.lp_tokens, t.lp_shares, NEAR)), Ok(U128(NEAR)));
    assert!(matches!(r, PromiseOrValue::Value(())));
    assert!(!c.tok(0).harvest_busy);
}

#[test]
fn migrate_deserializes_live_v1_state_and_upgrades_in_place() {
    use near_sdk::borsh;
    use near_sdk::base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    // Exact on-chain STATE (597 bytes) and token[0] (768 bytes) fetched from fplpmwbbcg00.testnet
    let live_state_b64 = "FgAAAGZwYmFua213YmJjOTV6LnRlc3RuZXSEgydDxT2eEpcYnL3j8E43kv4IC8Fg1ytFuxERM4IRXL9vlR7l5Flo4zZ/qFe+v4vIC63sGDmYwiOcSHI34Nf2FwAAAHJlZi1maW5hbmNlLTEwMS50ZXN0bmV0FwAAAGxpbmVhci1wcm90b2NvbC50ZXN0bmV0FgAAAGZwYmFua213YmJjOTV6LnRlc3RuZXQAAIBxZDO2KaM9AQAAAAAAAACA0HZm5w3haQAAAAAAAAAAgOPgo1cIhz8AAAAAAAAAAIDQdmbnDeFpAAAAAAAAAACA9krhxwItFQAAAAAAAAAAAOg8gNCfPC47AwAAAAAAAAD4dWHwjUKodAIAAAAAAAAA8MYe4BH6hcYAAAAAAAAAAIjBlBABjoe/AwAAAABkAAAAAAAAAADQB4BRAQAAAAAAFgAAAGZwYmFua213YmJjOTV6LnRlc3RuZXTQB30A+gCgD8QJiBPcBWQA6APoA4A6CQAAAAAAyAAUAAAAAAAAAAAAAJSQAigsKosQAAAAAAAHAAAAAAAAALQAAAAAAAAAHgAAAAAAAABYAgAAAAAAAAAAgPZK4ccCLRUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAQLK6yeAZHgIAAAAAAAADAAAAAQAAAAABAAAAAQEAAAACAQAAAAMBAAAACQEAAAAEAQAAAAUBAAAABgEAAAAHAQAAAAj8sG4RWLrnTG/pAQAAAAAAAHDHNgAAAAAAAAAAAAAAAAAEqPNqAAAAAAEAAAAK";
    let live_tok0_b64 = "HAAAAGUyZWpoNDAuZnBscG13YmJjZzAwLnRlc3RuZXQWAAAAZnBiYW5rbXdiYmM5NXoudGVzdG5ldAgAAABFMkUgTW9vbgcAAABFMkVKSDQwAA8AAABlbmQtdG8tZW5kIHRlc3QAAAAMqPNqAAAAAAEhAAAAZTJlamg0MC1kYW8xLmZwbHBtd2JiY2cwMC50ZXN0bmV0AwG+mkEcVD00Wmw3CQAAAAAAAAAAkEszIHNL30oBAAAAAAAAAPh1YfCNQqh0AgAAAAAAAAAAAAAAAAAAAAAAAAAABow4g7msTDzfd1UAAAAAAAIAAAD51Zr+BEM8W29dBgAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAB1NNS/PymZqiuBAAAAAAAA+UKyhhHTlT67KQEAAAAAAKUyuKCbMQEVngIAAAAAAAAAAAAAAAAAAAAAAAAAAAAApDK4oJsxARWeAgAAAAAAAGQAAAAAAAAAcMc2AAAAAAAAAAAAAAAAAAUAAXoLAAAAAAAAfAHMFm/5BAWeqAQAAAAAAKp88YZGPjQaHwoCAAAAAABENQJMR5QytPU+pwAAAAAAAQHLqPNqAAAAAJx+Kg6i4iaL6Ry0AAAAAAD7Gq3ax27NgCXx+wAAAAAA8MhiaFx58UT+9EuwBwAAAGgtlJwKNmpnfe9xiAsAAABoLZScCjZqZ33vcYgLAAAAeGQxNK68eCJ/+iXYAwAAAHhkMTSuvHgif/ol2AMAAAB84fpUdVtG5HdJhQEAAAAAAQAAAM4AAAD9gfRqAAAAAAC8OkYw5idKeBfoAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWAAAAZnBiYW5rbXdiYmM5NXoudGVzdG5ldFAAAABZb3UgYXJlIHRoZSB2b2ljZSBvZiAkRTJFSkg0MC4gQmUgZnVubnksIHVwYmVhdCBhbmQgbmV2ZXIgZ2l2ZSBmaW5hbmNpYWwgYWR2aWNlLgp9j/QIfQnYMAkAAAAAAAABAAAA";

    let raw_state = B64.decode(live_state_b64).unwrap();
    let raw_tok0 = B64.decode(live_tok0_b64).unwrap();

    // Verify byte-for-byte Borsh match with live fplpmwbbcg00.testnet state
    let parsed_old_state: migrate::OldContract = borsh::from_slice(&raw_state).expect("live STATE must deserialize");
    let parsed_old_tok0: migrate::OldTokenState = borsh::from_slice(&raw_tok0).expect("live token[0] must deserialize");
    assert_eq!(parsed_old_state.tokens.len(), 3);
    assert_eq!(parsed_old_tok0.token_id.as_str(), "e2ejh40.fplpmwbbcg00.testnet");
    assert_eq!(parsed_old_tok0.grad_stage, GradStage::Graduated);
    drop(parsed_old_state);

    // Run full migrate() in VM storage (with 1-token state constructed identically to v1)
    ctx(&lp(), 0, T0);
    let mut single_vec: near_sdk::store::Vector<migrate::OldTokenState> = near_sdk::store::Vector::new(StorageKey::Tokens);
    single_vec.push(parsed_old_tok0);
    single_vec.flush();
    let mut old_c = migrate::OldContract {
        config: borsh::from_slice::<migrate::OldContract>(&raw_state).unwrap().config,
        tokens: single_vec,
        token_index: LookupMap::new(StorageKey::TokenIndex),
        positions: LookupMap::new(StorageKey::Positions),
        claimable_linear: LookupMap::new(StorageKey::Claimable),
        pending_tokens: LookupMap::new(StorageKey::PendingTokens),
        snipe_bought: LookupMap::new(StorageKey::SnipeBought),
        known_holders: LookupMap::new(StorageKey::KnownHolders),
        trades: LookupMap::new(StorageKey::Trades),
        posts: LookupMap::new(StorageKey::Posts),
        epochs: LookupMap::new(StorageKey::Epochs),
        platform_fees: 123,
        ref_registered: true,
        near_usd_micro: 3_600_000,
        price_updated_at: T0,
        referral_balance: LookupMap::new(StorageKey::Referrals),
    };
    let encoded_old = borsh::to_vec(&old_c).unwrap();
    old_c.tokens.flush();
    std::mem::forget(old_c);
    env::storage_write(b"STATE", &encoded_old);

    let migrated = Contract::migrate();
    assert_eq!(migrated.tokens.len(), 1);
    let t = migrated.tok(0);
    assert_eq!(t.token_id.as_str(), "e2ejh40.fplpmwbbcg00.testnet");
    assert_eq!(t.grad_stage, GradStage::Graduated);
    assert!(t.lp_k0 > 0);
    assert_eq!(t.custody_total, 0);
    assert_eq!(t.mech_count, 0);
    assert!(!t.harvest_busy);

    // Writing migrated state back confirms re-migration guard triggers
    env::storage_write(b"STATE", &borsh::to_vec(&migrated).unwrap());
    let re = std::panic::catch_unwind(|| Contract::migrate());
    assert!(re.is_err());
}
