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
        buy_fee_bps: 50,
        sell_fee_bps: 100,
        fee_vault_bps: 4000,
        fee_creator_bps: 2500,
        creator_instant_bps: 5000,
        grad_vault_bps: 1500,
        grad_platform_bps: 100,
        yield_platform_bps: 1000,
        max_exit_fee_bps: 300,
        exit_decay_secs: 30 * DAY,
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
fn stnear() -> AccountId {
    acc("meta-v2.pool.testnet")
}

fn launched() -> Contract {
    launched_on(false)
}

/// `stnear`: the launchpad stakes new launches into Meta Pool's stNEAR.
fn launched_on(use_stnear: bool) -> Contract {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000)); // $3.59
    if use_stnear {
        ctx(&lp(), 0, T0);
        c.set_launch_stake_token(stnear(), crate::stake::KIND_META);
    }
    ctx(&acc("alice.testnet"), 3 * NEAR / 2, T0);
    let id = match c.create_token(meta(), None, None) {
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
    c.create_token(meta(), None, None);
}

#[test]
fn buy_splits_fees_into_floor_creator_platform() {
    let mut c = launched();
    let before_platform = c.platform_fees;
    let storage = curve::STORAGE_FEE;
    let out = buy(&mut c, "bob.testnet", NEAR + storage, T0 + 200);
    let t = c.tok(0);
    assert_eq!(t.sold, out);
    let plat = NEAR * 100 / 10_000;
    let tok_tax = NEAR * 50 / 10_000;
    let creator = tok_tax * 25 / 100;
    assert_eq!(t.backing_near, tok_tax - creator);
    assert_eq!(t.creator_claimable, creator / 2);
    assert_eq!(t.creator_escrow, creator - creator / 2);
    assert_eq!(c.platform_fees - before_platform, plat);
    assert_eq!(t.real_near, NEAR - plat - tok_tax);
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
    graduated_on(false)
}

fn graduated_on(stnear: bool) -> (Contract, u128) {
    let mut c = launched_on(stnear);
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
    // Raise ~1,135 NEAR: 15% seeds the floor, 1% platform, 0.5 NEAR reserve, rest is LP.
    // (~4% more than sizing on 1B tokens, so the pool opens at $15k after the LP burn.)
    let lp_near = t.lp_near / NEAR;
    assert!((930..=960).contains(&lp_near), "lp_near {lp_near}");
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
    let pool = pool_info(c.tok(0).lp_tokens, c.tok(0).lp_shares, NEAR);
    c.on_epoch_price(0, Ok(U128(new_price)), Ok(pool));

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
    let pool = pool_info(c.tok(0).lp_tokens, c.tok(0).lp_shares, NEAR);
    c.on_epoch_price(0, Ok(U128(NEAR * 15 / 10)), Ok(pool));
    let t = c.tok(0);
    // the 10% platform cut leaves; with no votes 10% of the rest funds the AI agent and
    // everything else compounds into the floor
    let platform = c.get_claimable_linear(acc("treasury.testnet")).0;
    assert!(platform > 0);
    assert!(t.agent_budget_shares > 0, "default agent share without votes");
    assert_eq!(t.linear_shares, shares0 - platform - t.agent_budget_shares);
    // platform takes 10% of the yield; the agent 10% of the remaining 90% (9% of the yield)
    assert!(t.agent_budget_shares < platform, "agent share stays small");
    assert!(t.agent_budget_shares * 10 >= platform * 8, "agent gets ~9% of the yield");
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
    assert_eq!(q_buy.fee.0, 10 * NEAR * 150 / 10_000); // 1.0% platform + 0.5% buy tax
    assert_eq!(q_sell.fee.0, sell_gross * 200 / 10_000); // 1.0% platform + 1.0% sell tax
}

#[test]
#[should_panic(expected = "ERR_PRICE_STALE")]
fn launch_needs_fresh_price() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000));
    ctx(&acc("alice.testnet"), 3 * NEAR / 2, T0 + 7 * 3600);
    c.create_token(meta(), None, None);
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

/// A first buy of exactly the minimum (0.1 NEAR) pays storage from it and still goes through.
#[test]
fn first_buy_of_exactly_the_minimum_is_accepted() {
    let mut c = launched();
    let min = c.config.min_trade.as_yoctonear();
    let out = buy(&mut c, "newbie.testnet", min, T0 + 200);
    assert!(out > 0);
}

#[test]
#[should_panic(expected = "ERR_BELOW_MIN_TRADE")]
fn buy_below_the_minimum_is_refused() {
    let mut c = launched();
    let min = c.config.min_trade.as_yoctonear();
    buy(&mut c, "newbie.testnet", min - crate::curve::STORAGE_FEE - 1, T0 + 200);
}

