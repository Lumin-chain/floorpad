#![allow(unused_must_use)]
use super::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

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
        owner_id: acc("owner.testnet"),
        token_code_account: acc("token-code.floorpad.testnet"),
        sputnik_factory: acc("sputnik-v2.testnet"),
        ref_exchange: acc("ref-finance-101.testnet"),
        linear: acc("linear-protocol.testnet"),
        default_agent: acc("agent.floorpad.testnet"),
        creation_fee: NearToken::from_millinear(1500),
        dao_deposit: NearToken::from_millinear(500),
        token_account_deposit: NearToken::from_millinear(300),
        graduation_reserve: NearToken::from_millinear(500),
        min_trade: NearToken::from_millinear(100),
        total_supply: U128(1_000_000_000 * TOK),
        curve_supply: U128(800_000_000 * TOK),
        lp_supply: U128(200_000_000 * TOK),
        virtual_tokens: U128(1_073_000_000 * TOK),
        grad_mcap_usd: 15_000,
        max_price_age_secs: 6 * 3600,
        price_feeder: acc("keeper.testnet"),
        buy_fee_bps: 100,
        sell_fee_bps: 200,
        fee_vault_bps: 5000,
        fee_creator_bps: 3000,
        creator_instant_bps: 5000,
        grad_vault_bps: 1500,
        grad_platform_bps: 100,
        yield_platform_bps: 500,
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
    let id = c.create_token(meta(), None);
    assert_eq!(id, token());
    ctx(&lp(), 0, T0);
    c.on_token_deployed(0, Ok(()));
    c.on_dao_created(0, Ok(true));
    assert_eq!(c.tok(0).dao_stage, DaoStage::Created);
    c.tok_mut(0).dao_stage = DaoStage::Finalizing;
    c.on_dao_finalized(0, Ok(lp().to_string()));
    assert_eq!(c.tok(0).dao_stage, DaoStage::Ready);
    c
}

fn buy(c: &mut Contract, who: &str, near: u128, ts: u64) -> u128 {
    ctx(&acc(who), near, ts);
    c.buy(token(), U128(0)).0
}

