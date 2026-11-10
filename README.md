# Floorpad

A NEAR meme-coin launchpad where every token has a **floor that only goes up**.

* **Floor vault.** Curve fees and exit fees back each token. Anyone can redeem at the floor at any time, and redeemed tokens are burned.
* **LP that earns yield.** At graduation, liquidity goes into a Ref `MEME/LiNEAR` pool. The LP is locked forever and earns NEAR staking yield.
* **ve-locks.** Lock 7–180 days for 1×–4× weight. Weight is your DAO vote, your yield-allocation vote and your airdrop share.
* **Holder DAO.** Each token gets its own Sputnik DAO. The launchpad is the DAO's staking contract, so lock weight is Sputnik vote weight. Proposals are created, voted on and executed inside the Floorpad UI, with no Astra or Trezu links.
* **Epoch yield vote.** Staking yield, never principal, is split by vote across floor, buyback & burn, airdrop to lockers, the AI agent and the DAO treasury.
* **AI agent.** Each token has an agent whose persona is set by DAO vote. After graduation, every post is paid on-chain from the agent budget that holders vote in. With no budget, it stops posting.
* **Anti-dump design.** Fair-launch wallet caps and a decaying exit fee (10% → 0 over 30 days, routed to the floor). The creator's fee share sits in escrow and is released by DAO milestones; the DAO can claw it back.

```
contracts/
  meme-token/   NEP-141 + holding-age tracking + owner burn (deployed once as a global contract)
  launchpad/    curve · vault · ve-locks · Sputnik wiring · Ref/LiNEAR graduation · epochs · agent
agent/          keeper (finalize DAO, graduate, settle epochs) + AI agent poster (NEAR AI Cloud / any OpenAI-compatible API)
web/            Next.js app: explore, launch, trade, floor, lock & vote, DAO, treasury, agent feed, portfolio
deploy/         testnet config + near-cli-rs deploy script
```

## Lifecycle

1. **Launch.** `create_token` (3 NEAR) deploys `<ticker>.<launchpad>` from the global token code, creates `<ticker>-fp.<sputnik factory>` with the launchpad as its sole council member, and opens the curve. Supply is 1B: 800M on the curve, 200M for LP. There is no premint.
2. **Activate DAO.** `finalize_dao` (permissionless) submits and approves two proposals: *set staking contract = launchpad* and *change policy to holders-only, token-weighted (50%; 66% for policy and upgrades)*. After this the launchpad has no DAO powers.
3. **Curve.** `buy` / sell via `ft_transfer_call {"action":"sell"}`. The 1% fee splits 70% vault, 20% creator escrow, 10% platform. Sells pay an exit fee based on the token's own weighted holding age.
4. **Graduate.** Selling out the curve freezes it. `advance_graduation` (permissionless, retryable) then runs: create Ref pool → stake NEAR into LiNEAR → deposit MEME + LiNEAR → add liquidity. LP is priced at the final curve price.
5. **Epochs.** `settle_epoch` reads the LiNEAR price, computes yield = vault shares − principal, and splits it by the live ve-weighted tally.
6. **Redeem.** `ft_transfer_call {"action":"redeem"}` pays NEAR before graduation and LiNEAR after, and burns the tokens.

## Run it

### Contracts
```bash
cd contracts
export CARGO_TARGET_DIR=~/.cargo-target/floorpad   # short path: avoids Windows LNK1104
cargo test                                         # 32 unit tests
cargo build --target wasm32-unknown-unknown --release
```
The toolchain is pinned to Rust 1.86 with near-sdk 5.26.1. Newer rustc emits wasm features that the NEAR VM may reject.

### Deploy (testnet, near-cli-rs)
```bash
MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet ./deploy/deploy-testnet.sh
```
The testnet config uses a 3 NEAR virtual reserve, so about 8.8 NEAR graduates a token. Epochs and DAO votes are 1 hour.

### Web
```bash
cd web && cp .env.example .env.local   # set NEXT_PUBLIC_LAUNCHPAD
npm install && npm run dev
```

### Agent / keeper
```bash
cd agent && cp .env.example .env       # LAUNCHPAD_ID, OPERATOR_ID, AI_API_KEY
npm install && npm start
```
The operator's key must be in `~/.near-credentials/<network>/`. Anyone can run the keeper. The "⚙" buttons on a token page run the same permissionless steps from the UI.

## Status: what is and isn't verified

**Verified locally:** 32 contract unit tests pass. They cover curve math, fee splits, anti-snipe caps, the exit-fee decay, locks, tallies, graduation accounting (including partial-deposit retry), epoch yield split, airdrop claims, post-graduation redemption raising the floor, agent budget gating, DAO-only methods and config parsing. Both wasm files build. The web app typechecks and `next build` passes.

**Not yet tested on-chain:** every cross-contract flow (Sputnik factory/finalize, Ref pool and liquidity, LiNEAR staking, buyback swap). Before the demo, confirm on testnet:
- `sputnik-v2.testnet` accepts `create` with the policy JSON in `dao.rs`, and the two-proposal hand-over succeeds.
- The `ref-finance-101.testnet` and `linear-protocol.testnet` account IDs and methods (`add_simple_pool`, `register_tokens`, `add_liquidity`, instant-swap `ft_transfer_call` msg; `deposit_and_stake`, `ft_price`).
- The cost of `deploy-as-global` for the token code.
- The NEAR AI Cloud model ID in `agent/.env`.

**Known limitations / next steps**
- Lock weight is fixed at lock time and doesn't decay. Weight changes reach the DAO on the next lock, unlock or `sync_delegation` call.
- The decaying exit fee applies to curve sells and floor redemptions only. Ref sells are untaxed by design, to keep the token composable.
- House of Stake works through the DAO's *custom call* proposal template. There is no dedicated veNEAR flow yet.
- The launchpad pays storage for positions and posts out of the creation fee. Production would charge per position.
- No security audit has been done.
