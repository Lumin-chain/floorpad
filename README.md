# Floorpad

A NEAR meme-coin launchpad where every token has a **floor that only goes up**, live **chat**, tracked **callouts**, a **holder DAO** and its own **AI agent**. It works on phones and desktops.

For how it compares with pump.fun, LetsBonk, four.meme, Virtuals, Clanker and meme.cooking, with sources, see [docs/COMPARISON.md](docs/COMPARISON.md).

## Token economics

| | |
|---|---|
| Supply | 1B tokens (18 decimals): 800M sold on the curve, up to 200M for the LP. No premint and no dev allocation |
| Curve | Constant product on virtual reserves (x·y=k). Each launch sizes its virtual NEAR reserve from the **on-chain NEAR/USD price**, so every token graduates at **~$15k FDV** (`grad_mcap_usd`) |
| At NEAR = $3.59 | Starts at ~$0.9k mcap, ~850 NEAR (~$3.05k) raised, graduates at ~4,178 NEAR ≈ $15k (≈15.4× from launch) |
| Buy fee | **1%** |
| Sell fee | **2%**, plus an **exit fee** that falls from 10% to 0 over 7 days of holding (age is tracked by the token contract) |
| Fee split | 50% floor vault · 30% creator (half claimable any time, half released by DAO vote and can be clawed back) · 20% platform |
| Graduation | Of the raise: 15% seeds the floor vault, 1% platform fee, 0.5 NEAR covers storage, and the rest becomes Ref `MEME/LiNEAR` liquidity at exactly the final curve price. LP tokens not needed are **burned**. The LP is locked forever and earns staking yield |
| Floor | Anyone can redeem for their share of the vault (2% fee plus the exit fee, both stay in the vault). Redeemed tokens are burned. Starts at ~2–3% of the graduation price and only rises |
| Epochs | Staking yield (never principal): 5% to the platform, the rest split by ve-weighted vote across floor, buyback & burn, airdrop to lockers, AI agent budget and DAO treasury |
| Anti-snipe | Max 20M tokens (2% of supply) per wallet for the first 120 s |
| Launch fee | 1.5 NEAR (0.5 DAO deposit + 0.3 token account; 0.7 to the platform) |

## DAO rules

- Each token gets a Sputnik DAO. The launchpad is its staking contract, so **lock weight (1× at 7 days → 4× at 180 days) is vote weight**.
- **Only lockers can create proposals** (0.1 NEAR bond, refunded unless the proposal is voted down as spam).
- A proposal passes only when **more than 70% of all delegated lock weight votes yes**. Policy changes, upgrades and vote-token changes need **more than 80%**. Sputnik's ratio threshold is strict (`floor(total × 7/10) + 1`).
- The DAO can release or claw back creator escrow, change the AI agent's persona and operator, fund bounties, and make any call (for example, a House of Stake lock). It **cannot touch the floor vault's principal**.

## Repo

```
contracts/
  meme-token/   NEP-141 + holding-age tracking + owner burn (deployed once as a global contract)
  launchpad/    USD-sized curve · fees · vault · ve-locks · Sputnik wiring · graduation · epochs · agent · price feed
agent/          keeper: NEAR/USD price feed (CoinGecko + Binance), finalize DAO, graduate, settle epochs; AI agent poster
server/         social API: per-token chat + callouts (NEP-413 wallet sign-in, SSE live updates, node:sqlite, zero runtime deps)
web/            Next.js app (mobile-first, PWA): explore, launch, trade sheet, chat, callouts, floor, lock & vote, DAO, treasury, agent
deploy/         testnet + mainnet configs, near-cli-rs deploy script
docs/           competitor comparison
```

## Run it

```bash
# contracts (Rust 1.86 pinned; a short target dir avoids Windows LNK1104)
cd contracts && export CARGO_TARGET_DIR=~/.cargo-target/floorpad
cargo test && cargo build --target wasm32-unknown-unknown --release

# deploy (near-cli-rs); NET=mainnet uses deploy/config.mainnet.json
MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet ./deploy/deploy-testnet.sh

# keeper + agent (operator = price_feeder)
cd agent && cp .env.example .env && npm install && npm start

# social API (Node >= 23.6)
cd server && cp .env.example .env && npm start          # tests: npm test

# web
cd web && cp .env.example .env.local && npm install && npm run dev
```

The testnet config targets a **$100** graduation (about 5.7 NEAR at $3.59) so a demo token can graduate with faucet funds. Mainnet uses $15,000.

## How chat and callouts work

- **Sign-in:** the wallet signs a NEP-413 message once. There's no transaction and no gas. The server checks the signature and confirms the key is a full-access key of the account on-chain.
- **Chat:** live through SSE. Each message carries a **DEV** badge for the creator and the sender's **% of supply** (wallet plus locked), read on-chain when they post. The creator can hide messages in their own token's chat, and admins can hide any.
- **Callouts:** a callout stores the market cap at the time of the call (curve price before graduation, Ref pool price after). The server updates current and peak values every minute for 30 days, and the **Top callers** leaderboard ranks callers by average peak multiple.

## Status

**Verified locally:**
- 39 contract unit tests pass, covering:
  - USD sizing at $3.59 (graduation ≈ $15k)
  - the price-feed staleness check and the 2× per-update limit
  - buy and sell fees, the fee split, creator claims
  - graduation: vault seed, platform fee, LP priced at the final curve price, burning unused LP tokens
  - the platform cut of epoch yield
  - the DAO policy (>70%, lockers-only)
  - the earlier coverage of locks, redemptions, the agent budget and the DAO-only methods
- Both wasm files build.
- The NEP-413 verifier passes 4 tests.
- The social API passed a smoke test of every route.
- The web app typechecks and `next build` passes.
- I checked the UI at 375×812 (mobile) and 1280×860 (desktop) against a mock RPC.

**Not yet verified on-chain:**
- the Sputnik factory and hand-over,
- Ref pool creation and add-liquidity,
- LiNEAR staking,
- the buyback swap,
- signMessage across real wallets (MyNearWallet's redirect flow especially),
- the cost of deploying the token code as a global contract.

The NEAR/USD price comes from a keeper, because Pyth Core no longer supports NEAR. That puts trust in the feeder, limited by the 2× cap, the staleness limit and the owner's override. The contracts have not been audited.
