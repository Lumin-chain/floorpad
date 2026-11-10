#!/usr/bin/env bash
# Deploys Floorpad to testnet with near-cli-rs (https://github.com/near/near-cli-rs).
#   MASTER=you.testnet LAUNCHPAD=floorpad-you.testnet ./deploy/deploy-testnet.sh
# MASTER must be in your keychain/legacy keychain and hold enough testnet NEAR.
set -euo pipefail
: "${MASTER:?set MASTER=<your funded testnet account>}"
: "${LAUNCHPAD:?set LAUNCHPAD=<new launchpad account, e.g. floorpad-you.testnet>}"
NET=testnet
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cargo-target/floorpad}"
WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release"

echo "== build (Rust 1.86, pinned in contracts/rust-toolchain.toml)"
(cd "$ROOT/contracts" && cargo build --target wasm32-unknown-unknown --release)
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz --signext-lowering "$WASM/meme_token.wasm" -o "$WASM/meme_token.wasm"
  wasm-opt -Oz --signext-lowering "$WASM/floorpad_launchpad.wasm" -o "$WASM/floorpad_launchpad.wasm"
fi

echo "== accounts"
near account create-account fund-myself "$LAUNCHPAD" '25 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$MASTER" network-config $NET sign-with-keychain send
near account create-account fund-myself "token-code.$LAUNCHPAD" '5 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$LAUNCHPAD" network-config $NET sign-with-keychain send
near account create-account fund-myself "agent.$LAUNCHPAD" '3 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$LAUNCHPAD" network-config $NET sign-with-keychain send

echo "== meme-token code as a global contract (shared by every launch)"
near contract deploy-as-global use-file "$WASM/meme_token.wasm" as-global-account-id "token-code.$LAUNCHPAD" \
  network-config $NET sign-with-keychain send

echo "== launchpad"
CONFIG=$(sed -e "s/OWNER_ID/$MASTER/" -e "s/LAUNCHPAD_ID/$LAUNCHPAD/g" "$ROOT/deploy/config.testnet.json" | tr -d '\n')
near contract deploy "$LAUNCHPAD" use-file "$WASM/floorpad_launchpad.wasm" \
  with-init-call new json-args "{\"config\":$CONFIG}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config $NET sign-with-keychain send

echo "done. web/.env.local:  NEXT_PUBLIC_LAUNCHPAD=$LAUNCHPAD"
echo "      agent/.env:      LAUNCHPAD_ID=$LAUNCHPAD  OPERATOR_ID=agent.$LAUNCHPAD"
