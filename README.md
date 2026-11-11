# Floorpad

A NEAR meme-coin launchpad where every token has a **strictly rising floor vault**, live **chat**, tracked **callouts**, a **holder Sputnik DAO**, an **instant trading console**, **referrals** and its own **AI agent**. Mobile-first, with a full desktop layout.

Target tracks:
- **Memecoins With Mechanics**: 100% on-chain mechanics, immutable parameters, zero admin keys (`get_admin_powers` proof), decaying exit fees, permanent Ref Finance MEME/LiNEAR LP, and an interactive 60-day simulator.
- **Social Money**: Official Sputnik DAO v2.3.1 with ve-lock vote weighting, Trezu format proposals, in-app treasury management, and bounties.

Live demo:
- **Web App**: https://web-production-964c7668.up.railway.app
- **Mechanics & Simulation Page**: https://web-production-964c7668.up.railway.app/mechanics
- **Social API & Trade Indexer**: https://social-production-2f105e1d.up.railway.app
- **Competitor Comparison**: [docs/COMPARISON.md](docs/COMPARISON.md)
- **Architecture & Status**: [docs/HANDOFF.md](docs/HANDOFF.md)

---

## ⚡ Try it in 2 minutes (For Judges & Screeners)

1. **Inspect On-Chain Mechanics & Live Simulation**:
   Navigate to [`/mechanics`](https://web-production-964c7668.up.railway.app/mechanics) to inspect the immutable contract config, cryptographic zero-admin proof, live mechanics audit log, and run the interactive 60-day floor growth simulator.
2. **Explore Tokens & Bonding Curves**:
   On the Home page, browse active bonding curves and graduated tokens. Spot prices dynamically size from live NEAR/USD on Ref pool #4512 to graduate at ~$15k FDV.
3. **Trade on the Curve or Instant Trading Console**:
   Open any token page. Switch between **Wallet Mode** and **⚡ Instant Mode** (deposit once, trade synchronously via `quick_buy` and `quick_sell` with 0 wallet popups). Switch between **Candles (OHLCV)** and **Line** chart modes with live trade stream.
4. **Inspect ve-Locks & Sputnik DAO**:
   Click the **Lock & vote** and **DAO** tabs. Tokens locked from 7 to 180 days receive 1.0× to 4.0× vote weight in the token's own Sputnik DAO v2.3.1 contract. Proposals require a strict >70% delegated vote threshold.
5. **Redeem Floor**:
   In the **Floor** tab, redeem tokens for your share of the vault. Redeemed tokens are burned permanently, raising the floor for all remaining holders.

---

## Token Economics

| Parameter | Specification |
|---|---|
| **Supply** | 1B tokens (18 decimals): 760M sold on curve, up to 240M for LP. No premint and no dev allocation. |
| **Curve** | Constant product on virtual reserves. Virtual NEAR sized from **NEAR/USD read on-chain from Ref pool #4512**, so every token graduates at **~$15k FDV**. |
| **Taxes & Asymmetry** | **1.25% buy fee / 2.50% sell fee**, plus an **exit fee** that falls from 10% to 0% over 7 days of holding. |
| **Fee Split** | **70% to floor vault** · 10% creator (half claimable, half locked until DAO releases) · 20% platform (of which **20% is credited to the trade's referrer**). |
| **Graduation** | At ~$15k FDV: seeds floor vault, 100% of LP shares locked forever in Ref `MEME/LiNEAR` pool. Unused LP tokens are burned. LP earns staking yield. |
| **Floor Vault** | Redeem any time for your share of the vault. Redeemed tokens are permanently burned. Floor strictly rises monotonically. |
| **Epoch Yield** | Staking yield + sponsor donations: split by ve-weighted holder vote across floor, buyback & burn, airdrop to lockers, AI agent budget, and DAO treasury. |
| **Instant Trading** | In-contract trading account (`trading.rs`): non-payable `quick_buy` and `quick_sell` callable with function-call keys; custody tracks weighted holding age. |
| **Anti-Snipe** | Max 20M tokens (2% of supply) per wallet for the first 120 seconds. |
| **No Admin** | Zero owner keys, zero `set_config` methods. Platform fees only sweep to fixed `treasury_id`. Keys deleted with `LOCK=1`. |

---

## DAO Rules (Official Sputnik DAO v2.3.1)

- Each token's DAO runs the **official Sputnik v2.3.1 code by global hash** `DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF`, deployed at `<sym>-dao.<launchpad>`.
- The launchpad is each DAO's staking contract: **lock weight (1× at 7 days → 4× at 180 days) is the vote weight**.
- **Only lockers create proposals** and vote. A proposal passes only with **more than 70% of delegated lock weight** (>80% for policy changes and upgrades).
- **Bounties:** Holders fund bounties by vote; anyone claims and submits finished work, and lockers vote to pay.
- All DAO proposals use Trezu-compatible formatting, allowing viewing in Trezu and other Sputnik interfaces.

---

## Repo Map

```
contracts/
  meme-token/          NEP-141 + ft_holding_since (holding age) + owner-only burn
  launchpad/src/
    lib.rs             Config (immutable), state, fee distribution, ft_on_transfer router, events, mech log
    curve.rs           create_token (Ref pool #4512 callback), buy/sell, referrals, creator fees
    trading.rs         instant trading account: deposit_trading, quick_buy/quick_sell, custody
    dao.rs             deploys Sputnik v2.3.1 by global hash, finalize_dao, holders policy
    graduation.rs      vault seed, Ref LP at final curve price, burn unused LP, LiNEAR staking
    epoch.rs           settle_epoch: yield split by vote, buyback & burn, airdrop, treasury
    vault.rs           floor redemption, LiNEAR withdrawals
    ve.rs              locks + delegation (launchpad is each DAO's staking contract)
    agent.rs           per-token AI agent budget/posting
    views.rs           quotes, trades, mech log, get_admin_powers, referral balances
    tests.rs           54 unit tests (51 launchpad + 3 meme-token; all pass)
agent/                 keeper (price, finalize_dao, advance_graduation, settle_epoch) + AI poster
server/                social API & trade indexer: chat, callouts, trades, candles (OHLC), NEP-413 sign-in, SSE
web/                   Next.js 15 / React 19 app (mobile-first + desktop, PWA, brand assets)
  src/app/mechanics/   Interactive 60-day simulator + live parameter audit
deploy/                config.testnet.json, config.mainnet.json, deploy-testnet.sh, fetch-sputnik.mjs
e2e/                   testnet.mjs (resumable full lifecycle), dao-check.mjs
docs/                  COMPARISON.md, HANDOFF.md
```

---

## How to Build and Run

```bash
# 1. Contracts (Rust 1.86 pinned)
cd contracts
export CARGO_TARGET_DIR=~/.cargo-target/floorpad # on Windows: $env:CARGO_TARGET_DIR = "$HOME\.cargo-target\floorpad"
cargo test
cargo build --release --target wasm32-unknown-unknown

# 2. Server (Social API & Trade Indexer)
cd server
npm install
npm test
npm start

# 3. Web App
cd web
npm install
npm run typecheck
npm run build
npm run dev

# 4. Agent / Keeper
cd agent
npm install
npm run once # one keeper pass, or npm start for loop
```

---

## Verified & Tested

- **Unit tests:** **54/54 contract tests pass**, plus 4/4 NEP-413 server tests.
- **Wasm compilation:** Both `floorpad-launchpad` and `meme-token` compile to `wasm32-unknown-unknown` release targets with zero errors.
- **TypeScript & Build:** `tsc --noEmit` and `next build` pass with zero type errors across all packages.
- **On Testnet against real Ref Finance & LiNEAR contracts (`e2e/testnet.mjs`):**
  - Token deployed from global code by hash
  - Curve buy (with referrer credited) and sell (2.5% + exit fee)
  - 30-day lock
  - Curve sell-out → graduation: Ref pool MEME/LiNEAR created, 100% LP shares held by launchpad, pool opened at curve price, vault staked into LiNEAR, ~38M unused LP tokens burned
  - Yield funding → epoch split by vote → Ref buyback & burn, airdrop accrued, agent budget funded
  - Floor redemption & burn
  - LiNEAR withdrawal
- **Testnet DAO check against official Sputnik v2.3.1 (`e2e/dao-check.mjs`):**
  - Launcher policy init and hand-over
  - Staking contract = launchpad
  - Delegation 70/30
  - Strictly >70% passes, exactly 70% rejected
  - Bounties funded, claimed, delivered, and paid

---

## Disclosures & Security

- Contracts are deployed on NEAR Testnet for evaluation.
- Meme tokens are volatile; Floorpad's redeemable vault sets a mathematically rising floor, but does not eliminate market risk.
- Smart contracts have not yet undergone a third-party security audit.