#[test]
fn referrer_earns_share_of_platform_fee() {
    let mut c = launched();
    let before = c.platform_fees;
    ctx(&acc("bob.testnet"), 10 * NEAR, T0 + 200);
    c.buy(token(), U128(0), Some(acc("kol.testnet")));
    let platform = (10 * NEAR - curve::STORAGE_FEE) * 100 / 10_000;
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
    let id = c.on_launch_price(acc("alice.testnet"), U128(3 * NEAR / 2), meta(), "p".into(), None, Ok(U128(3_579_230)));
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
    let id = c.on_launch_price(acc("alice.testnet"), U128(3 * NEAR / 2), meta(), "p".into(), None, Err(near_sdk::PromiseError::Failed));
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

#[test]
fn creator_custom_tax_policy_and_dao_update() {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    c.set_near_usd_price(U128(3_590_000));
    ctx(&acc("alice.testnet"), 3 * NEAR / 2, T0);
    let custom = TokenTaxInput {
        buy_tax_bps: Some(200),
        sell_tax_bps: Some(300),
        max_exit_fee_bps: Some(400),
        exit_decay_secs: Some(14 * DAY),
        tax_vault_bps: Some(6000),
        tax_creator_bps: Some(1500),
        tax_burn_bps: Some(2500),
    };
    c.create_token(meta(), None, Some(custom));
    let t = c.tok(0);
    assert_eq!((t.buy_tax_bps, t.sell_tax_bps, t.max_exit_fee_bps, t.exit_decay_secs), (200, 300, 400, 14 * DAY));
    assert_eq!((t.tax_vault_bps, t.tax_creator_bps, t.tax_burn_bps), (6000, 1500, 2500));

    // Finalize DAO before DAO governance calls are allowed
    c.tok_mut(0).dao_stage = DaoStage::Ready;
    // Only the token DAO can update tax policy
    ctx(&acc("moon-dao.floorpad.testnet"), 0, T0 + 10);
    c.set_token_tax_policy(
        token(),
        TokenTaxInput {
            buy_tax_bps: Some(100),
            sell_tax_bps: Some(150),
            max_exit_fee_bps: Some(200),
            exit_decay_secs: Some(7 * DAY),
            tax_vault_bps: Some(5000),
            tax_creator_bps: Some(1000),
            tax_burn_bps: Some(4000),
        },
    );
    let t = c.tok(0);
    assert_eq!((t.buy_tax_bps, t.sell_tax_bps, t.max_exit_fee_bps, t.exit_decay_secs), (100, 150, 200, 7 * DAY));
    assert_eq!((t.tax_vault_bps, t.tax_creator_bps, t.tax_burn_bps), (5000, 1000, 4000));
}

#[test]
fn mainnet_config_enforces_anti_capture_dao_quorum() {
    let raw = include_str!("../../../deploy/config.mainnet.json")
        .replace("TREASURY_ID", "treasury.near")
        .replace("FEEDER_ID", "feeder.near")
        .replace("LAUNCHPAD_ID", "floorpad.near")
        .replace("TOKEN_CODE_HASH", "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ");
    let c: Config = near_sdk::serde_json::from_str(&raw).expect("config.mainnet.json must match Config");
    assert!(c.dao_quorum.0 > c.snipe_max_tokens.0 * 4);
    assert_eq!(c.grad_mcap_usd, 25_000);
}

// ---- audit fixes: guarded protocol swaps, exact tax accounting, lock expiry ----

/// Pool at the LP's opening price (the graduation reference).
fn opening_pool(c: &Contract) -> crate::ext::RefPoolInfo {
    let t = c.tok(0);
    pool_info(t.lp_tokens, t.lp_shares, NEAR)
}

fn buyback_vote(c: &mut Contract, bob: u128) {
    ctx(&token(), 0, T0 + 400);
    c.ft_on_transfer(acc("bob.testnet"), U128(bob), r#"{"action":"lock","days":30}"#.into());
    ctx(&acc("bob.testnet"), 0, T0 + 401);
    c.set_allocation(token(), [0, 10_000, 0, 0, 0]); // all yield to buyback
}

#[test]
fn graduation_sets_reference_price_at_lp_opening() {
    let (c, _) = graduated();
    let t = c.tok(0);
    let r = c.ref_price(0).expect("reference set at graduation");
    assert_eq!(r.price, math::mul_div(t.lp_shares, math::PRICE_SCALE, t.lp_tokens));
}

#[test]
fn buyback_skipped_when_pool_price_is_manipulated() {
    let (mut c, bob) = graduated();
    buyback_vote(&mut c, bob);
    let t = c.tok(0).clone();
    // attacker pumped the meme price 3x right before calling settle_epoch
    let pumped = pool_info(t.lp_tokens / 3, t.lp_shares * 3, NEAR);
    ctx(&lp(), 0, T0 + 4000);
    c.on_epoch_price(0, Ok(U128(NEAR * 15 / 10)), Ok(pumped));
    let rep = &c.get_epochs(token(), None)[0];
    assert_eq!(rep.split[BUCKET_BUYBACK].0, 0, "no buyback at a manipulated price");
    assert!(rep.split[BUCKET_FLOOR].0 > 0, "the buyback share stayed in the floor");
}

#[test]
fn buyback_runs_capped_at_a_fair_price() {
    let (mut c, bob) = graduated();
    buyback_vote(&mut c, bob);
    let pool = opening_pool(&c);
    let r_lin = pool.amounts[1].0;
    ctx(&lp(), 0, T0 + 4000);
    c.on_epoch_price(0, Ok(U128(NEAR * 15 / 10)), Ok(pool));
    let rep = &c.get_epochs(token(), None)[0];
    let bb = rep.split[BUCKET_BUYBACK].0;
    assert!(bb > 0, "fair price: buyback runs");
    assert!(bb <= r_lin * 500 / 10_000, "never more than 5% of the LiNEAR reserve");
}

#[test]
fn buyback_skipped_when_pool_unreadable() {
    let (mut c, bob) = graduated();
    buyback_vote(&mut c, bob);
    ctx(&lp(), 0, T0 + 4000);
    c.on_epoch_price(0, Ok(U128(NEAR * 15 / 10)), Err(near_sdk::PromiseError::Failed));
    assert_eq!(c.get_epochs(token(), None)[0].split[BUCKET_BUYBACK].0, 0);
}

#[test]
fn reference_price_moves_at_most_the_hourly_cap() {
    let (mut c, _) = graduated();
    let r0 = c.ref_price(0).unwrap().price;
    let t = c.tok(0).clone();
    // one hour later the pool shows 2x the price: the reference may only move 20% (config: 2000 bps/h)
    ctx(&lp(), 0, T0 + 302 + 3600);
    let (reference, spot) = c.observe_pool_price(0, t.lp_shares * 2, t.lp_tokens).unwrap();
    assert!(spot.abs_diff(r0 * 2) <= 2, "spot {spot}");
    assert!(reference.abs_diff(r0 * 12 / 10) <= 2, "reference {reference}");
    assert!(!crate::guard::within_band(spot, reference));
}

#[test]
fn tax_harvest_burns_everything_and_never_swaps() {
    let (mut c, _) = graduated();
    let in_flight0 = c.tok(0).tokens_in_flight;
    let burned0 = c.tok(0).burned;
    let shares0 = c.tok(0).linear_shares;
    ctx(&acc("anyone.testnet"), 0, T0 + 500);
    c.harvest_token_tax(token());
    assert!(c.tax_state(0).busy);
    let (plat, tax) = (100 * TOK, 300 * TOK);
    ctx(&lp(), 0, T0 + 501);
    c.on_tax_taken(0, Ok((U128(plat), U128(tax))));
    assert_eq!(c.tax_state(0), crate::guard::TaxState::default(), "nothing held, nothing to swap");
    assert_eq!(c.tok(0).tokens_in_flight, in_flight0 + plat + tax, "reserved while the burn runs");
    assert_eq!(c.tok(0).linear_shares, shares0, "no LiNEAR from tax: it is never sold");
    ctx(&lp(), 0, T0 + 502);
    c.on_tax_burned(0, U128(plat + tax), Ok(()));
    assert_eq!(c.tok(0).burned, burned0 + plat + tax);
    assert_eq!(c.tok(0).tokens_in_flight, in_flight0);
}

#[test]
fn failed_tax_burn_is_retried_by_the_next_harvest() {
    let (mut c, _) = graduated();
    let in_flight0 = c.tok(0).tokens_in_flight;
    ctx(&acc("anyone.testnet"), 0, T0 + 500);
    c.harvest_token_tax(token());
    ctx(&lp(), 0, T0 + 501);
    c.on_tax_taken(0, Ok((U128(0), U128(50 * TOK))));
    ctx(&lp(), 0, T0 + 502);
    c.on_tax_burned(0, U128(50 * TOK), Err(near_sdk::PromiseError::Failed));
    assert_eq!(c.tax_state(0).held(), 50 * TOK, "kept for the next harvest");
    assert_eq!(c.tok(0).tokens_in_flight, in_flight0 + 50 * TOK, "still reserved");
    // next harvest: nothing new from the token, the held tokens are burned
    ctx(&acc("anyone.testnet"), 0, T0 + 600);
    c.harvest_token_tax(token());
    ctx(&lp(), 0, T0 + 601);
    c.on_tax_taken(0, Ok((U128(0), U128(0))));
    assert_eq!(c.tax_state(0).held(), 0);
    let burned0 = c.tok(0).burned;
    ctx(&lp(), 0, T0 + 602);
    c.on_tax_burned(0, U128(50 * TOK), Ok(()));
    assert_eq!(c.tok(0).burned, burned0 + 50 * TOK);
    assert_eq!(c.tok(0).tokens_in_flight, in_flight0);
}

#[test]
fn testnet_grad_mcap_applies_to_new_launches_only() {
    let mut c = launched();
    let old = c.tok(0).grad_mcap_usd;
    ctx(&lp(), 0, T0 + 50);
    c.set_grad_mcap_usd(5_000);
    assert_eq!(c.config.grad_mcap_usd, 5_000);
    assert_eq!(c.tok(0).grad_mcap_usd, old, "existing curve keeps its target");
}

fn usd(c: &Contract, near_yocto: u128) -> f64 {
    near_yocto as f64 / 1e24 * c.near_usd_micro as f64 / 1e6
}

#[test]
fn launch_range_opens_at_start_and_graduates_at_target() {
    let mut c = launched();
    let old_grad = c.get_token(token()).unwrap().grad_fdv_near.0;
    ctx(&lp(), 0, T0 + 50);
    c.set_launch_mcap_usd(3_000, 30_000);
    // the token launched before keeps its curve end
    assert_eq!(c.get_token(token()).unwrap().grad_fdv_near.0, old_grad);
    // a new launch opens at ~$3k and graduates at ~$30k
    let (v0, vt, cs) = (c.launch_virtual_near(), c.config.virtual_tokens.0, c.config.curve_supply.0);
    // counted on the supply left after the graduation burn
    let supply = c.config.total_supply.0 - c.expected_grad_burn(v0, vt);
    let start = usd(&c, math::fdv_near(v0, vt, supply));
    let tf = vt - cs;
    let grad = usd(&c, math::fdv_near(math::mul_div(v0, vt, tf), tf, supply));
    assert!((start - 3_000.0).abs() < 3.0, "start {start}");
    assert!((grad - 30_000.0).abs() < 30.0, "grad {grad}");
}

#[test]
#[should_panic(expected = "ERR_NOT_LAUNCHPAD")]
fn launch_range_setter_is_launchpad_only() {
    let mut c = launched();
    ctx(&acc("alice.testnet"), 0, T0 + 50);
    c.set_launch_mcap_usd(3_000, 30_000);
}

#[test]
#[should_panic(expected = "ERR_NOT_LAUNCHPAD")]
fn grad_mcap_setter_is_launchpad_only() {
    let mut c = launched();
    ctx(&acc("alice.testnet"), 0, T0 + 50);
    c.set_grad_mcap_usd(5_000);
}

#[test]
#[should_panic(expected = "ERR_GRAD_MCAP_BOUNDS")]
fn grad_mcap_setter_has_bounds() {
    let mut c = launched();
    ctx(&lp(), 0, T0 + 50);
    c.set_grad_mcap_usd(5);
}

#[test]
fn anyone_can_fund_a_tokens_agent_budget() {
    let (mut c, _) = graduated();
    let before = c.tok(0).agent_budget_shares;
    ctx(&acc("linear-protocol.testnet"), 0, T0 + 900);
    let _ = c.ft_on_transfer(acc("fan.testnet"), U128(NEAR), format!(r#"{{"fund_agent":"{}"}}"#, token()));
    assert_eq!(c.tok(0).agent_budget_shares, before + NEAR);
}

/// The launchpad holds the queued NEAR on-chain; give the mocked account a balance to match.
fn ctx_rich(pred: &AccountId, ts: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(lp())
        .predecessor_account_id(pred.clone())
        .account_balance(NearToken::from_near(100_000))
        .block_timestamp(ts * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

fn mq_ok<T: near_sdk::serde::Serialize>(v: &T) -> PromiseResult {
    PromiseResult::Successful(near_sdk::serde_json::to_vec(v).unwrap())
}

#[test]
fn oversized_final_buy_queues_the_excess_instead_of_refunding() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    buy(&mut c, "whale.testnet", 2_500 * NEAR, T0 + 201);
    assert_eq!(c.tok(0).grad_stage, GradStage::CreatePool);
    let q = c.get_queued_buy(token(), acc("whale.testnet"));
    assert!(q.queued_near.0 > 1_000 * NEAR, "the NEAR past the cap waits to buy on Rhea");
    assert_eq!(c.get_migration_queue(token()).queued_near, q.queued_near);
}

#[test]
fn buys_during_migration_are_queued_not_rejected() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    buy(&mut c, "whale.testnet", 2_500 * NEAR, T0 + 201);
    let holders = c.tok(0).holders;
    let out = buy(&mut c, "carol.testnet", 10 * NEAR, T0 + 210);
    assert_eq!(out, 0, "no tokens yet: bought on the pool once it is live");
    let q = c.get_queued_buy(token(), acc("carol.testnet"));
    assert_eq!(q.queued_near.0, 10 * NEAR - crate::curve::STORAGE_FEE);
    assert_eq!(c.tok(0).holders, holders + 1);
    // a second buy from the same wallet adds to its entry
    buy(&mut c, "carol.testnet", NEAR, T0 + 211);
    assert_eq!(c.get_queued_buy(token(), acc("carol.testnet")).queued_near.0, 11 * NEAR - crate::curve::STORAGE_FEE);
}

#[test]
fn queue_buys_once_on_the_pool_and_splits_pro_rata() {
    let (mut c, _) = graduated();
    // whale's excess is queued by the sell-out buy; add a second buyer
    assert!(c.enqueue_migration_buy(0, &acc("carol.testnet"), 100 * NEAR, true));
    let whale_near = c.get_queued_buy(token(), acc("whale.testnet")).queued_near.0;
    let total = c.mq(0).total;
    assert_eq!(total, whale_near + 100 * NEAR);

    // 0 -> stake
    ctx_rich(&acc("keeper.testnet"), T0 + 600);
    let _ = c.process_migration_buys(token());
    assert!(c.mq(0).busy);
    let shares = total * 10 / 12; // 1.2 NEAR per LiNEAR
    ctx(&lp(), 0, T0 + 601);
    c.on_mq_staked(0, Ok(U128(shares)));
    assert_eq!(c.mq(0).stage, 1);
    // 1 -> deposit into Ref
    ctx(&acc("keeper.testnet"), 0, T0 + 602);
    let _ = c.process_migration_buys(token());
    ctx_results(T0 + 603, vec![mq_ok(&U128(shares))]);
    c.on_mq_deposited(0);
    assert_eq!(c.mq(0).stage, 2);
    // 2 -> guarded swap at the opening price
    ctx(&acc("keeper.testnet"), 0, T0 + 604);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 605);
    let pool = opening_pool(&c);
    let _ = c.on_mq_pool(0, Ok(pool));
    let out = 50_000_000 * TOK;
    c.on_mq_swapped(0, Ok(U128(out)));
    assert_eq!(c.mq(0).stage, 3);
    // 3 -> withdraw and split
    let owed0 = c.tok(0).owed_tokens;
    ctx(&acc("keeper.testnet"), 0, T0 + 606);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 607);
    let _ = c.on_mq_out_checked(0, Ok(U128(out)));
    ctx_results(T0 + 608, vec![mq_ok(&U128(out))]);
    c.on_mq_withdrawn(0);
    let q = c.mq(0);
    assert_eq!(q.total, 0);
    assert_eq!(q.stage, 0);
    assert_eq!(q.deliveries.iter().map(|d| d.1).sum::<u128>(), out, "every token bought is handed out");
    let carol = c.get_queued_buy(token(), acc("carol.testnet")).tokens_to_deliver.0;
    // pro rata; the last buyer also gets the rounding remainder so the split is exact
    assert!(carol.abs_diff(math::mul_div(out, 100 * NEAR, total)) <= 1);
    assert_eq!(c.tok(0).owed_tokens, owed0 + out, "reserved until delivered");

    // deliver
    ctx(&acc("anyone.testnet"), 0, T0 + 700);
    let sent = c.deliver_migration_buys(token(), None);
    assert_eq!(sent, 2);
    assert_eq!(c.tok(0).owed_tokens, owed0);
    assert!(c.mq(0).deliveries.is_empty());
}

#[test]
fn manipulated_pool_defers_the_queue_then_refunds_in_linear() {
    let (mut c, _) = graduated();
    let total = c.mq(0).total;
    let shares = total * 10 / 12;
    ctx_rich(&acc("keeper.testnet"), T0 + 600);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 601);
    c.on_mq_staked(0, Ok(U128(shares)));
    ctx(&acc("keeper.testnet"), 0, T0 + 602);
    let _ = c.process_migration_buys(token());
    ctx_results(T0 + 603, vec![mq_ok(&U128(shares))]);
    c.on_mq_deposited(0);
    // pumped pool: way above the opening price -> no swap, stays queued
    let t = c.tok(0).clone();
    let pumped = pool_info(t.lp_tokens / 3, t.lp_shares * 3, NEAR);
    ctx(&acc("keeper.testnet"), 0, T0 + 604);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 605);
    let _ = c.on_mq_pool(0, Ok(pumped.clone()));
    assert_eq!(c.mq(0).stage, 2);
    assert!(!c.mq(0).busy);
    // a day later, still out of band: refund in LiNEAR
    ctx(&acc("keeper.testnet"), 0, T0 + 604 + 90_000);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 605 + 90_000);
    let _ = c.on_mq_pool(0, Ok(pumped));
    ctx_results(T0 + 606 + 90_000, vec![mq_ok(&U128(shares))]);
    c.on_mq_refunded(0);
    assert_eq!(c.mq(0).total, 0);
    assert_eq!(c.get_claimable_linear(acc("whale.testnet")).0, shares);
}

