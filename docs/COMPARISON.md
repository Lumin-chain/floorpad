# Floorpad vs other launchpads

Researched 10 Nov 2026. Most competitor figures come from third-party guides, not official fee pages, and the sources often disagree. Where they conflict, I give a range and link both. Recheck before quoting any number publicly.

## Side by side

| | pump.fun (Solana) | LetsBonk (Solana) | four.meme (BNB) | Virtuals (Base) | Clanker (Base) | meme.cooking (NEAR) | **Floorpad (NEAR)** |
|---|---|---|---|---|---|---|---|
| Launch model | Bonding curve | Bonding curve | Bonding curve | Bonding curve | Direct Uniswap pool | Fair auction, single price | **Bonding curve, sized in USD** |
| Moves to a DEX at | ~$69k mcap (~85 SOL) [1][2] | ~85 SOL raised [3] | ~$50–80k mcap (sources differ) [4][5] | 42,000 VIRTUAL raised [6] | Trades on a DEX from the start | ≥4k NEAR deposited [7] | **~$15k mcap**, recalculated from the live NEAR price at each launch |
| Curve fee | 1.25% both ways (0.95% protocol, 0.30% creator) [8] | ~1% [3] | 1%, plus optional creator tax of 1–10% [4] | not verified | 1% LP fee [9] | n/a | **1% buy, 2% sell**, plus an exit fee of 10% → 0 over 7 days |
| Creator reward | 0.30% on the curve; tiered after graduation [8][10] | ~0.1% [3] | Optional tax | not verified | 40% (v3) / 80% (v4) of the LP fee [9] | not stated | **30% of fees** (0.3% buy, 0.6% sell). Half claimable any time, half unlocked by holder vote and can be clawed back |
| Liquidity after graduation | PumpSwap | Raydium | PancakeSwap | Locked 10 years [6] | Locked forever [9] | LP locked [7] | **Locked forever, paired with LiNEAR so it earns staking yield** |
| Redeemable floor price | – | – | – | – | – | – | **Yes.** Funded by fees, exit fees, 15% of the graduation raise and staking yield. Redeemed tokens are burned |
| Penalty for quick dumps | – | – | Creator tax (optional) | – | – | – | **Sell fee is double the buy fee**, plus an exit fee based on how long you've held. Both go to remaining holders |
| Sniper protection | not verified | not verified | not verified | not verified | – | Single-price auction | **2% of supply per wallet for the first 120 s** |
| Holder governance | – | – | – | Agent-level (not verified) | – | – | **A Sputnik DAO per token, run inside the app.** Lockers propose; a vote passes with >70% of lock weight (>80% for policy changes) |
| AI | – | – | – | AI-agent tokens | Agent social launches | – | **A per-token AI agent.** Holders vote its persona and its budget; it's paid per post from staking yield |
| Social features | Livestreams (partial rollout), DMs and group chat on mobile [11][12] | – | – | – | Farcaster | – | **Live chat per token**, plus **callouts** stamped with the market cap at the time of the call and tracked, with a caller leaderboard |
| Mobile | Native app (early ratings under 2.5★) [11] | Web | Web | Web | Farcaster clients | Web | **Installable web app (PWA)** with bottom navigation and a bottom-sheet trade panel |

For context, pump.fun's graduation rate fell to about **0.2–0.3%** of launches in mid-2026 [13][14]. On most platforms, almost every token dies on the curve.

## Where Floorpad is stronger

1. **Holders always have an exit price.** None of the platforms above lets holders redeem against a vault, so on all of them the price can go to zero.
2. **Dumping pays the holders who stay.** The 2% sell fee, the exit fee and redemption fees all go to the floor, where pump.fun charges both sides the same.
3. **Liquidity keeps earning.** pump.fun and LetsBonk LP is either locked and idle or not locked at all. Floorpad's locked LP earns NEAR staking yield.
4. **Graduation is easier and priced in dollars.** At ~$15k, versus about $69k on pump.fun, more tokens reach the DEX, and the target doesn't drift when NEAR's price moves.
5. **Creators are paid but accountable.** The creator share matches or beats pump.fun's 0.30%, but half of it depends on milestones the holders vote on.
6. **Engagement comes built in.** Chat, tracked callouts, a holder DAO and an AI agent come with every launch, which no single competitor in this table bundles.

