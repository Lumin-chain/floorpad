# Floorpad

A NEAR meme-coin launchpad where every token has a **floor that only goes up**, live **chat**, tracked **callouts**, a **holder DAO**, **referrals** and its own **AI agent**. Mobile-first, with a full desktop layout.

For how it compares with pump.fun, LetsBonk, four.meme, Virtuals, Clanker and meme.cooking, and what Floorpad reuses from Sputnik DAO and Trezu, see [docs/COMPARISON.md](docs/COMPARISON.md).

## Token economics (v3)

| | |
|---|---|
| Supply | 1B tokens (18 decimals): 760M sold on the curve, up to 240M for the LP. No premint and no dev allocation |
| Curve | Constant product on virtual reserves (1.16B virtual tokens). Each launch sizes its virtual NEAR from **NEAR/USD read on-chain from Ref pool #4512**, so every token graduates at **~$15k FDV** |
| At NEAR = $3.59 | Starts at ~$1.8k mcap, ~1,095 NEAR (~$3.9k) raised, graduates at ~$15k (≈8.4× from launch) |
| Buy / sell fee | **1.25% / 2.5%**, plus an **exit fee** that falls from 10% to 0 over 7 days of holding |
| Fee split | 40% floor vault · 25% creator (half claimable any time, half released by DAO vote and can be clawed back) · 35% platform, of which **20% goes to the trade's referrer** |
| Graduation | Of the raise: 15% seeds the floor vault, 1% platform fee, 0.5 NEAR storage, and the rest becomes Ref `MEME/LiNEAR` liquidity at the final curve price. Unused LP tokens are **burned**. The LP is locked forever and earns staking yield |
| Floor | Redeem any time for your share of the vault (2% fee plus the exit fee, both stay in the vault). Redeemed tokens are burned. Starts at **~4% of the graduation price** and only rises |
| Epochs | Staking yield plus any sponsor **yield funding**: 10% to the platform, the rest split by ve-weighted vote across floor, buyback & burn, airdrop to lockers, AI agent budget and DAO treasury |
| Anti-snipe | Max 20M tokens (2% of supply) per wallet for the first 120 s |
| Launch fee | 1.5 NEAR (0.5 DAO + 0.3 token account; 0.7 to the platform) |

## DAO rules (official Sputnik DAO v2.3.1)

- Each token's DAO runs the **official Sputnik v2.3.1 code by global hash** `DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF`, the same code `sputnik-dao.near` deploys, at `<ticker>-dao.<launchpad>`. Token code is also used **by hash**, so it can't be swapped under live tokens.
- The launchpad is the DAO's staking contract: **lock weight (1× at 7 days → 4× at 180 days) is vote weight**.
- **Only lockers create proposals** and vote. A proposal passes only with **more than 70% of all delegated lock weight** (more than 80% for policy changes and upgrades).
- **Bounties:** holders fund a bounty by vote; anyone can claim it and submit the finished work, and lockers vote to pay.
- Proposals are written in Trezu's description format, so they read correctly in Trezu and other Sputnik UIs.
- The DAO can't touch the floor vault's principal.

## Repo

```
contracts/   meme-token (NEP-141 + holding age + burn) · launchpad (curve, fees, referrals, vault, ve-locks,
             Sputnik wiring, Ref/LiNEAR graduation, epochs, yield funding, agent, on-chain NEAR/USD)
agent/       keeper (refresh price, finalize DAO, graduate, settle epochs) + AI agent poster
server/      social API: chat + callouts (NEP-413 wallet sign-in, SSE, node:sqlite, zero runtime deps)
web/         Next.js app: NEAR Connect wallets (+ WalletConnect), mobile-first + desktop layouts, PWA
e2e/         testnet lifecycle test (testnet.mjs) + Sputnik DAO check (dao-check.mjs)
deploy/      configs (testnet/mainnet), deploy script, Sputnik code fetcher
docs/        competitor comparison + Sputnik/Trezu notes
```

## Run it

```bash
# contracts (Rust 1.86 pinned; a short target dir avoids Windows LNK1104)
cd contracts && export CARGO_TARGET_DIR=~/.cargo-target/floorpad
cargo test && cargo build --target wasm32-unknown-unknown --release

# deploy (near-cli-rs); NET=mainnet uses deploy/config.mainnet.json
MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet ./deploy/deploy-testnet.sh

# keeper + agent / social API / web
cd agent  && cp .env.example .env && npm install && npm start
cd server && cp .env.example .env && npm start            # tests: npm test
cd web    && cp .env.example .env.local && npm install && npm run dev
```

- RPC defaults use FastNEAR, because `rpc.*.near.org` is deprecated and rate-limited.
- Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to enable WalletConnect wallets.
- The testnet config targets a **$100** graduation so a demo token can graduate with faucet funds. Mainnet uses $15,000.

## Verified

**Unit tests:** 47 contract tests, plus 4 NEP-413 server tests.

**Testnet, against the real Ref Finance and LiNEAR contracts** (`e2e/testnet.mjs`, launchpad `fplpmwbbcg00.testnet`):
- token deployed from global code by hash
- curve buy (with referrer credited) and sell (2.5% + exit fee)
- 30-day lock
- curve sell-out → graduation in 4 steps:
  - Ref pool #2938 MEME/LiNEAR created
  - the launchpad holds 100% of the LP shares
  - the pool opened at the curve price
  - the vault was staked into LiNEAR
  - ~38M unused LP tokens burned
- sponsor yield funding → epoch split by vote → Ref **buyback and burn** executed on the token, airdrop accrued, agent budget funded
- floor redemption
- LiNEAR withdrawal (+0.174)
- agent post paid from its voted budget
- token supply on-chain = 1B − burned

**Testnet DAO check against the official Sputnik v2.3.1 code** (`e2e/dao-check.mjs`):
- launcher policy init and two-proposal hand-over
- staking contract = launchpad
- launcher role removed
- delegation 70/30
- a non-locker can't create proposals
- **exactly 70% doesn't pass, more than 70% does**
- a bounty funded by vote, claimed and delivered by a non-holder, then paid
- undelegation on unlock

**Not yet run on chain:**
- The launchpad's own `finalize_dao` promise chain. It sends the same calls verified above, but needs the Sputnik code deployed globally on testnet (~44 NEAR; the faucet was rate-limited).
- NEAR Connect signing with real wallets. The wallet picker loads in the app, but no transaction was signed.

**Not done:** a security audit.
