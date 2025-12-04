#!/bin/bash
# Complete Integration Test Script
# Requires SSM port forwarding to be running in another terminal

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Complete cross-chain-simulator Integration Test          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=shai-sandbox-profile
fi

# Check port forwarding
if ! curl -s http://localhost:3030/status > /dev/null 2>&1; then
    echo "❌ Error: Port forwarding not active"
    echo ""
    echo "Start port forwarding in another terminal:"
    echo ""
    echo "export AWS_PROFILE=shai-sandbox-profile"
    echo "INSTANCE_ID=\$(aws cloudformation describe-stacks \\"
    echo "  --stack-name near-localnet-infrastructure \\"
    echo "  --profile shai-sandbox-profile \\"
    echo "  --query \"Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue\" \\"
    echo "  --output text)"
    echo ""
    echo "aws ssm start-session \\"
    echo "  --target \$INSTANCE_ID \\"
    echo "  --document-name AWS-StartPortForwardingSession \\"
    echo "  --parameters '{\"portNumber\":[\"3030\"],\"localPortNumber\":[\"3030\"]}' \\"
    echo "  --profile shai-sandbox-profile"
    echo ""
    exit 1
fi

echo "✅ Port forwarding active"
echo ""

# Set environment variables
export NEAR_RPC_URL=http://localhost:3030
export DEPLOYER_KMS_KEY_ID=${DEPLOYER_KMS_KEY_ID:-$(aws cloudformation describe-stacks \
    --stack-name CrossChainSimulatorStack \
    --profile "$AWS_PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='DeployerKmsKeyId'].OutputValue" \
    --output text 2>/dev/null || echo "")}

if [ -z "$DEPLOYER_KMS_KEY_ID" ]; then
    echo "❌ Error: DEPLOYER_KMS_KEY_ID not set"
    exit 1
fi

export MASTER_ACCOUNT_PRIVATE_KEY=${MASTER_ACCOUNT_PRIVATE_KEY:-"ed25519:3D4YudUQRE39Lc4JHghuB5WM8kbgDDa34mnrEP5DdTApVH81af7e2dWgNPEaiQfdJnZq1CNPp5im4Rg5b733oiMP"}
export MASTER_ACCOUNT_ID=${MASTER_ACCOUNT_ID:-"node0"}
export MPC_CONTRACT_ID=${MPC_CONTRACT_ID:-"v1-signer.node0"}

# Build
echo "📦 Building cross-chain-simulator..."
cd "$PROJECT_ROOT"
npm run build

# Run orchestrator
echo ""
echo "🚀 Starting orchestrator..."
npm run start:localnet