/// The bug that stuck POT: the withdraw callback panicked, leaving the step busy with the
/// tokens already in the launchpad. The step must become retryable and split without a 2nd withdraw.
#[test]
fn stuck_withdraw_step_recovers_and_splits_without_withdrawing_again() {
    let (mut c, _) = graduated();
    let total = c.mq(0).total;
    let shares = total * 10 / 12;
    let out = 50_000_000 * TOK;
    let mut q = c.mq(0);
    q.shares = shares;
    q.out = out;
    q.stage = 3;
    q.busy = true; // callback panicked: never cleared, and no step time recorded (old code)
    c.set_mq(0, &q);
    let owed0 = c.tok(0).owed_tokens;

    ctx(&acc("keeper.testnet"), 0, T0 + 700);
    let _ = c.process_migration_buys(token()); // stale (no start time): allowed
    assert!(!c.step_is_stale(0), "a fresh step is not stale");

    // Ref holds none of them any more: split straight away
    ctx(&lp(), 0, T0 + 702);
    let r = c.on_mq_out_checked(0, Ok(U128(0)));
    assert!(matches!(r, PromiseOrValue::Value(())));
    let q = c.mq(0);
    assert!(!q.busy);
    assert_eq!(q.stage, 0);
    assert_eq!(q.deliveries.iter().map(|d| d.1).sum::<u128>(), out);
    assert_eq!(c.tok(0).owed_tokens, owed0 + out);
}

