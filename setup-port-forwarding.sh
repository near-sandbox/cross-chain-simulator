#!/bin/bash

# Setup Port Forwarding for Cross-Chain Testing
# This script sets up SSM port forwarding for both NEAR and Ethereum endpoints

set -e

PROFILE="shai-sandbox-profile"
MPC_NEAR_INSTANCE="i-0f765de002761e3be"
ETH_INSTANCE="i-0edc2b4c8f2d55a12"

echo "🔌 Setting up port forwarding for cross-chain testing..."
echo ""

# Kill any existing port forwarding on these ports
echo "Cleaning up existing port forwards..."
pkill -f "portNumber.*3030.*localPortNumber.*13030" 2>/dev/null || true
pkill -f "portNumber.*8545.*localPortNumber.*8545" 2>/dev/null || true
sleep 2

# Start MPC NEAR endpoint forwarding (port 13030 to avoid conflict)
echo "Starting MPC NEAR endpoint forwarding (localhost:13030)..."
aws ssm start-session \
  --target "$MPC_NEAR_INSTANCE" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3030"],"localPortNumber":["13030"]}' \
  --profile "$PROFILE" > /tmp/ssm-mpc-near.log 2>&1 &

MPC_PID=$!
echo "  PID: $MPC_PID"
sleep 3

# Start Ethereum RPC forwarding
echo "Starting Ethereum RPC forwarding (localhost:8545)..."
aws ssm start-session \
  --target "$ETH_INSTANCE" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8545"],"localPortNumber":["8545"]}' \
  --profile "$PROFILE" > /tmp/ssm-eth-rpc.log 2>&1 &

ETH_PID=$!
echo "  PID: $ETH_PID"
sleep 3

# Verify connections
echo ""
echo "🔍 Verifying connections..."

# Test MPC NEAR endpoint
if curl -s -m 3 -X POST http://localhost:13030 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"status","id":"dontcare"}' | jq -e '.result' > /dev/null 2>&1; then
  echo "  ✅ MPC NEAR endpoint: http://localhost:13030"
else
  echo "  ⚠️  MPC NEAR endpoint not ready (may need more time)"
fi

# Test Ethereum RPC
if curl -s -m 3 -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -e '.result' > /dev/null 2>&1; then
  echo "  ✅ Ethereum RPC: http://localhost:8545"
else
  echo "  ⚠️  Ethereum RPC not ready (may need more time)"
fi

echo ""
echo "✅ Port forwarding setup complete!"
echo ""
echo "📝 Endpoints:"
echo "   MPC NEAR: http://localhost:13030"
echo "   Ethereum: http://localhost:8545"
echo ""
echo "🧪 To run the test:"
echo "   export NEAR_RPC_URL=http://localhost:13030"
echo "   export ETH_RPC_URL=http://localhost:8545"
echo "   node test-full-cross-chain.js"
echo ""
echo "🛑 To stop port forwarding:"
echo "   kill $MPC_PID $ETH_PID"
echo ""

# Save PIDs for cleanup
echo "$MPC_PID" > /tmp/ssm-mpc-near.pid
echo "$ETH_PID" > /tmp/ssm-eth-rpc.pid

