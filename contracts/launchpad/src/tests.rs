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
        creation_fee: NearToken::from_near(3),
        dao_deposit: NearToken::from_near(1),
        token_account_deposit: NearToken::from_millinear(500),
        graduation_reserve: NearToken::from_millinear(500),
        min_trade: NearToken::from_millinear(100),
        total_supply: U128(1_000_000_000 * TOK),
        curve_supply: U128(800_000_000 * TOK),
        lp_supply: U128(200_000_000 * TOK),
        virtual_near: U128(30 * NEAR),
        virtual_tokens: U128(1_073_000_000 * TOK),
        trade_fee_bps: 100,
        fee_vault_bps: 7000,
        fee_creator_bps: 2000,
        max_exit_fee_bps: 1000,
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
fn launched() -> Contract {
    ctx(&acc("owner.testnet"), 0, T0);
    let mut c = Contract::new(cfg());
    ctx(&acc("alice.testnet"), 3 * NEAR, T0);
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
    assert_eq!(t.v_near.0, 30 * NEAR);
    assert!(t.deployed);
    // 3 NEAR fee - 1 DAO - 0.5 token account
    assert_eq!(c.platform_fees, 3 * NEAR / 2);
}

#[test]
#[should_panic(expected = "ERR_TICKER_TAKEN")]
fn duplicate_ticker_rejected() {
    let mut c = launched();
    ctx(&acc("bob.testnet"), 3 * NEAR, T0);
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
    assert_eq!(t.backing_near, fee * 70 / 100);
    assert_eq!(t.creator_escrow, fee * 20 / 100);
    assert_eq!(c.platform_fees - before_platform, fee * 10 / 100);
    assert_eq!(t.real_near, NEAR - fee);
    assert_eq!(t.holders, 1);
    assert_eq!(c.get_trades(token(), None).len(), 1);
}

#[test]
#[should_panic(expected = "ERR_LAUNCH_WALLET_CAP")]
fn anti_snipe_caps_launch_wallets() {
    let mut c = launched();
    buy(&mut c, "sniper.testnet", 10 * NEAR, T0 + 5);
}

#[test]
fn snipe_cap_lifts_after_window() {
    let mut c = launched();
    let out = buy(&mut c, "whale.testnet", 10 * NEAR, T0 + 200);
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
    buy(&mut c, "whale.testnet", 200 * NEAR, T0 + 201);
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

    let lp_shares = t.lp_shares;
    let ok = |v: u128| PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(v)).unwrap());
    ctx_results(T0 + 301, vec![ok(200_000_000 * TOK), ok(lp_shares)]);
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
    // LP NEAR ~= 200M tokens at the final curve price (~86 NEAR for these params).
    let lp_near = t.lp_near / NEAR;
    assert!((80..=90).contains(&lp_near), "lp_near {lp_near}");
    // Vault principal = pre-graduation fee backing + leftover raise.
    assert!(t.principal_near > 0);
    assert_eq!(t.backing_near, 0);
}

#[test]
fn partial_deposit_is_retryable() {
    let mut c = launched();
    buy(&mut c, "whale.testnet", 200 * NEAR, T0 + 201);
    ctx(&lp(), 0, T0 + 300);
    c.on_grad_pool_created(0, Ok(1));
    let amount = c.tok(0).lp_near + c.tok(0).backing_near;
    c.on_grad_staked(0, U128(NEAR), U128(amount), Ok(()));
    ctx_results(
        T0 + 301,
        vec![
            PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(200_000_000 * TOK)).unwrap()),
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
    // Principal untouched, yield left the vault.
    assert_eq!(t.principal_near, principal0);
    assert!(t.linear_shares >= principal_shares);
    assert_eq!(t.agent_budget_shares, yield_shares / 2);

    ctx(&acc("bob.testnet"), 0, T0 + 4001);
    let r = c.claim_rewards(token());
    assert!(r.0 + 1 >= yield_shares / 2 - 1_000 && r.0 <= yield_shares / 2);
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
    assert_eq!(t.linear_shares, shares0);
    assert!(math::shares_to_near(t.linear_shares, NEAR * 15 / 10) >= t.principal_near);
}

#[test]
fn redeem_after_graduation_pays_linear_and_burns() {
    let (mut c, bob) = graduated();
    let shares0 = c.tok(0).linear_shares;
    let q = c.quote_redeem(token(), U128(bob), 300);
    ctx(&lp(), 0, T0 + 500);
    let r = c.on_redeem_age(0, acc("bob.testnet"), U128(bob), U128(0), Ok(Some(U64(T0 + 200))));
    assert_eq!(r, U128(0));
    let t = c.tok(0);
    assert_eq!(t.burned, bob);
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
    assert_eq!(p["roles"][1]["kind"]["Member"], "1");
    assert_eq!(p["roles"][1]["vote_policy"]["policy"]["threshold"][0], 2);
}

#[test]
fn testnet_deploy_config_parses() {
    let raw = include_str!("../../../deploy/config.testnet.json")
        .replace("OWNER_ID", "owner.testnet")
        .replace("LAUNCHPAD_ID", "floorpad.testnet");
    let c: Config = near_sdk::serde_json::from_str(&raw).expect("config.testnet.json must match Config");
    ctx(&acc("owner.testnet"), 0, T0);
    let lp = Contract::new(c);
    // demo params: ~8.8 NEAR raise graduates a token
    let raise = math::curve_near_for_tokens(lp.config.virtual_near.0, lp.config.virtual_tokens.0, lp.config.curve_supply.0);
    assert!((8 * NEAR..10 * NEAR).contains(&raise));
}
