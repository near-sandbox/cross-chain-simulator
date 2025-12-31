#!/bin/bash

# Manually Add Domains via SSH to MPC Node
# This is a quick workaround - proper solution is USE_MPC_SETUP=true on deployment

set -e

echo "🔧 Manually adding ECDSA domain to v1.signer contract via MPC node..."
echo ""

MPC_NODE_INSTANCE="i-0f765de002761e3be"
PROFILE="shai-sandbox-profile"
CONTRACT_ID="v1.signer.node0"

echo "📋 This will:"
echo "   1. SSH into MPC node 0"
echo "   2. Access the MPC container with keys"
echo "   3. Call vote_add_domains from inside the container"
echo "   4. Trigger distributed key generation"
echo ""

# Create the command script to run inside the MPC node
cat > /tmp/add-domain-inside-mpc.sh << 'EOFSCRIPT'
#!/bin/bash

echo "🐳 Inside MPC node container..."
echo ""

# The MPC container has near-cli and the keys
# Check if we can call the contract
echo "📋 Checking contract state..."
docker exec mpc-node-fix near view v1.signer.node0 state --nodeUrl http://localhost:3030 2>&1 | head -20 || echo "View failed"

echo ""
echo "🗳️  Voting to add ECDSA domain..."
echo "   This uses the MPC node's account which has proper keys"

# Vote to add domain from inside the container
# The container has the account keys configured
docker exec mpc-node-fix bash -c '
# Check if near CLI is available
if command -v near >/dev/null 2>&1; then
  echo "Using near-cli inside container..."
  
  # Call vote_add_domains
  # The domain structure: [{"id": 0, "scheme": "Secp256k1"}]
  near call v1.signer.node0 vote_add_domains \
    "{\"domains\":[{\"id\":0,\"scheme\":\"Secp256k1\"}]}" \
    --accountId mpc-node-0.node0 \
    --gas 300000000000000 \
    --nodeUrl http://localhost:3030 \
    2>&1 || echo "Vote failed - may need different approach"
else
  echo "near-cli not available in container"
  echo "Checking for other tools..."
  
  # Alternative: Use curl to call RPC directly
  echo "Attempting direct RPC call..."
fi
' || echo "Container command failed"

echo ""
echo "✅ Domain voting attempt complete"
echo "   Check if it worked:"
echo "   - Contract should transition to Initializing state"
echo "   - MPC nodes will start key generation"
echo "   - Wait 5-10 minutes"
echo "   - Then test with: node test-chain-signatures.js"
EOFSCRIPT

chmod +x /tmp/add-domain-inside-mpc.sh

echo "📤 Uploading and executing script on MPC node..."
echo ""

# Upload script to MPC node and execute
aws ssm send-command \
  --instance-ids "$MPC_NODE_INSTANCE" \
  --profile "$PROFILE" \
  --document-name "AWS-RunShellScript" \
  --parameters commands="$(cat /tmp/add-domain-inside-mpc.sh)" \
  --output json | jq -r '.Command.CommandId' > /tmp/add-domain-cmd-id.txt

CMD_ID=$(cat /tmp/add-domain-cmd-id.txt)
echo "📨 Command submitted: $CMD_ID"
echo "   Waiting for execution..."

sleep 10

echo ""
echo "📊 Results:"
echo "=========================================="
aws ssm get-command-invocation \
  --command-id "$CMD_ID" \
  --instance-id "$MPC_NODE_INSTANCE" \
  --profile "$PROFILE" \
  --query 'StandardOutputContent' \
  --output text

echo ""
echo "=========================================="
echo ""
echo "✅ Manual domain addition attempt complete!"
echo ""
echo "🔍 Verify it worked:"
echo "   curl -X POST http://localhost:13030 -H \"Content-Type: application/json\" \\"
echo "     -d '{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"account_id\":\"v1.signer.node0\",\"method_name\":\"state\",\"args_base64\":\"e30=\",\"finality\":\"final\"},\"id\":\"dontcare\"}' \\"
echo "     | jq -r '.result.result' | base64 -d | jq '.protocol_state' | head -20"
echo ""
echo "⏳ If successful, wait 5-10 minutes for key generation"
echo "🧪 Then test: node test-chain-signatures.js"

