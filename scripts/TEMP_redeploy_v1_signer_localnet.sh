#!/bin/bash
##############################################################################
# TEMP: This script can be deleted after the permanent fix is deployed.
#
# TEMP_redeploy_v1_signer_localnet.sh
#
# Resets and redeploys v1.signer.localnet with current MPC participant URLs
# and sign_pk values. Run this on the NEAR base EC2 instance via SSM when the
# contract is stuck in "Initializing" due to stale participant configuration.
#
# Prerequisites (on the NEAR base instance):
#   - near-cli-rs (`near` binary) installed
#   - AWS CLI with permissions to read SSM Parameter Store
#   - jq for JSON parsing
#   - curl for HTTP requests
#
# Usage:
#   ./TEMP_redeploy_v1_signer_localnet.sh
#
# Environment overrides (all optional):
#   NEAR_RPC_URL     - RPC endpoint (default: http://127.0.0.1:3030)
#   MPC_NODE_IPS     - Comma-separated MPC node private IPs (default: from CloudFormation)
#   MPC_NODE_COUNT   - Number of MPC nodes (default: 3)
#   THRESHOLD        - MPC signing threshold (default: 2)
#   CONTRACT_ID      - Contract account ID (default: v1.signer.localnet)
#   PARENT_ACCOUNT   - Parent account ID (default: signer.localnet)
#   MASTER_ACCOUNT   - Master account ID (default: localnet)
##############################################################################

set -eu

# ─── Configuration ───────────────────────────────────────────────────────────
NEAR_RPC="${NEAR_RPC_URL:-http://127.0.0.1:3030}"
MPC_NODE_COUNT="${MPC_NODE_COUNT:-3}"
THRESHOLD="${THRESHOLD:-2}"
CONTRACT_ID="${CONTRACT_ID:-v1.signer.localnet}"
PARENT_ACCOUNT="${PARENT_ACCOUNT:-signer.localnet}"
MASTER_ACCOUNT="${MASTER_ACCOUNT:-localnet}"
AWS_REGION="${AWS_REGION:-us-east-1}"

WORK_DIR="/tmp/mpc_redeploy_$$"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║  TEMP: Redeploy v1.signer.localnet with current MPC participants       ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📌 Configuration:"
echo "   NEAR RPC:        $NEAR_RPC"
echo "   Contract ID:     $CONTRACT_ID"
echo "   Parent Account:  $PARENT_ACCOUNT"
echo "   Master Account:  $MASTER_ACCOUNT"
echo "   MPC Node Count:  $MPC_NODE_COUNT"
echo "   Threshold:       $THRESHOLD"
echo ""

# ─── Helper functions ────────────────────────────────────────────────────────

fetch_ssm_param() {
  local name="$1"
  aws ssm get-parameter --name "$name" --with-decryption --region "$AWS_REGION" --query "Parameter.Value" --output text
}

# Derive public key from private key using near-cli-rs
get_public_key_from_private() {
  local private_key="$1"
  near account get-public-key from-plaintext-private-key "$private_key" 2>/dev/null | grep -oE 'ed25519:[A-Za-z0-9]+' | head -1
}

# Make a NEAR RPC view call (returns base64-decoded result)
near_view() {
  local account_id="$1"
  local method_name="$2"
  local args_base64="${3:-e30=}"  # default: {}
  
  local result
  result=$(curl -s -X POST "$NEAR_RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"account_id\":\"$account_id\",\"method_name\":\"$method_name\",\"args_base64\":\"$args_base64\",\"finality\":\"final\"},\"id\":\"1\"}")
  
  if echo "$result" | jq -e '.result.result' > /dev/null 2>&1; then
    echo "$result" | jq -r '.result.result | @base64d'
  else
    echo "$result" | jq -r '.error // .'
    return 1
  fi
}