#[test]
fn create_sets_up_curve_and_dao_ids() {
    let c = launched();
    let t = c.get_token(token()).unwrap();
    assert_eq!(t.dao_id, acc("moon-fp.sputnik-v2.testnet"));
    assert!(t.deployed);
    // 1.5 NEAR fee - 0.5 DAO - 0.3 token account
    assert_eq!(c.platform_fees, 7 * NEAR / 10);
    // curve sized so it graduates at ~$15k FDV with NEAR at $3.59 (~4,178 NEAR)
    let grad = t.grad_fdv_near.0 / NEAR;
    assert!((4_170..=4_190).contains(&grad), "grad fdv {grad}");
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
    let fee = NEAR / 100;
    assert_eq!(t.backing_near, fee * 50 / 100);
    assert_eq!(t.creator_claimable, fee * 15 / 100);
    assert_eq!(t.creator_escrow, fee * 15 / 100);
    assert_eq!(c.platform_fees - before_platform, fee * 20 / 100);
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
    let r = c.on_sell_age(0, acc("bob.testnet"), U128(out / 2), U128(0), Ok(Some(U64(T0 + 200))));
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
    let r = c.on_sell_age(0, acc("bob.testnet"), U128(out), U128(100 * NEAR), Ok(None));
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
    assert_eq!(c.tok(0).sold, 800_000_000 * TOK);

    ctx(&lp(), 0, T0 + 300);
    c.on_grad_pool_created(0, Ok(42));
    assert_eq!(c.tok(0).grad_stage, GradStage::Stake);

    let price = NEAR * 12 / 10; // 1.2 NEAR per LiNEAR
    let amount = c.tok(0).lp_near + c.tok(0).backing_near;
    c.on_grad_staked(0, U128(price), U128(amount), Ok(()));
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
    // Raise ~850 NEAR: 15% seeds the floor, 1% platform, 0.5 NEAR reserve, rest is LP.
    let lp_near = t.lp_near / NEAR;
    assert!((705..=720).contains(&lp_near), "lp_near {lp_near}");
    // Ref opens exactly at the final curve price: lp_near / lp_tokens == v_near / v_tokens.
    let lhs = math::mul_div(t.lp_near, 1_000_000_000_000, t.lp_tokens);
    let rhs = math::mul_div(t.v_near, 1_000_000_000_000, t.v_tokens);
    assert!(lhs.abs_diff(rhs) <= 1, "{lhs} vs {rhs}");
    // Unused LP tokens are burned.
    assert!(t.lp_tokens < 200_000_000 * TOK);
    assert_eq!(t.burned, 200_000_000 * TOK - t.lp_tokens);
    // The floor starts at ~2-3% of the graduation price (vs ~0.4% before).
    let fdv = math::fdv_near(t.v_near, t.v_tokens, 1_000_000_000 * TOK - t.burned);
    let vault = math::shares_to_near(t.linear_shares, NEAR * 12 / 10);
    let pct = vault * 10_000 / fdv;
    assert!((200..=400).contains(&pct), "floor/price bps {pct}");
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
    c.on_grad_staked(0, U128(NEAR), U128(amount), Ok(()));
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
    let after_platform = yield_shares - yield_shares * 500 / 10_000;
    assert!(t.agent_budget_shares.abs_diff(after_platform / 2) <= 1);
    assert_eq!(c.get_claimable_linear(acc("owner.testnet")).0, yield_shares * 500 / 10_000);

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
    // only the 5% platform cut of the yield leaves; the rest compounds
    let platform = c.get_claimable_linear(acc("owner.testnet")).0;
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
    let dao = acc("moon-fp.sputnik-v2.testnet");
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
    // only lockers exist as a role: they create proposals and vote
    assert_eq!(p["roles"].as_array().unwrap().len(), 1);
    assert_eq!(p["roles"][0]["kind"]["Member"], "1");
    assert!(p["roles"][0]["permissions"].as_array().unwrap().iter().any(|x| x == "*:AddProposal"));
    // > 70% of lock weight to pass; > 80% for policy / upgrades
    assert_eq!(p["default_vote_policy"]["threshold"], near_sdk::serde_json::json!([7, 10]));
    assert_eq!(p["roles"][0]["vote_policy"]["policy"]["threshold"], near_sdk::serde_json::json!([4, 5]));
}

#[test]
fn testnet_deploy_config_parses() {
    let raw = include_str!("../../../deploy/config.testnet.json")
        .replace("OWNER_ID", "owner.testnet")
        .replace("LAUNCHPAD_ID", "floorpad.testnet");
    let c: Config = near_sdk::serde_json::from_str(&raw).expect("config.testnet.json must match Config");
    ctx(&acc("owner.testnet"), 0, T0);
    let lp = Contract::new(c);
    // testnet demo: $100 graduation target -> ~5.7 NEAR raise at $3.59
    let c = &lp.config;
    let v0 = math::virtual_near_for_mcap(c.grad_mcap_usd, 3_590_000, c.virtual_tokens.0, c.curve_supply.0, c.total_supply.0);
    let raise = math::curve_near_for_tokens(v0, c.virtual_tokens.0, c.curve_supply.0);
    assert!((5 * NEAR..7 * NEAR).contains(&raise), "testnet raise {}", raise / NEAR);
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
    assert_eq!(q_buy.fee.0, 10 * NEAR / 100); // 1%
    assert_eq!(q_sell.fee.0, sell_gross * 2 / 100); // 2%
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
    ctx(&acc("keeper.testnet"), 0, T0 + 60);
    c.set_near_usd_price(U128(3_600_000));
    c.set_near_usd_price(U128(9_000_000));
}

#[test]
fn launch_price_tracks_near_usd() {
    // NEAR doubling halves the virtual NEAR so the USD target stays $15k
    let v_a = math::virtual_near_for_mcap(15_000, 1_590_000, 1_073_000_000 * TOK, 800_000_000 * TOK, 1_000_000_000 * TOK);
    let v_b = math::virtual_near_for_mcap(15_000, 3_180_000, 1_073_000_000 * TOK, 800_000_000 * TOK, 1_000_000_000 * TOK);
    assert!(v_a.abs_diff(v_b * 2) <= 2);
}