## Where Floorpad is weaker (and what to do about it)

| Weakness | Mitigation |
|---|---|
| Platform revenue per trade is lower than pump.fun's (0.2–0.4% vs 0.95%) | 1% graduation fee, 5% of epoch yield and 0.7 NEAR net per launch. Raise these if the business needs more |
| A ~$15k graduation means thin starting liquidity (~$2.6k of NEAR on the LP side) | That was the target you asked for. The floor vault and buybacks soften it. A $30–50k target would give deeper liquidity |
| NEAR has fewer memecoin traders than Solana or BNB | Use NEAR Intents and HOT/Meteor wallet onboarding, and market the floor and the AI agents as the differentiator |
| Locks, a DAO and epochs are more to learn | Sensible defaults: allocations persist between epochs, and the trade flow never requires a lock |
| The NEAR/USD price is pushed by a keeper, because Pyth Core dropped NEAR after 31 Jul 2026 [15] | Two-source median, a 2× per-update cap, a 6-hour staleness limit, and the owner can override. Move to `price-oracle.near` once verified |
| Chat and callouts run on one off-chain server | Wallet-signed sign-in; the server could later be moved onto a decentralized backend |
| Not yet tested on-chain or audited | Run on testnet first (see the README), then get an audit before mainnet |

"Best" depends on what you optimize for. Floorpad is built to beat these platforms on holder protection, holder engagement and token survival, at the cost of lower platform take and more moving parts.

## Sources

1. [soltokencreator: pump.fun graduation](https://www.soltokencreator.io/blog/pump-fun-graduation-explained)
2. [moby.win: what is pump.fun](https://moby.win/learn/pumpfun/)
3. [memegateway: bonk.fun trading guide 2026](https://memegateway.com/academy/bonk-fun-trading-guide-2026/)
4. [openliquid: launching on four.meme 2026](https://openliquid.io/blog/how-to-launch-token-four-meme/)
5. [polymart: four.meme](https://polymart.app/crypto/four-meme)
6. [dextools: what is Virtuals Protocol 2026](https://dextools.io/news/what-is-virtuals-protocol-ai-agents-base-guide-2026)
7. [meme.cooking docs](https://docs.meme.cooking/)
8. [blofin: pump.fun fees explained](https://blofin.com/en/academy/education/pumpfun/pump-fun-fees-explained)
9. [paragraph: clanker pt1](https://paragraph.xyz/@matthewb/clanker-pt1), [introducing clanker v4](https://paragraph.xyz/@dish/introducing-clanker-v4)
10. [smithii: pump.fun creator fees 2026](https://smithii.io/en/pump-fun-creator-fees/)
11. [blockworks: pump.fun releases mobile app](https://blockworks.co/news/pumpdotfun-releases-mobile-app)
12. [cointelegraph: pump.fun brings livestream back](https://cointelegraph.com/news/memecoin-platform-pump-fun-brings-livestream-feature-back)
13. [dextools: pump.fun graduation rate 0.26% (2026)](https://www.dextools.io/news/pump-fun-graduation-collapse-solana-fees-2026)
14. [arxiv 2607.02823](https://arxiv.org/abs/2607.02823)
15. [Pyth: NEAR contract addresses](https://docs.pyth.network/price-feeds/contract-addresses/near)
16. [fomo app overview (social trading, no chat)](https://www.upshift.finance/blog/what-is-the-fomo-app), [airdropalert review](https://airdropalert.com/blogs/fomo-app-review/)
