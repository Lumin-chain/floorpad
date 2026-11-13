# Floorpad — Handoff for the next engineer / AI editor

Last updated: 2026-11-11 (commit `c24a63b` on `main`).
Hackathon: NEAR Hackathon. **Submission deadline 14 Nov 2026 23:59 UTC**, judging 16–18 Nov.
Target tracks: **Memecoins With Mechanics** (judged on the mechanic: on-chain, immutable params, no admin key, simulation welcome) and **Social Money** (Sputnik DAO + Trezu).
Screeners use Claude Code / Codex to check that the repo builds and runs, so reproducibility matters.

---

## 1. What Floorpad is

A NEAR meme-coin launchpad where every token gets:

- a **bonding curve** that graduates at **~$15k market cap**, sized from the live NEAR/USD price read on-chain;
- a **redeemable floor vault** that only rises (redeem tokens for your share; redeemed tokens are burned);
- **sell tax > buy tax** (1.25% / 2.5%) plus an **exit fee** decaying 3% → 0 over 7 days of holding;
- at graduation, **LP locked forever** in a Ref Finance `MEME/LiNEAR` pool, so the liquidity earns staking yield and swap fees;
- **LP harvest** (`harvest_lp`, permissionless, once per epoch): removes only the LP growth above the graduation depth, burns the meme side, and adds the LiNEAR side to the epoch yield;
- **ve-locks**: lock weight (1× at 7 days → 4× at 180 days) is the vote weight in the token's **own Sputnik DAO**;
- DAO proposals pass only with **>70% of delegated lock weight** (>80% for policy/upgrades); only lockers may propose;
- **epoch yield split by holder vote**: floor, buyback & burn, airdrop to lockers, AI agent budget, DAO treasury;
- a per-token **AI agent**, live **chat**, tracked **callouts** (calls stamped with mcap, scored over time), **referrals** (20% of platform fee), **bounties**, and an **instant trading account** (deposit once, trade without wallet popups);
- everything (DAO, proposals, bounties, treasury) is managed **inside the app** — no links out to Astra/Trezu.

**No admin:** the launchpad has no owner and no `set_config`. Config is immutable. The deployer can't withdraw anything. Platform fees go only to a fixed `treasury_id`, through the permissionless `sweep_platform_fees()`. The deploy script deletes the launchpad's full-access keys (`LOCK=1`). `get_admin_powers` returns proof of this.

Full economics table: `README.md`. Competitor comparison and Sputnik/Trezu notes: `docs/COMPARISON.md`.

---

## 2. Where the code lives and where it deploys

