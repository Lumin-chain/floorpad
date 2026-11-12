#!/usr/bin/env bash
# Deploys Floorpad with near-cli-rs (https://github.com/near/near-cli-rs).
#   MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet TREASURY=fees-dao.testnet ./deploy/deploy-testnet.sh
#   NET=mainnet MASTER=you.near LAUNCHPAD=floorpad.near TREASURY=floorpad-treasury.sputnik-dao.near ./deploy/deploy-testnet.sh
#
# MASTER pays for the deployment. It gets NO powers over the launchpad:
#   - the contract has no owner/admin methods and an immutable config,
#   - platform fees can only go to TREASURY (use a Sputnik DAO you manage in Trezu),
#   - LOCK=1 (default) deletes the launchpad's full-access keys at the end, so nobody
#     can upgrade the code or move funds.
#
# One-time costs (global code = 10x storage): token code ~33.1 NEAR, launchpad ~8.4 NEAR,
# Sputnik code ~44.4 NEAR on testnet only (already global on mainnet).
set -euo pipefail
: "${MASTER:?set MASTER=<your funded account>}"
: "${LAUNCHPAD:?set LAUNCHPAD=<new launchpad account>}"
: "${TREASURY:?set TREASURY=<fee treasury, e.g. a Sputnik DAO>}"
NET=${NET:-testnet}         # NET=mainnet uses deploy/config.mainnet.json
FEEDER=${FEEDER:-$MASTER}   # testnet price feeder (mainnet reads NEAR/USD from Ref; no feeder)
LOCK=${LOCK:-1}
LP_FUND=${LP_FUND:-12}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cargo-target/floorpad}"
WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release"
hash() { node -e "const c=require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex');const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+c),s='';while(n>0n){s=A[Number(n%58n)]+s;n/=58n}console.log(s)" "$1"; }

echo "== build (Rust 1.86, pinned in contracts/rust-toolchain.toml)"
(cd "$ROOT/contracts" && cargo build --target wasm32-unknown-unknown --release)
if command -v wasm-opt >/dev/null 2>&1; then
  echo "== wasm-opt -Oz"
  wasm-opt -Oz "$WASM/meme_token.wasm" -o "$WASM/meme_token.wasm"
  wasm-opt -Oz "$WASM/floorpad_launchpad.wasm" -o "$WASM/floorpad_launchpad.wasm"
fi
TOKEN_HASH=$(hash "$WASM/meme_token.wasm")
echo "token code hash: $TOKEN_HASH"

echo "== launchpad account"
near account create-account fund-myself "$LAUNCHPAD" "$LP_FUND NEAR" autogenerate-new-keypair save-to-keychain \
  sign-as "$MASTER" network-config "$NET" sign-with-keychain send

echo "== meme-token code as an immutable global contract (by hash)"
near contract deploy-as-global use-file "$WASM/meme_token.wasm" as-global-hash "$MASTER" \
  network-config "$NET" sign-with-keychain send

if [ "$NET" = testnet ]; then
  echo "== official Sputnik v2.3.1 code as a global contract on testnet (same hash as mainnet)"
  node "$ROOT/deploy/fetch-sputnik.mjs" "$WASM/sputnikdao2_v2.3.1.wasm"
  near contract deploy-as-global use-file "$WASM/sputnikdao2_v2.3.1.wasm" as-global-hash "$MASTER" \
    network-config "$NET" sign-with-keychain send
fi

echo "== launchpad"
CONFIG=$(sed -e "s/TREASURY_ID/$TREASURY/" -e "s/FEEDER_ID/$FEEDER/" -e "s/LAUNCHPAD_ID/$LAUNCHPAD/g" \
  -e "s/TOKEN_CODE_HASH/$TOKEN_HASH/" "$ROOT/deploy/config.$NET.json" | tr -d '\n')
near contract deploy "$LAUNCHPAD" use-file "$WASM/floorpad_launchpad.wasm" \
  with-init-call new json-args "{\"config\":$CONFIG}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config "$NET" sign-with-keychain send

if [ "$NET" = mainnet ]; then
  echo "== seed NEAR/USD from Ref pool #4512 (on-chain, permissionless)"
  near contract call-function as-transaction "$LAUNCHPAD" refresh_near_usd_price json-args '{}' \
    prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as "$MASTER" network-config "$NET" sign-with-keychain send
else
  echo "== seed NEAR/USD (testnet feeder mode; the keeper keeps it fresh)"
  PRICE=$(curl -s 'https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd' \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Math.round(JSON.parse(s).near.usd*1e6)))")
  near contract call-function as-transaction "$LAUNCHPAD" set_near_usd_price json-args "{\"price_micro_usd\":\"$PRICE\"}" \
    prepaid-gas '10 Tgas' attached-deposit '0 NEAR' sign-as "$FEEDER" network-config "$NET" sign-with-keychain send
fi

if [ "$LOCK" = 1 ]; then
  echo "== lock: delete every full-access key of $LAUNCHPAD"
  echo "   After this nobody, including the deployer, can upgrade the code or move funds."
  echo "   Fees still reach $TREASURY via the permissionless sweep_platform_fees()."
  KEYS=$(near account list-keys "$LAUNCHPAD" network-config "$NET" now 2>/dev/null \
    | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]+' | sort -u | paste -sd, -)
  near account delete-keys "$LAUNCHPAD" public-keys "$KEYS" network-config "$NET" sign-with-keychain send
  near account list-keys "$LAUNCHPAD" network-config "$NET" now
fi

echo "done. web/.env.local:  NEXT_PUBLIC_NETWORK=$NET NEXT_PUBLIC_LAUNCHPAD=$LAUNCHPAD"
echo "      agent/.env:      LAUNCHPAD_ID=$LAUNCHPAD  OPERATOR_ID=<agent account>"
