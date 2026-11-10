#!/usr/bin/env bash
# Deploys Floorpad with near-cli-rs (https://github.com/near/near-cli-rs).
#   MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet ./deploy/deploy-testnet.sh
#   NET=mainnet MASTER=you.near LAUNCHPAD=floorpad.near ./deploy/deploy-testnet.sh
# MASTER must be in your keychain and funded. Costs (global code = 10x storage, one-time):
#   token code ~33 NEAR, Sputnik code ~44 NEAR (testnet only; already global on mainnet),
#   launchpad ~8.4 NEAR + working balance.
# Tip: e2e/testnet.mjs runs the same deployment plus a full lifecycle test with faucet accounts.
set -euo pipefail
: "${MASTER:?set MASTER=<your funded account>}"
: "${LAUNCHPAD:?set LAUNCHPAD=<new launchpad account>}"
NET=${NET:-testnet}   # NET=mainnet uses deploy/config.mainnet.json
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cargo-target/floorpad}"
WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release"
SPUTNIK_HASH=DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF
hash() { node -e "const c=require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex');const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+c),s='';while(n>0n){s=A[Number(n%58n)]+s;n/=58n}console.log(s)" "$1"; }

echo "== build (Rust 1.86, pinned in contracts/rust-toolchain.toml)"
(cd "$ROOT/contracts" && cargo build --target wasm32-unknown-unknown --release)
TOKEN_HASH=$(hash "$WASM/meme_token.wasm")
echo "token code hash: $TOKEN_HASH"

echo "== launchpad account"
near account create-account fund-myself "$LAUNCHPAD" '12 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$MASTER" network-config $NET sign-with-keychain send

echo "== meme-token code as an immutable global contract (by hash)"
near contract deploy-as-global use-file "$WASM/meme_token.wasm" as-global-hash "$MASTER" \
  network-config $NET sign-with-keychain send

if [ "$NET" = testnet ]; then
  echo "== official Sputnik v2.3.1 code as a global contract on testnet (same hash as mainnet)"
  node "$ROOT/deploy/fetch-sputnik.mjs" "$WASM/sputnikdao2_v2.3.1.wasm"
  near contract deploy-as-global use-file "$WASM/sputnikdao2_v2.3.1.wasm" as-global-hash "$MASTER" \
    network-config $NET sign-with-keychain send
fi

echo "== launchpad"
CONFIG=$(sed -e "s/OWNER_ID/$MASTER/" -e "s/LAUNCHPAD_ID/$LAUNCHPAD/g" -e "s/TOKEN_CODE_HASH/$TOKEN_HASH/" \
  "$ROOT/deploy/config.$NET.json" | tr -d '\n')
near contract deploy "$LAUNCHPAD" use-file "$WASM/floorpad_launchpad.wasm" \
  with-init-call new json-args "{\"config\":$CONFIG}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-keychain send

if [ "$NET" = mainnet ]; then
  echo "== seed NEAR/USD from Ref pool #4512 (on-chain, permissionless)"
  near contract call-function as-transaction "$LAUNCHPAD" refresh_near_usd_price json-args '{}' \
    prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as "$MASTER" network-config $NET sign-with-keychain send
else
  echo "== seed NEAR/USD (testnet feeder mode; the keeper keeps it fresh)"
  PRICE=$(curl -s 'https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Math.round(JSON.parse(s).near.usd*1e6)))")
  near contract call-function as-transaction "$LAUNCHPAD" set_near_usd_price json-args "{\"price_micro_usd\":\"$PRICE\"}" \
    prepaid-gas '10 Tgas' attached-deposit '0 NEAR' sign-as "$MASTER" network-config $NET sign-with-keychain send
fi

echo "done. web/.env.local:  NEXT_PUBLIC_NETWORK=$NET NEXT_PUBLIC_LAUNCHPAD=$LAUNCHPAD"
echo "      agent/.env:      LAUNCHPAD_ID=$LAUNCHPAD  OPERATOR_ID=<agent account>"