#[test]
fn failed_withdraw_keeps_the_step_for_a_retry() {
    let (mut c, _) = graduated();
    let mut q = c.mq(0);
    q.out = 7 * TOK;
    q.stage = 3;
    q.busy = true;
    c.set_mq(0, &q);
    ctx_results(T0 + 700, vec![mq_ok(&U128(0))]);
    c.on_mq_withdrawn(0);
    let q = c.mq(0);
    assert!(!q.busy);
    assert_eq!(q.stage, 3);
    assert!(q.deliveries.is_empty());
}

/// The seconds around migration never fail a buy.
#[test]
fn buy_just_after_graduation_is_queued_not_refused() {
    let (mut c, _) = graduated();
    assert_eq!(c.tok(0).grad_stage, GradStage::Graduated);
    let before = c.get_queued_buy(token(), acc("late.testnet")).queued_near.0;
    let out = buy(&mut c, "late.testnet", NEAR, T0 + 650);
    assert_eq!(out, 0);
    let q = c.get_queued_buy(token(), acc("late.testnet")).queued_near.0;
    assert_eq!(q - before, NEAR - crate::curve::STORAGE_FEE);
}

#[test]
fn buy_while_a_round_executes_waits_for_the_next_round() {
    let (mut c, _) = graduated();
    let total0 = c.mq(0).total;
    ctx_rich(&acc("keeper.testnet"), T0 + 600);
    let _ = c.process_migration_buys(token()); // round 1 staking: amounts fixed
    assert!(c.mq(0).busy);
    let _ = buy(&mut c, "late.testnet", 2 * NEAR, T0 + 601);
    let late = 2 * NEAR - crate::curve::STORAGE_FEE;
    assert_eq!(c.mq(0).total, total0, "the executing round is untouched");
    assert_eq!(c.get_queued_buy(token(), acc("late.testnet")).queued_near.0, late);
    assert_eq!(c.get_migration_queue(token()).queued_near.0, total0 + late);
    // finish round 1 the quick way (tokens already in the launchpad)
    let mut q = c.mq(0);
    q.busy = false;
    q.stage = 3;
    q.out = 10 * TOK;
    c.set_mq(0, &q);
    ctx(&acc("keeper.testnet"), 0, T0 + 602);
    let _ = c.process_migration_buys(token());
    ctx(&lp(), 0, T0 + 603);
    let _ = c.on_mq_out_checked(0, Ok(U128(0)));
    assert_eq!(c.mq(0).total, 0);
    // next round picks the waiting buy up
    ctx_rich(&acc("keeper.testnet"), T0 + 604);
    let _ = c.process_migration_buys(token());
    assert_eq!(c.mq(0).total, late);
    assert!(c.mq_waiting(0).is_empty());
}

