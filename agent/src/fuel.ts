/**
 * AI fuel: the agent turns what holders pay it into BRRRAIN, so its AI quota grows with funding.
 *
 * Holders fund a token's agent budget (votes or "Fund the agent"); every post is paid from that
 * budget in LiNEAR, credited to the operator on the launchpad. Every few hours this loop:
 *   1. withdraws the operator's claimable LiNEAR from the launchpad,
 *   2. keeps a share for gas and post deposits,
 *   3. swaps the rest LiNEAR -> ... -> BRRRAIN on Rhea along BRRRAIN_ROUTE (quoted, 2% max slippage),
 *   4. holds the BRRRAIN in the account behind the BRRRAIN API key (the operator, or
 *      BRRRAIN_HOLDER), which BRRRAIN pays out as daily Power from the next day (00:00 UTC).
 *
 * BRRRAIN only exists on mainnet (token.brrrain.near). On testnet, or with no route set, the loop
 * runs in dry-run mode: it logs what it would claim and buy and moves nothing.
 */
import type { Account } from "near-api-js";

const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

export interface FuelDeps {
  network: string;
  operator: Account;
  operatorId: string;
  launchpad: string;
  refExchange: string;
  linear: string;
  /** Runs one signed transaction at a time with the agent's other calls (shared nonce). */
  signed: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface Hop {
  pool: number;
  tokenOut: string;
}

const env = (k: string, d = "") => process.env[k] ?? d;
const EVERY_MS = Number(env("BRRRAIN_FUEL_HOURS", "6")) * 3600_000;
/** Share of the agent's pay turned into BRRRAIN; the rest stays as LiNEAR for gas. */
const FUEL_BPS = BigInt(Math.min(10_000, Math.max(0, Number(env("BRRRAIN_FUEL_BPS", "8000")))));
const MIN_LINEAR = BigInt(Math.round(Number(env("BRRRAIN_FUEL_MIN_LINEAR", "0.5")) * 1e6)) * 10n ** 18n;
const SLIPPAGE_BPS = 200n;

function fuelConfig(network: string) {
  const token = env("BRRRAIN_TOKEN", network === "mainnet" ? "token.brrrain.near" : "");
  // "pool:tokenOut,pool:tokenOut", starting from LiNEAR, ending at the BRRRAIN token
  const route: Hop[] = env("BRRRAIN_ROUTE")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [pool, tokenOut] = s.split(":");
      return { pool: Number(pool), tokenOut: tokenOut?.trim() ?? "" };
    });
  const routeOk = route.length > 0 && route.every((h) => Number.isInteger(h.pool) && h.tokenOut) && route[route.length - 1].tokenOut === token;
  const live = env("BRRRAIN_FUEL", network === "mainnet" ? "on" : "off") === "on" && !!token && routeOk;
  return { token, route, routeOk, live, holder: env("BRRRAIN_HOLDER") };
}

const fmt = (raw: bigint, dp = 4) => (Number(raw / 10n ** 18n) / 1e6).toFixed(dp);

/** One line for the startup SETUP block. */
export function fuelSetupLine(network: string): string {
  const c = fuelConfig(network);
  if (c.live) {
    return `✓ SETUP: AI fuel on: ${Number(FUEL_BPS) / 100}% of the agent's pay buys BRRRAIN (${c.token}) every ${EVERY_MS / 3600_000}h via pools ${c.route.map((h) => h.pool).join(" -> ")}${c.holder ? `, held by ${c.holder}` : ""}`;
  }
  const why = !c.token
    ? "no BRRRAIN token on this network"
    : !c.routeOk
      ? "set BRRRAIN_ROUTE (pool:tokenOut,... from LiNEAR to the BRRRAIN token)"
      : "BRRRAIN_FUEL is off";
  return `• SETUP: AI fuel in dry-run (${why}): the agent logs what it would buy and moves nothing`;
}

let lastRun = 0;