# Check if account exists
account_exists() {
  local account_id="$1"
  local result
  result=$(curl -s -X POST "$NEAR_RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"account_id\":\"$account_id\",\"finality\":\"final\"},\"id\":\"1\"}")
  
  if echo "$result" | jq -e '.result.amount' > /dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# ─── Step 1: Fetch keys from SSM Parameter Store ─────────────────────────────

echo "🔑 Step 1: Fetching keys from SSM Parameter Store..."

MASTER_SK=$(fetch_ssm_param "/near-localnet/localnet-account-key")
echo "   ✅ Master account key retrieved"

declare -a MPC_NODE_SKS
for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
  MPC_NODE_SKS[$i]=$(fetch_ssm_param "/near-localnet/mpc-node-${i}-account-sk")
  echo "   ✅ MPC node $i account key retrieved"
done

# P2P sign_pk will be fetched from MPC nodes' /public_data endpoint later

# ─── Step 2: Discover MPC node IPs ───────────────────────────────────────────

echo ""
echo "🔍 Step 2: Discovering MPC node IPs..."

if [ -n "${MPC_NODE_IPS:-}" ]; then
  IFS=',' read -ra NODE_IPS <<< "$MPC_NODE_IPS"
  echo "   Using provided MPC_NODE_IPS: ${MPC_NODE_IPS}"
else
  # Try to get from CloudFormation stack outputs
  STACK_NAME="${MPC_STACK_NAME:-mpc-standalone}"
  echo "   Reading from CloudFormation stack: $STACK_NAME"
  
  declare -a NODE_IPS
  for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
    # The output key format may vary; adjust as needed
    IP=$(aws cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --region "$AWS_REGION" \
      --query "Stacks[0].Outputs[?contains(OutputKey, 'Node${i}PrivateIp')].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -z "$IP" ]; then
      # Fallback: try different naming convention
      IP=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?contains(OutputKey, 'MpcNode${i}')].OutputValue" \
        --output text 2>/dev/null || echo "")
    fi
    
    if [ -z "$IP" ]; then
      echo "   ❌ Could not discover IP for MPC node $i"
      echo "      Set MPC_NODE_IPS manually (comma-separated)"
      exit 1
    fi
    
    NODE_IPS[$i]="$IP"
    echo "   ✅ MPC node $i IP: $IP"
  done
fi

# ─── Step 3: Build participant info (fetch sign_pk from MPC nodes) ──────────

echo ""
echo "📋 Step 3: Building participant info (fetching sign_pk from MPC nodes)..."

declare -a PARTICIPANTS_JSON
declare -a MPC_SIGN_PKS
for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
  ACCOUNT_ID="mpc-node-${i}.localnet"
  URL="http://${NODE_IPS[$i]}:8080"
  
  # Fetch sign_pk from MPC node's /public_data endpoint
  echo "   Fetching sign_pk from $URL/public_data..."
  PUBLIC_DATA=$(curl -s --connect-timeout 5 "${URL}/public_data" || echo "{}")
  SIGN_PK=$(echo "$PUBLIC_DATA" | jq -r '.sign_pk // .near_p2p_public_key // empty')
  
  if [ -z "$SIGN_PK" ]; then
    echo "   ❌ Failed to fetch sign_pk from MPC node $i"
    echo "      Response: $PUBLIC_DATA"
    echo "   Is the MPC node running at ${NODE_IPS[$i]}:8080?"
    exit 1
  fi
  
  MPC_SIGN_PKS[$i]="$SIGN_PK"
  PARTICIPANTS_JSON[$i]="{\"account_id\":\"$ACCOUNT_ID\",\"index\":$i,\"sign_pk\":\"$SIGN_PK\",\"url\":\"$URL\"}"
  echo "   Participant $i: $ACCOUNT_ID"
  echo "      URL: $URL"
  echo "      sign_pk: $SIGN_PK"
done

# ─── Step 4: Check current contract state ────────────────────────────────────

echo ""
echo "🔍 Step 4: Checking current contract state..."

if account_exists "$CONTRACT_ID"; then
  echo "   Contract account exists"
  
  CONTRACT_STATE=$(near_view "$CONTRACT_ID" "state" 2>/dev/null || echo "error")
  if [ "$CONTRACT_STATE" != "error" ]; then
    echo "   Current state:"
    echo "$CONTRACT_STATE" | jq '.' 2>/dev/null | head -20 || echo "$CONTRACT_STATE" | head -20
    
    # Check if already Running
    if echo "$CONTRACT_STATE" | grep -q '"Running"' 2>/dev/null; then
      echo ""
      echo "   ⚠️  Contract is already in Running state!"
      if [ "${FORCE_RESET:-}" = "true" ]; then
        echo "   FORCE_RESET=true, continuing with reset..."
      else
        echo "   Set FORCE_RESET=true to force a reset."
        exit 0
      fi
    fi
  else
    echo "   Contract not initialized or state() call failed"
  fi
else
  echo "   Contract account does not exist - will create"
fi

# ─── Step 5: Download existing WASM (if contract exists) ─────────────────────

echo ""
echo "📦 Step 5: Preparing contract WASM..."

WASM_PATH="$WORK_DIR/v1.signer.wasm"

if account_exists "$CONTRACT_ID"; then
  echo "   Downloading WASM from existing contract..."
  
  # Create a temporary network config for near-cli-rs
  mkdir -p ~/.near-credentials/localnet
  
  near contract download-wasm regular "$CONTRACT_ID" save-to-file "$WASM_PATH" \
    network-config localnet \
    --rpc-url "$NEAR_RPC" 2>/dev/null && \
    echo "   ✅ WASM downloaded: $(stat -c%s "$WASM_PATH" 2>/dev/null || stat -f%z "$WASM_PATH") bytes" || {
      echo "   ❌ Failed to download WASM. Checking for local copy..."
      if [ -f "/home/ubuntu/v1.signer.wasm" ]; then
        cp /home/ubuntu/v1.signer.wasm "$WASM_PATH"
        echo "   ✅ Using local WASM copy"
      else
        echo "   ❌ No WASM available. Please provide v1.signer.wasm"
        exit 1
      fi
    }
else
  # Check for local copy
  if [ -f "/home/ubuntu/v1.signer.wasm" ]; then
    cp /home/ubuntu/v1.signer.wasm "$WASM_PATH"
    echo "   ✅ Using local WASM copy"
  else
    echo "   ❌ No contract to download from and no local WASM"
    echo "   Please copy v1.signer.wasm to /home/ubuntu/"
    exit 1
  fi
fi

# ─── Step 6: Delete existing contract (if exists) ────────────────────────────

echo ""
echo "🗑️  Step 6: Deleting existing contract account..."

# Derive master public key
MASTER_PK=$(get_public_key_from_private "$MASTER_SK")
echo "   Master public key: $MASTER_PK"

# Write master key to credentials file for near-cli-rs
MASTER_CREDS="$WORK_DIR/master_creds.json"
cat > "$MASTER_CREDS" << EOF
{
  "account_id": "$MASTER_ACCOUNT",
  "public_key": "$MASTER_PK",
  "private_key": "$MASTER_SK"
}
EOF

if account_exists "$CONTRACT_ID"; then
  echo "   Deleting $CONTRACT_ID (beneficiary: $PARENT_ACCOUNT)..."
  
  near account delete-account "$CONTRACT_ID" beneficiary "$PARENT_ACCOUNT" \
    network-config localnet \
    sign-with-access-key-file "$MASTER_CREDS" \
    send && \
    echo "   ✅ Contract account deleted" || {
      echo "   ⚠️  Delete failed - may need different key or manual intervention"
      echo "   Continuing anyway..."
    }
    
  # Wait for deletion to propagate
  sleep 2
else
  echo "   ✅ Contract account does not exist - skipping delete"
fi

# ─── Step 7: Create contract account ─────────────────────────────────────────

echo ""
echo "📝 Step 7: Creating contract account..."

# First ensure parent account exists
if ! account_exists "$PARENT_ACCOUNT"; then
  echo "   Creating parent account $PARENT_ACCOUNT..."
  
  near account create-account fund-myself "$PARENT_ACCOUNT" "100 NEAR" \
    use-manually-provided-public-key "$MASTER_PK" \
    sign-as "$MASTER_ACCOUNT" \
    network-config localnet \
    sign-with-access-key-file "$MASTER_CREDS" \
    send || echo "   Parent account may already exist"
    
  sleep 2
fi

# Create contract account
echo "   Creating contract account $CONTRACT_ID..."

near account create-account fund-myself "$CONTRACT_ID" "50 NEAR" \
  use-manually-provided-public-key "$MASTER_PK" \
  sign-as "$PARENT_ACCOUNT" \
  network-config localnet \
  sign-with-access-key-file "$MASTER_CREDS" \
  send && echo "   ✅ Contract account created" || {
    echo "   ⚠️  Create failed - checking if account already exists"
    if account_exists "$CONTRACT_ID"; then
      echo "   ✅ Account exists"
    else
      echo "   ❌ Could not create account"
      exit 1
    fi
  }

sleep 2

# ─── Step 8: Deploy contract ─────────────────────────────────────────────────

echo ""
echo "📦 Step 8: Deploying contract WASM..."

near contract deploy "$CONTRACT_ID" \
  use-file "$WASM_PATH" \
  without-init-call \
  network-config localnet \
  sign-with-access-key-file "$MASTER_CREDS" \
  send && echo "   ✅ Contract deployed" || {
    echo "   ❌ Deployment failed"
    exit 1
  }

sleep 2

# ─── Step 9: Initialize contract ─────────────────────────────────────────────

echo ""
echo "🔧 Step 9: Initializing contract with participants..."

# Build participants array using already-fetched sign_pk values
PARTICIPANTS_ARRAY=""
for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
  ACCOUNT_ID="mpc-node-${i}.localnet"
  URL="http://${NODE_IPS[$i]}:8080"
  SIGN_PK="${MPC_SIGN_PKS[$i]}"
  if [ $i -gt 0 ]; then
    PARTICIPANTS_ARRAY="${PARTICIPANTS_ARRAY},"
  fi
  PARTICIPANTS_ARRAY="${PARTICIPANTS_ARRAY}[\"$ACCOUNT_ID\", $i, {\"sign_pk\": \"$SIGN_PK\", \"url\": \"$URL\"}]"
done

INIT_ARGS=$(cat << EOF
{
  "parameters": {
    "participants": {
      "next_id": $MPC_NODE_COUNT,
      "participants": [$PARTICIPANTS_ARRAY]
    },
    "threshold": $THRESHOLD
  }
}
EOF
)

echo "   Init args:"
echo "$INIT_ARGS" | jq '.' 2>/dev/null | head -30 || echo "$INIT_ARGS" | head -30

# Write init args to file
INIT_ARGS_FILE="$WORK_DIR/init_args.json"
echo "$INIT_ARGS" > "$INIT_ARGS_FILE"

near contract call-function as-transaction "$CONTRACT_ID" init \
  json-args "$INIT_ARGS" \
  prepaid-gas "300 Tgas" \
  attached-deposit "0 NEAR" \
  sign-as "$MASTER_ACCOUNT" \
  network-config localnet \
  sign-with-access-key-file "$MASTER_CREDS" \
  send && echo "   ✅ Contract initialized" || {
    echo "   ❌ Init failed - contract may already be initialized"
  }

sleep 2

# ─── Step 10: Create MPC node accounts (if needed) ───────────────────────────

echo ""
echo "👥 Step 10: Ensuring MPC node accounts exist..."

for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
  ACCOUNT_ID="mpc-node-${i}.localnet"
  
  if account_exists "$ACCOUNT_ID"; then
    echo "   ✅ $ACCOUNT_ID exists"
  else
    echo "   Creating $ACCOUNT_ID..."
    
    NODE_PK=$(get_public_key_from_private "${MPC_NODE_SKS[$i]}")
    
    near account create-account fund-myself "$ACCOUNT_ID" "10 NEAR" \
      use-manually-provided-public-key "$NODE_PK" \
      sign-as "$MASTER_ACCOUNT" \
      network-config localnet \
      sign-with-access-key-file "$MASTER_CREDS" \
      send && echo "   ✅ $ACCOUNT_ID created" || echo "   ⚠️  Failed to create $ACCOUNT_ID"
  fi
done

sleep 2

# ─── Step 11: Vote to add domains ────────────────────────────────────────────

echo ""
echo "🗳️  Step 11: Voting to add ECDSA domain..."

DOMAINS_ARGS='{"domains":[{"id":0,"scheme":"Secp256k1"}]}'

for i in $(seq 0 $((MPC_NODE_COUNT - 1))); do
  ACCOUNT_ID="mpc-node-${i}.localnet"
  
  # Write node credentials
  NODE_PK=$(get_public_key_from_private "${MPC_NODE_SKS[$i]}")
  NODE_CREDS="$WORK_DIR/node_${i}_creds.json"
  cat > "$NODE_CREDS" << EOF
{
  "account_id": "$ACCOUNT_ID",
  "public_key": "$NODE_PK",
  "private_key": "${MPC_NODE_SKS[$i]}"
}
EOF
  
  echo "   Voting from $ACCOUNT_ID..."
  
  near contract call-function as-transaction "$CONTRACT_ID" vote_add_domains \
    json-args "$DOMAINS_ARGS" \
    prepaid-gas "300 Tgas" \
    attached-deposit "0 NEAR" \
    sign-as "$ACCOUNT_ID" \
    network-config localnet \
    sign-with-access-key-file "$NODE_CREDS" \
    send && echo "   ✅ Vote submitted from $ACCOUNT_ID" || echo "   ⚠️  Vote failed (may already be submitted)"
    
  sleep 1
done

# ─── Step 12: Poll for Running state ─────────────────────────────────────────

echo ""
echo "⏳ Step 12: Waiting for contract to reach Running state..."
echo "   (Key generation may take 5-10 minutes)"
echo ""

MAX_WAIT=600  # 10 minutes
INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATE=$(near_view "$CONTRACT_ID" "state" 2>/dev/null || echo "error")
  
  if echo "$STATE" | grep -q '"Running"' 2>/dev/null; then
    echo ""
    echo "   ✅ Contract is Running!"
    echo ""
    echo "   Final state:"
    echo "$STATE" | jq '.' 2>/dev/null | head -30 || echo "$STATE" | head -30
    
    echo ""
    echo "╔════════════════════════════════════════════════════════════════════════╗"
    echo "║  ✅ SUCCESS: v1.signer.localnet is now Running                         ║"
    echo "╚════════════════════════════════════════════════════════════════════════╝"
    exit 0
  fi
  
  # Extract current protocol state for logging
  PROTOCOL_STATE=$(echo "$STATE" | jq -r 'keys[0] // "unknown"' 2>/dev/null || echo "unknown")
  echo "   [${ELAPSED}s] Protocol state: $PROTOCOL_STATE"
  
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo ""
echo "   ⚠️  Timeout waiting for Running state"
echo "   Current state:"
near_view "$CONTRACT_ID" "state" 2>/dev/null | jq '.' 2>/dev/null | head -40 || echo "(failed to fetch state)"

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║  ⚠️  Contract initialized but not yet Running                          ║"
echo "║  Key generation may still be in progress.                              ║"
echo "║  Check again in a few minutes: near_view v1.signer.localnet state     ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
exit 0