#[test]
fn racing_for_the_last_tokens_does_not_fail_on_slippage() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    // quote for a big buy, then someone else takes almost the whole curve first
    let v = c.tok(0).clone();
    let quoted = math::curve_tokens_out(v.v_near, v.v_tokens, 400 * NEAR * 99 / 100);
    let min = quoted * 98 / 100;
    let rest = c.config.curve_supply.0 - c.tok(0).sold;
    let cost = math::curve_near_for_tokens(v.v_near, v.v_tokens, rest - 10_000_000 * TOK);
    buy(&mut c, "racer.testnet", cost * 100 / 99 + crate::curve::STORAGE_FEE, T0 + 201);
    assert_eq!(c.tok(0).grad_stage, GradStage::Curve, "a little is left for the whale");
    ctx(&acc("whale.testnet"), 400 * NEAR, T0 + 202);
    let out = c.buy(token(), U128(min), None).0;
    assert!(out > 0, "filled what was left");
    assert!(c.get_queued_buy(token(), acc("whale.testnet")).queued_near.0 > 0, "the rest is queued for the pool");
}

#[test]
fn quick_buy_during_migration_is_queued() {
    let mut c = launched();
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&acc("whale.testnet"), 3 * NEAR, T0 + 201);
    c.deposit_trading();
    buy(&mut c, "racer.testnet", 2_500 * NEAR, T0 + 202);
    assert_ne!(c.tok(0).grad_stage, GradStage::Curve);
    ctx(&acc("whale.testnet"), 0, T0 + 203);
    assert_eq!(c.quick_buy(token(), U128(2 * NEAR), U128(1), None).0, 0);
    assert_eq!(c.get_queued_buy(token(), acc("whale.testnet")).queued_near.0, 2 * NEAR - crate::curve::STORAGE_FEE);
}