| What | Where |
|---|---|
| Git repo (source of truth) | **https://github.com/Lumin-chain/floorpad**, branch `main`. Code must stay on Lumin-chain. |
| Local copy on the owner's PC | `C:\Users\Igboze\floorpad\floorpad` (clean clone, tracks `origin/main`) |
| Hosting | **Railway, the `igboze` Railway account**, project `floorpad` (existing project only; don't create new projects) |
| Web app (live) | https://usefloorpad.fun (custom domain) / https://web-production-964c7668.up.railway.app — service `web`, root dir `/web` |
| Social API (live) | https://social-production-2f105e1d.up.railway.app — service `social`, root dir `/server`, volume mounted at `/data` |
| Agent / keeper | **Not deployed yet** (needs secrets, see §6) |
| Contracts (testnet) | Launchpad `fplpmwbbcg00.testnet` — runs an **older v3 build**, not the latest no-admin / instant-trading code |
| Contracts (mainnet) | Not deployed |

### Railway ↔ GitHub note

- The Railway services are linked to `Lumin-chain/floorpad` and rebuild on changes under their watch path (`/web/**` for web).
- The Railway GitHub app is installed on the **GitHub org**, and installations are per-org, not per-Railway-account. So if the GitHub "Configure" page sends you to a different Railway account (e.g. a "lumin" one), that's just whichever Railway login your browser has. **It doesn't move the deployment and no new Railway account is needed.** What matters is that the installation allows the `floorpad` repo.
- If a push doesn't auto-deploy, trigger it from the `igboze` Railway dashboard (service → Deployments → Deploy latest commit) or via the Railway CLI/MCP. The last push (`c24a63b`) was deployed manually this way.
- `NEXT_PUBLIC_*` variables are baked in **at build time**, so changing them needs a rebuild.

### Railway variables (names only — values live in Railway, never in git)

- **web:** `PORT=8080`, `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_RPC`, `NEXT_PUBLIC_LAUNCHPAD`, `NEXT_PUBLIC_LINEAR`, `NEXT_PUBLIC_REF`, `NEXT_PUBLIC_SOCIAL_API`, `NEXT_TELEMETRY_DISABLED`; optional `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
- **social:** `PORT=8080`, `RAILPACK_NODE_VERSION=24`, `NEAR_NETWORK`, `NEAR_RPC`, `LAUNCHPAD_ID`, `LINEAR_ID`, `REF_ID`, `CORS_ORIGINS` (web domain), `DB_PATH=/data/floorpad-social.db`, optional `ADMINS`.
- **agent (to create):** `NEAR_NETWORK`, `NEAR_RPC`, `LAUNCHPAD_ID`, `OPERATOR_ID`, `OPERATOR_PRIVATE_KEY` (secret — **the owner enters it in Railway**), `AI_API_KEY` (secret), `AI_BASE_URL` (default NEAR AI cloud), `AI_MODEL`, `KEEPER_INTERVAL_SECS`, `POST_INTERVAL_SECS`.

---

## 3. Repo map

```
contracts/
  meme-token/          NEP-141 + ft_holding_since (holding age) + owner-only burn
  launchpad/src/
    lib.rs             Config (immutable), state, fee distribution, ft_on_transfer router, events, mech log
    curve.rs           create_token (prices NEAR/USD via Ref pool #4512 callback), buy/sell, referrals, creator fees
    trading.rs         instant trading account: deposit_trading, quick_buy/quick_sell (non-payable → function-call-key safe), custody
    dao.rs             deploys Sputnik v2.3.1 by global hash at <sym>-dao.<launchpad>, finalize_dao, holders policy
    graduation.rs      vault seed, LP at final curve price on Ref, burn unused LP, LiNEAR staking
    harvest.rs         harvest_lp: remove LP growth above the baseline depth, burn meme side, LiNEAR side -> epoch yield
    epoch.rs           settle_epoch: yield split by vote, buyback & burn, airdrop, platform cut → treasury
    vault.rs           floor redemption, LiNEAR withdrawals
    ve.rs              locks + delegation (launchpad is each DAO's staking contract)
    agent.rs           per-token AI agent budget/posting
    views.rs           quotes, trades, mech log, get_admin_powers, referral balances
    tests.rs           57 launchpad tests + 3 meme-token tests (all pass)
agent/src/index.ts     keeper (price, finalize_dao, advance_graduation, settle_epoch) + AI poster
server/src/            social API: chat, callouts + tracker, NEP-413 sign-in, SSE, node:sqlite (zero runtime deps)
web/src/               Next.js 15 / React 19 app (mobile-first + desktop, PWA)
  lib/                 wallet.tsx (NEAR Connect + WalletConnect), near.ts, social.ts, media.ts, proposal-format.ts
  components/          TradePanel, PriceChart(+TradesTable), Chat, Callouts, DaoPanel, Bounties, TreasuryPanel,
                       VaultPanel, LockPanel, AgentPanel, FundYield, OpsBar, Brand (Moji + SlabIcon), Mascot, Shell
  app/                 home, create, calls, portfolio, token/[id]
web/public/brand/      extracted brand assets (logo, wordmark, mascot poses, moji faces) — don't redesign
deploy/                config.testnet.json, config.mainnet.json (placeholders), deploy-testnet.sh, fetch-sputnik.mjs
e2e/                   testnet.mjs (resumable full lifecycle), dao-check.mjs, fixtures/; .state.json is gitignored
docs/                  COMPARISON.md, HANDOFF.md (this file)
```

---

## 4. How to build and run

**Contracts** (Rust **1.86** pinned — newer rustc emits wasm features the NEAR VM rejects; near-sdk 5.26.1):

```bash
cd contracts && CARGO_TARGET_DIR=~/.cargo-target/floorpad cargo test
cd contracts && CARGO_TARGET_DIR=~/.cargo-target/floorpad cargo build --release --target wasm32-unknown-unknown
```

On Windows the short `CARGO_TARGET_DIR` avoids the LNK1104 path-length error. Native release builds aren't used; only test and wasm builds are.

**Web:** `cd web && npm install && npm run dev`. Set the `NEXT_PUBLIC_*` variables in `web/.env.local`.
**Social server:** `cd server && npm install && npm start` (Node ≥ 23.6; runs TypeScript by type stripping). `npm test` runs the NEP-413 tests.
**Agent:** `cd agent && npm install && npm run once` (one keeper pass) or `npm start` (loop). It reads `.env` or the environment; the key comes from `OPERATOR_PRIVATE_KEY` or `~/.near-credentials`.
**Deploy contracts:** `MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet TREASURY=<dao> ./deploy/deploy-testnet.sh` (near-cli-rs). Use `NET=mainnet` for mainnet. `LOCK=1` (the default) deletes the launchpad keys at the end — this is irreversible by design.
**E2E:** `cd e2e && npm install && node testnet.mjs` (flags `SKIP_DAO`, `LOCK`). `node dao-check.mjs` checks the DAO lifecycle against Sputnik v2.3.1.

Key gotchas:
- Use FastNEAR RPC (`rpc.<net>.fastnear.com`). `rpc.*.near.org` is deprecated and rate-limited.
- Global contracts cost 10× storage: about 33 NEAR for the token code. Sputnik v2.3.1 is already global on mainnet (hash `DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF`). On testnet it costs about 44 NEAR to make it global.
- Pyth on NEAR is retired. Mainnet prices NEAR/USD from Ref pool #4512 (wNEAR/USDC) with a 20%/hour drift clamp. Testnet uses feeder mode (`set_near_usd_price`, callable only by the feeder).

---

## 5. Status

### Done and verified
- Contracts: the full feature set in §1. 60 unit tests pass. Wasm release compilation passes cleanly.
- **On testnet:** launch, buy/sell with referral, lock, graduation into Ref pool #2938 (MEME/LiNEAR, 100% of LP shares held by the launchpad), LiNEAR staking, epoch buyback & burn, airdrop, floor redemption, agent post. Full DAO lifecycle: >70% strict threshold, and a bounty paid to a non-holder (via `dao-check.mjs` on a normally deployed v2.3.1).
- Web app: mobile + desktop layouts, NEAR Connect, every token tab (trade, chart, chat, callouts, DAO, bounties, treasury, vault, lock, agent), brand assets, animated mascot, mascot "moji" faces and slab icons (no generic emoji).
- **Trading console UI & indexer (done):** Candlestick (OHLCV) / Line chart with timeframe switcher (1m, 5m, 15m, 1h, 1d), live trade streaming via SSE, live trades tape, Instant Trading Account management (`deposit_trading`, `withdraw_trading`, `withdraw_custody`, non-payable `quick_buy` / `quick_sell` execution), quick-size buttons, keyboard shortcuts (B/S, 1-4). Server-side SQLite trade indexer polls on-chain trades and aggregates candles.
- **Mechanics page for judges (done):** `/mechanics` route showing cryptographic zero-admin proof (`get_admin_powers`), immutable config parameter sheet (`get_config`), live on-chain mechanics audit log (`get_mech_log`), and interactive 60-day mathematical simulation of floor growth vs volume, fees, redemptions, and staking compounding.
- **README for screeners (done):** "Try it in 2 minutes" section, target tracks breakdown (Memecoins With Mechanics & Social Money), full economics spec, live app URLs.
- Social server live on Railway with persistent SQLite.
- Repo scanned: no keys, `.env` files, databases or personal data committed.

### Not done / not verified
1. **Redeploy the latest contracts to testnet.** `fplpmwbbcg00.testnet` runs old v3, without no-admin, treasury sweep or instant trading. Redeploy with a treasury and `LOCK=1`, re-run e2e, then update `NEXT_PUBLIC_LAUNCHPAD` / `LAUNCHPAD_ID` in Railway and rebuild web. This needs about 50+ testnet NEAR, mostly for the Sputnik global code.
2. **The launchpad's own `finalize_dao` path on testnet** hasn't run end-to-end (blocked by the Sputnik global cost). It was verified in unit tests and through the separate DAO check only.
3. **Real wallet signing in the browser** (Meteor/HOT/MyNearWallet through NEAR Connect) hasn't been clicked through on the live site.
3b. **LP harvest on chain**: `harvest_lp` is unit tested (math, flow, failed-withdraw retry) but not yet run against real Ref. Check on testnet that Ref's `remove_liquidity` returns the removed amounts (`Vec<U128>`) and that `withdraw` lands both tokens, then add a harvest step to `e2e/testnet.mjs`.
4. **Agent service on Railway**: create it with root dir `/agent` and start command `npm start`. The owner must add `OPERATOR_ID`, `OPERATOR_PRIVATE_KEY` and `AI_API_KEY`.
5. **Mainnet deploy** (optional for judging): about 45–50 NEAR (token global ~33.1 + launchpad ~8.4 + working balance). It needs a treasury Sputnik DAO first.
6. **Demo video + X post**: the owner does these.
7. Optional: a custom domain on Railway; removing the throwaway testnet account name from the README.

### Suggested order before the deadline
1 → 4 → 3 → 6. Mainnet (5) only if time and funds allow.

---

## 6. Rules for whoever continues

- **Never commit secrets** — no keys, `.env`, `e2e/.state.json` (throwaway testnet keys), `*.db` — and never hardcode values that belong in env vars. The owner enters private keys in Railway themselves.
- Keep code on **Lumin-chain/floorpad**. Deploy to the existing Railway project on the `igboze` account only.
- Don't redesign the brand assets in `web/public/brand/`. No generic emoji or stock-looking icons: use `Moji` faces (cool / wink / hero / flag) and `SlabIcon` from `web/src/components/Brand.tsx`.
- Don't reintroduce any owner/admin power in the launchpad contract. Fees go only to `treasury_id`.
- Contract params are immutable after deploy. Any change means a new launchpad account.
- Commit messages end with a `Co-Authored-By` line if an AI wrote the change.
