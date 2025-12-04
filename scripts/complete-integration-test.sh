#!/bin/bash
# Complete End-to-End Integration Test
# This script tests the FULL functionality of cross-chain-simulator

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AWSNODERUNNER_ROOT="$(cd "$PROJECT_ROOT/../AWSNodeRunner/lib/near" && pwd)"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Complete cross-chain-simulator Functionality Test       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check AWS profile
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=shai-sandbox-profile
fi

# Step 1: Load configuration
echo "📋 Step 1: Loading AWSNodeRunner configuration..."
source "$AWSNODERUNNER_ROOT/.env.localnet"
export NEAR_RPC_URL

# Check if using private IP (needs port forwarding)
if [[ "$NEAR_RPC_URL" == http://10.* ]] || [[ "$NEAR_RPC_URL" == http://172.* ]]; then
    echo "⚠️  RPC URL uses private IP: $NEAR_RPC_URL"
    echo ""
    echo "🔧 You need SSM port forwarding for this test."
    echo ""
    echo "Run this in a SEPARATE terminal (keep it open):"
    echo ""
    INSTANCE_ID=$(aws cloudformation describe-stacks \
        --stack-name near-localnet-infrastructure \
        --profile "$AWS_PROFILE" \
        --query "Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue" \
        --output text)
    
    echo "aws ssm start-session \\"
    echo "  --target $INSTANCE_ID \\"
    echo "  --document-name AWS-StartPortForwardingSession \\"
    echo "  --parameters '{\"portNumber\":[\"3030\"],\"localPortNumber\":[\"3030\"]}' \\"
    echo "  --profile $AWS_PROFILE"
    echo ""
    echo "Then press Enter here to continue..."
    read
    
    export NEAR_RPC_URL=http://localhost:3030
    echo "✅ Using localhost:3030 (assuming port forwarding is active)"
fi

# Step 2: Test RPC connectivity
echo ""
echo "📋 Step 2: Testing RPC connectivity..."
RPC_STATUS=$(curl -s "$NEAR_RPC_URL/status" 2>&1 || echo "FAILED")
if echo "$RPC_STATUS" | grep -q "chain_id"; then
    echo "✅ RPC endpoint is accessible"
    CHAIN_ID=$(echo "$RPC_STATUS" | grep -o '"chain_id":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    echo "   Chain ID: $CHAIN_ID"
else
    echo "❌ RPC endpoint not accessible"
    echo "   Response: $RPC_STATUS"
    echo ""
    echo "Make sure SSM port forwarding is running!"
    exit 1
fi

# Step 3: Get KMS key
echo ""
echo "📋 Step 3: Getting DEPLOYER_KMS_KEY_ID..."
DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
    --stack-name CrossChainSimulatorStack \
    --profile "$AWS_PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='DeployerKmsKeyId'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -z "$DEPLOYER_KMS_KEY_ID" ]; then
    echo "❌ Error: CrossChainSimulatorStack not deployed"
    exit 1
fi

export DEPLOYER_KMS_KEY_ID
echo "✅ KMS Key ID: $DEPLOYER_KMS_KEY_ID"

# Step 4: Get master account key
echo ""
echo "📋 Step 4: Getting master account key..."
if [ -z "$MASTER_ACCOUNT_PRIVATE_KEY" ] && [ -z "$MASTER_ACCOUNT_KEY_ARN" ]; then
    echo "Extracting validator key from EC2 instance..."
    
    INSTANCE_ID=$(aws cloudformation describe-stacks \
        --stack-name near-localnet-infrastructure \
        --profile "$AWS_PROFILE" \
        --query "Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue" \
        --output text)
    
    COMMAND_ID=$(aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters 'commands=["sudo -u ubuntu cat /home/ubuntu/.near/localnet/node0/validator_key.json 2>/dev/null"]' \
        --profile "$AWS_PROFILE" \
        --query "Command.CommandId" \
        --output text)
    
    echo "Waiting for command to complete..."
    sleep 5
    
    KEY_JSON=$(aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --profile "$AWS_PROFILE" \
        --query "StandardOutputContent" \
        --output text 2>/dev/null || echo "")
    
    if echo "$KEY_JSON" | grep -q "secret_key"; then
        MASTER_ACCOUNT_PRIVATE_KEY=$(echo "$KEY_JSON" | grep -o '"secret_key":"[^"]*"' | cut -d'"' -f4)
        export MASTER_ACCOUNT_PRIVATE_KEY
        export MASTER_ACCOUNT_ID="node0"
        echo "✅ Extracted master account key (node0)"
    else
        echo "❌ Failed to extract master account key"
        echo "   Output: $KEY_JSON"
        exit 1
    fi
else
    echo "✅ Using provided master account key"
fi

# Step 5: Build
echo ""
echo "📋 Step 5: Building cross-chain-simulator..."
cd "$PROJECT_ROOT"
npm run build
echo "✅ Build complete"

# Step 6: Run orchestrator
echo ""
echo "📋 Step 6: Running orchestrator (FULL FUNCTIONALITY TEST)..."
echo "   This will:"
echo "   1. Connect to NEAR RPC ✅"
echo "   2. Initialize master account"
echo "   3. Create deployer.node0 account"
echo "   4. Deploy v1.signer.node0 contract"
echo "   5. Start MPC nodes"
echo ""

node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  try {
    console.log('🚀 Starting orchestrator...');
    const config = {
      masterAccountId: process.env.MASTER_ACCOUNT_ID || 'node0'
    };
    
    if (process.env.MASTER_ACCOUNT_KEY_ARN) {
      config.masterAccountKeyArn = process.env.MASTER_ACCOUNT_KEY_ARN;
    } else if (process.env.MASTER_ACCOUNT_PRIVATE_KEY) {
      config.masterAccountPrivateKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
    }
    
    const orch = new LocalnetOrchestrator(config);
    const result = await orch.start();
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           ✅ FULL FUNCTIONALITY TEST PASSED!             ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Summary:');
    console.log('  ✅ RPC connectivity verified');
    console.log('  ✅ Master account initialized');
    console.log('  ✅ Deployer account created');
    console.log('  ✅ Contract deployed:', result.mpcContractId);
    console.log('  ✅ MPC nodes started:', result.mpcNodes.join(', '));
    console.log('');
    console.log('🎉 cross-chain-simulator is FULLY FUNCTIONAL on localnet!');
  } catch (error) {
    console.error('');
    console.error('❌ Test failed:');
    console.error('   Error:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack.split('\\n').slice(0, 10).join('\\n'));
    }
    process.exit(1);
  }
})();
" || {
    echo ""
    echo "❌ Full functionality test failed"
    exit 1
}

echo ""
echo "✅ All tests passed! cross-chain-simulator is ready for use."