// ---------- stNEAR (Meta Pool) for new launches ----------

#[test]
fn new_launches_use_stnear_and_old_tokens_keep_linear() {
    let mut c = launched(); // launched while LiNEAR was the default
    ctx(&lp(), 0, T0 + 10);
    c.set_launch_stake_token(stnear(), crate::stake::KIND_META);
    assert_eq!(c.get_stake_token(token()), c.config.linear, "an existing token keeps LiNEAR (its LP is locked)");
    assert_eq!(c.get_launch_stake_token(), stnear());
    let n = launched_on(true);
    assert_eq!(n.get_stake_token(token()), stnear());
    assert_eq!(n.get_token(token()).unwrap().stake_token, stnear());
}

#[test]
#[should_panic(expected = "ERR_NOT_LAUNCHPAD")]
fn only_the_launchpad_sets_the_launch_stake_token() {
    let mut c = launched();
    ctx(&acc("alice.testnet"), 0, T0 + 10);
    c.set_launch_stake_token(stnear(), crate::stake::KIND_META);
}

#[test]
fn stnear_token_is_funded_and_pays_out_in_stnear() {
    let (mut c, _) = graduated_on(true);
    let shares0 = c.tok(0).linear_shares;
    // yield top-up must come in the token's own staking token
    ctx(&stnear(), 0, T0 + 900);
    let _ = c.ft_on_transfer(acc("fan.testnet"), U128(NEAR), format!(r#"{{"fund_yield":"{}"}}"#, token()));
    assert_eq!(c.tok(0).linear_shares, shares0 + NEAR);
    // agent pay is credited in stNEAR, not LiNEAR
    c.tok_mut(0).last_linear_price = NEAR;
    c.tok_mut(0).agent_budget_shares = 10 * NEAR;
    ctx(&c.tok(0).agent_account.clone(), crate::agent::POST_DEPOSIT, T0 + 901);
    c.agent_post(token(), "gm".into());
    let claims = c.get_claimable(c.tok(0).agent_account.clone());
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].0, stnear());
    assert_eq!(c.get_claimable_linear(c.tok(0).agent_account.clone()).0, 0);
    // withdrawing clears it
    let agent = c.tok(0).agent_account.clone();
    ctx(&agent, 1, T0 + 902);
    let _ = c.withdraw_linear();
    assert!(c.get_claimable(agent).is_empty());
}