/** Claim the agent's LiNEAR pay and buy BRRRAIN with it (dry-run unless configured, see above). */
export async function fuelBrrrain(d: FuelDeps): Promise<void> {
  if (Date.now() - lastRun < EVERY_MS) return;
  lastRun = Date.now();
  const c = fuelConfig(d.network);
  const viewOn = <T>(contractId: string, methodName: string, args: object) =>
    d.operator.viewFunction({ contractId, methodName, args }) as Promise<T>;

  const claimable = BigInt(await viewOn<string>(d.launchpad, "get_claimable_linear", { account_id: d.operatorId }));
  const held = BigInt(await viewOn<string>(d.linear, "ft_balance_of", { account_id: d.operatorId }));
  // only newly earned pay is spent; what was kept for gas stays put
  const spend = (claimable * FUEL_BPS) / 10_000n;
  if (spend < MIN_LINEAR) {
    console.log(`AI fuel: ${fmt(claimable)} LiNEAR earned since the last buy (holding ${fmt(held)}), waiting for enough to buy BRRRAIN`);
    return;
  }

  if (!c.live) {
    console.log(
      `AI fuel (dry-run): would claim ${fmt(claimable)} LiNEAR and swap ${fmt(spend)} LiNEAR for BRRRAIN` +
        `${c.token ? ` (${c.token})` : ""}, keeping ${fmt(claimable - spend)} LiNEAR for gas. ${fuelSetupLine(d.network).replace(/^.*SETUP: /, "")}`,
    );
    return;
  }

  const call = (contractId: string, methodName: string, args: object, gasTgas: bigint, deposit: bigint) =>
    d.signed(async () => {
      const res = await d.operator.functionCall({ contractId, methodName, args, gas: gasTgas * TGAS, attachedDeposit: deposit });
      const failed = JSON.stringify(res.receipts_outcome.map((o) => o.outcome.status)).includes("Failure");
      console.log(`${failed ? "✗" : "✓"} AI fuel ${contractId}.${methodName} tx=${res.transaction.hash}`);
      return !failed;
    });

  // 1. claim the agent's pay
  if (!(await call(d.launchpad, "withdraw_linear", {}, 30n, ONE_YOCTO))) return;
  const balance = BigInt(await viewOn<string>(d.linear, "ft_balance_of", { account_id: d.operatorId }));
  const amountIn = spend < balance ? spend : balance;
  if (amountIn < MIN_LINEAR) return;

  // 2. quote the route on Rhea and set the minimum output
  let quoted = amountIn;
  let tokenIn = d.linear;
  for (const h of c.route) {
    quoted = BigInt(
      await viewOn<string>(d.refExchange, "get_return", { pool_id: h.pool, token_in: tokenIn, amount_in: quoted.toString(), token_out: h.tokenOut }),
    );
    tokenIn = h.tokenOut;
  }
  if (quoted === 0n) {
    console.warn("AI fuel: Rhea quoted 0 BRRRAIN for this route; skipping");
    return;
  }
  const minOut = (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;

  // 3. the operator must be registered on the BRRRAIN token to receive it
  const reg = await viewOn<unknown>(c.token, "storage_balance_of", { account_id: d.operatorId }).catch(() => null);
  if (!reg && !(await call(c.token, "storage_deposit", { account_id: d.operatorId, registration_only: true }, 10n, STORAGE_DEPOSIT))) return;

  // 4. swap in one transaction: LiNEAR -> ... -> BRRRAIN, sent back to the operator
  let from = d.linear;
  const actions = c.route.map((h, i) => {
    const a = {
      pool_id: h.pool,
      token_in: from,
      token_out: h.tokenOut,
      ...(i === 0 ? { amount_in: amountIn.toString() } : {}),
      min_amount_out: i === c.route.length - 1 ? minOut.toString() : "0",
    };
    from = h.tokenOut;
    return a;
  });
  const before = BigInt(await viewOn<string>(c.token, "ft_balance_of", { account_id: d.operatorId }));
  const ok = await call(
    d.linear,
    "ft_transfer_call",
    { receiver_id: d.refExchange, amount: amountIn.toString(), msg: JSON.stringify({ actions, skip_unwrap_near: true }) },
    200n,
    ONE_YOCTO,
  );
  if (!ok) return;
  const after = BigInt(await viewOn<string>(c.token, "ft_balance_of", { account_id: d.operatorId }));
  const bought = after - before;
  console.log(`AI fuel: bought ${fmt(bought, 2)} BRRRAIN with ${fmt(amountIn)} LiNEAR; Power from it starts at the next 00:00 UTC`);

  // 5. Power goes to the account behind the API key: move it there if that is another account
  if (c.holder && c.holder !== d.operatorId && bought > 0n) {
    const hreg = await viewOn<unknown>(c.token, "storage_balance_of", { account_id: c.holder }).catch(() => null);
    if (!hreg) await call(c.token, "storage_deposit", { account_id: c.holder, registration_only: true }, 10n, STORAGE_DEPOSIT);
    await call(c.token, "ft_transfer", { receiver_id: c.holder, amount: bought.toString(), memo: "floorpad agent AI fuel" }, 10n, ONE_YOCTO);
  }
}
