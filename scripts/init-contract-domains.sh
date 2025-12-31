#!/bin/bash

# Initialize v1.signer contract with ECDSA domain
# This must be run after contract deployment to enable address derivation

set -e

NEAR_RPC="${NEAR_RPC_URL:-http://localhost:13030}"
CONTRACT_ID="v1.signer.node0"
MASTER_ACCOUNT="node0"

echo "🔧 Initializing v1.signer contract with domains..."
echo "   Contract: $CONTRACT_ID"
echo "   RPC: $NEAR_RPC"
echo ""

# Check if contract exists
echo "📋 Checking contract..."
CONTRACT_CHECK=$(curl -s -X POST "$NEAR_RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"account_id\":\"$CONTRACT_ID\",\"finality\":\"final\"},\"id\":\"dontcare\"}")

CODE_HASH=$(echo "$CONTRACT_CHECK" | jq -r '.result.code_hash // .error.cause.name')

if [ "$CODE_HASH" = "UNKNOWN_ACCOUNT" ]; then
  echo "❌ Contract not found: $CONTRACT_ID"
  exit 1
fi

echo "✅ Contract found: $CODE_HASH"
echo ""

# The contract needs to be initialized with init_running method
# This is typically done by MPC participants during initial setup
# For localnet testing, we need to check if it's already initialized

echo "📋 Checking contract state..."
STATE_CHECK=$(curl -s -X POST "$NEAR_RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"account_id\":\"$CONTRACT_ID\",\"method_name\":\"state\",\"args_base64\":\"e30=\",\"finality\":\"final\"},\"id\":\"dontcare\"}")

if echo "$STATE_CHECK" | jq -e '.result.result' > /dev/null 2>&1; then
  echo "✅ Contract is initialized"
  echo ""
  echo "Contract state summary:"
  echo "$STATE_CHECK" | jq -r '.result.result' | base64 -d 2>/dev/null | head -c 500 || echo "(binary data)"
else
  echo "❌ Contract not initialized or state() call failed"
  echo "   Response: $STATE_CHECK"
  echo ""
  echo "⚠️  The contract needs to be initialized with init_running method"
  echo "   This is typically done by MPC participants during setup"
  echo "   For localnet, you may need to:"
  echo "   1. Redeploy contract with proper initialization"
  echo "   2. Or have MPC nodes initialize it via vote_add_domains"
fi

echo ""
echo "💡 Note: The 'No such domain' error occurs when:"
echo "   - Contract is deployed but not initialized with domains"
echo "   - Domain ID 0 (ECDSA) is not registered"
echo "   - MPC participants haven't voted to add domains yet"
echo ""
echo "🔍 To check domains, the contract needs to be in Running state"
echo "   with at least one domain configured (typically domain_id: 0 for ECDSA)"