#[test]
#[should_panic(expected = "ERR_WRONG_STAKE_TOKEN")]
fn linear_cannot_fund_an_stnear_token() {
    let (mut c, _) = graduated_on(true);
    ctx(&acc("linear-protocol.testnet"), 0, T0 + 900);
    let _ = c.ft_on_transfer(acc("fan.testnet"), U128(NEAR), format!(r#"{{"fund_yield":"{}"}}"#, token()));
}

#[test]
fn stnear_queue_below_one_near_is_refunded_in_near() {
    let (mut c, _) = graduated_on(true);
    // empty the whale's sell-out leftover so only a small late buy is queued
    let mut q = c.mq(0);
    q.entries.clear();
    q.total = 0;
    c.set_mq(0, &q);
    let _ = buy(&mut c, "late.testnet", NEAR / 2, T0 + 650);
    assert!(c.mq(0).total > 0 && c.mq(0).total < NEAR);
    ctx_rich(&acc("keeper.testnet"), T0 + 660);
    let _ = c.process_migration_buys(token());
    let q = c.mq(0);
    assert_eq!(q.total, 0, "refunded instead of a stake Meta Pool would refuse");
    assert!(!q.busy);
}

#[test]
fn new_pools_use_the_one_percent_fee() {
    let (c, _) = graduated();
    assert_eq!(c.pool_fee_bps(), crate::guard::NEW_POOL_FEE_BPS.max(c.config.ref_pool_fee));
    assert_eq!(c.get_config().ref_pool_fee, c.pool_fee_bps());
}

fn locked(days: u64) -> (Contract, u128) {
    let mut c = launched();
    let out = buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    ctx(&token(), 0, T0 + 300);
    c.ft_on_transfer(acc("bob.testnet"), U128(out), format!(r#"{{"action":"lock","days":{days}}}"#));
    ctx(&acc("bob.testnet"), 0, T0 + 301);
    c.set_allocation(token(), [0, 0, 10_000, 0, 0]);
    (c, out)
}

#[test]
fn expired_lock_loses_weight_without_owner_action() {
    let (mut c, out) = locked(180);
    assert_eq!(c.tok(0).total_weight, out * 4);
    ctx(&acc("keeper.testnet"), 0, T0 + 300 + 100 * DAY);
    assert!(!c.has_expired_locks(token()));
    assert_eq!(c.process_expired_locks(token(), None), 0);
    assert_eq!(c.tok(0).total_weight, out * 4, "not expired yet");

    ctx(&acc("keeper.testnet"), 0, T0 + 300 + 181 * DAY);
    assert!(c.has_expired_locks(token()));
    assert_eq!(c.process_expired_locks(token(), None), 1);
    let p = c.get_position(token(), acc("bob.testnet")).unwrap();
    assert_eq!(p.weight.0, 0);
    assert_eq!(p.amount.0, out, "tokens stay withdrawable");
    assert_eq!(c.tok(0).total_weight, 0);
    assert_eq!(c.tok(0).alloc_tally[2], 0);
    assert!(!c.has_expired_locks(token()));

    // the owner can still unlock afterwards
    ctx(&acc("bob.testnet"), 0, T0 + 300 + 182 * DAY);
    c.unlock(token());
    assert_eq!(c.tok(0).total_locked, 0);
}

#[test]
fn extended_lock_is_not_expired_early() {
    let (mut c, _) = locked(7);
    ctx(&acc("bob.testnet"), 0, T0 + 300 + 5 * DAY);
    c.extend_lock(token(), 30);
    let w = c.tok(0).total_weight;
    ctx(&acc("keeper.testnet"), 0, T0 + 300 + 10 * DAY);
    assert_eq!(c.process_expired_locks(token(), None), 0, "original 7-day bucket is stale");
    assert_eq!(c.tok(0).total_weight, w);
    ctx(&acc("keeper.testnet"), 0, T0 + 300 + 40 * DAY);
    assert_eq!(c.process_expired_locks(token(), None), 1);
    assert_eq!(c.tok(0).total_weight, 0);
}

#[test]
fn pool_opens_at_the_target_market_cap_after_the_burn() {
    let mut c = launched();
    // the market cap shown on the curve already excludes the LP tokens graduation will burn
    let before = c.get_token(token()).unwrap();
    let projected_burn = c.expected_grad_burn(c.tok(0).v_near, c.tok(0).v_tokens);
    assert!(projected_burn > 0);
    assert_eq!(before.fdv_near.0, math::fdv_near(before.v_near.0, before.v_tokens.0, 1_000_000_000 * TOK - projected_burn));
    let target = usd(&c, before.grad_fdv_near.0);
    assert!((target - 15_000.0).abs() < 15.0, "curve target {target}");
    drop(before);

    // fill the curve
    buy(&mut c, "bob.testnet", 5 * NEAR, T0 + 200);
    buy(&mut c, "whale.testnet", 2_500 * NEAR, T0 + 201);
    let t = c.tok(0).clone();
    assert_eq!(t.grad_stage, GradStage::CreatePool);
    // the burn graduation did is the one predicted at launch
    assert!(t.burned.abs_diff(projected_burn) <= projected_burn / 10_000, "burn {} vs {}", t.burned, projected_burn);
    // Ref opens at the final curve price; on the supply that exists now that is the target
    let mcap = usd(&c, math::fdv_near(t.v_near, t.v_tokens, 1_000_000_000 * TOK - t.burned));
    assert!((mcap - 15_000.0).abs() < 15.0, "pool opens at {mcap}");
    // and the market cap the views report doesn't jump at migration
    let after = c.get_token(token()).unwrap();
    assert!((usd(&c, after.fdv_near.0) - mcap).abs() < 1.0);
}

#[test]
fn expected_burn_matches_graduation_for_the_3k_to_30k_curve() {
    let mut c = launched();
    ctx(&lp(), 0, T0 + 50);
    c.set_launch_mcap_usd(3_000, 30_000);
    let (v0, vt) = (c.launch_virtual_near(), c.config.virtual_tokens.0);
    let burn = c.expected_grad_burn(v0, vt) / TOK;
    // ~38.2M of the 240M LP reserve (HHHHHH on testnet burned 38.24M)
    assert!((37_500_000..=39_000_000).contains(&burn), "burn {burn}");
}
