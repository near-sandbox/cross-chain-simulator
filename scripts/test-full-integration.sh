#!/bin/bash
# Full End-to-End Integration Test
# Tests that cross-chain-simulator can actually connect, deploy contracts, and start MPC

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AWSNODERUNNER_ROOT="$(cd "$PROJECT_ROOT/../AWSNodeRunner/lib/near" && pwd)"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Full cross-chain-simulator Integration Test              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check AWS profile
if [ -z "$AWS_PROFILE" ]; then
    echo "⚠️  Warning: AWS_PROFILE not set. Using default profile."
    export AWS_PROFILE=shai-sandbox-profile
fi

# Step 1: Load AWSNodeRunner configuration
echo "📋 Step 1: Loading AWSNodeRunner configuration..."
if [ ! -f "$AWSNODERUNNER_ROOT/.env.localnet" ]; then
    echo "❌ Error: AWSNodeRunner configuration not found"
    echo "   Run: cd $AWSNODERUNNER_ROOT && npm run export-config"
    exit 1
fi

source "$AWSNODERUNNER_ROOT/.env.localnet"
export NEAR_RPC_URL
echo "✅ RPC URL: $NEAR_RPC_URL"
echo ""

# Step 2: Check if RPC is accessible
echo "📋 Step 2: Testing RPC connectivity..."
if [[ "$NEAR_RPC_URL" == http://10.* ]] || [[ "$NEAR_RPC_URL" == http://172.* ]]; then
    echo "⚠️  RPC URL uses private IP. Setting up SSM port forwarding..."
    echo ""
    
    INSTANCE_ID=$(aws cloudformation describe-stacks \
        --stack-name near-localnet-infrastructure \
        --profile "$AWS_PROFILE" \
        --query "Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue" \
        --output text)
    
    echo "Instance ID: $INSTANCE_ID"
    echo ""
    echo "🔧 Starting SSM port forwarding..."
    echo "   This will forward port 3030 from EC2 to localhost:3030"
    echo "   Keep this terminal open and run the test in another terminal"
    echo ""
    echo "   Command to run in another terminal:"
    echo "   export NEAR_RPC_URL=http://localhost:3030"
    echo "   cd $PROJECT_ROOT"
    echo "   ./scripts/test-full-integration.sh --skip-port-forward"
    echo ""
    
    if [ "$1" != "--skip-port-forward" ]; then
        aws ssm start-session \
            --target "$INSTANCE_ID" \
            --document-name AWS-StartPortForwardingSession \
            --parameters '{"portNumber":["3030"],"localPortNumber":["3030"]}' \
            --profile "$AWS_PROFILE"
        exit 0
    else
        export NEAR_RPC_URL=http://localhost:3030
        echo "✅ Using localhost:3030 (assuming port forwarding is active)"
    fi
else
    echo "✅ RPC URL is publicly accessible"
fi

# Test RPC connectivity
echo ""
echo "Testing RPC endpoint..."
RPC_STATUS=$(curl -s "$NEAR_RPC_URL/status" 2>&1 || echo "FAILED")
if echo "$RPC_STATUS" | grep -q "chain_id"; then
    echo "✅ RPC endpoint is accessible"
    CHAIN_ID=$(echo "$RPC_STATUS" | grep -o '"chain_id":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    echo "   Chain ID: $CHAIN_ID"
else
    echo "❌ RPC endpoint not accessible"
    echo "   Response: $RPC_STATUS"
    exit 1
fi
echo ""

# Step 3: Get KMS key
echo "📋 Step 3: Getting DEPLOYER_KMS_KEY_ID..."
DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
    --stack-name CrossChainSimulatorStack \
    --profile "$AWS_PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='DeployerKmsKeyId'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -z "$DEPLOYER_KMS_KEY_ID" ]; then
    echo "❌ Error: CrossChainSimulatorStack not deployed or KMS key not found"
    echo "   Deploy with: cd $PROJECT_ROOT && npm run cdk:deploy"
    exit 1
fi

export DEPLOYER_KMS_KEY_ID
echo "✅ KMS Key ID: $DEPLOYER_KMS_KEY_ID"
echo ""

# Step 4: Get master account key
echo "📋 Step 4: Getting master account key..."
MASTER_KEY_ARN=$(aws cloudformation describe-stacks \
    --stack-name near-localnet-infrastructure \
    --profile "$AWS_PROFILE" \
    --query "Stacks[0].Outputs[?contains(OutputKey, 'Master') || contains(OutputKey, 'Key')].OutputValue" \
    --output text 2>/dev/null | head -1 || echo "")

if [ -n "$MASTER_KEY_ARN" ] && [[ "$MASTER_KEY_ARN" == arn:* ]]; then
    export MASTER_ACCOUNT_KEY_ARN="$MASTER_KEY_ARN"
    echo "✅ Using master account key from Secrets Manager: $MASTER_KEY_ARN"
elif [ -n "$MASTER_ACCOUNT_PRIVATE_KEY" ]; then
    echo "✅ Using master account key from environment variable"
else
    echo "⚠️  Master account key not found in CloudFormation outputs"
    echo "   Options:"
    echo "   1. Set MASTER_ACCOUNT_PRIVATE_KEY environment variable"
    echo "   2. Store key in Secrets Manager and set MASTER_ACCOUNT_KEY_ARN"
    echo ""
    echo "   For localnet testing, you can extract the key from the EC2 instance:"
    echo "   aws ssm send-command --instance-ids $INSTANCE_ID \\"
    echo "     --document-name 'AWS-RunShellScript' \\"
    echo "     --parameters 'commands=[\"cat ~/.near/localnet/node0/validator_key.json\"]' \\"
    echo "     --profile $AWS_PROFILE"
    echo ""
    read -p "Enter master account private key (ed25519:...) or press Enter to skip: " MASTER_KEY
    if [ -n "$MASTER_KEY" ]; then
        export MASTER_ACCOUNT_PRIVATE_KEY="$MASTER_KEY"
    else
        echo "⚠️  Skipping orchestrator test (master key required)"
        exit 0
    fi
fi
echo ""

# Step 5: Build cross-chain-simulator
echo "📋 Step 5: Building cross-chain-simulator..."
cd "$PROJECT_ROOT"
if [ ! -d "dist" ] || [ "src" -nt "dist" ]; then
    npm run build
fi
echo "✅ Build complete"
echo ""

# Step 6: Test orchestrator
echo "📋 Step 6: Testing orchestrator (contract deployment + MPC startup)..."
echo "   This will:"
echo "   1. Connect to NEAR RPC"
echo "   2. Deploy deployer.node0 account"
echo "   3. Deploy v1.signer.node0 contract"
echo "   4. Start MPC nodes"
echo ""

node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  try {
    console.log('Initializing orchestrator...');
    const config = {};
    if (process.env.MASTER_ACCOUNT_KEY_ARN) {
      config.masterAccountKeyArn = process.env.MASTER_ACCOUNT_KEY_ARN;
    } else if (process.env.MASTER_ACCOUNT_PRIVATE_KEY) {
      config.masterAccountPrivateKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
    }
    
    const orch = new LocalnetOrchestrator(config);
    console.log('✅ Orchestrator initialized');
    console.log('   RPC URL:', process.env.NEAR_RPC_URL);
    console.log('');
    
    console.log('Starting infrastructure deployment...');
    const result = await orch.start();
    
    console.log('');
    console.log('✅ Infrastructure deployment complete!');
    console.log('   RPC URL:', result.rpcUrl);
    console.log('   Contract:', result.mpcContractId);
    console.log('   MPC Nodes:', result.mpcNodes.join(', '));
    console.log('');
    console.log('🎉 Full integration test PASSED!');
  } catch (error) {
    console.error('');
    console.error('❌ Orchestrator test failed:');
    console.error('   Error:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack.split('\\n').slice(0, 5).join('\\n'));
    }
    process.exit(1);
  }
})();
" || {
    echo ""
    echo "❌ Orchestrator test failed"
    exit 1
}

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              ✅ Full Integration Test PASSED!            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Summary:"
echo "  ✅ RPC connectivity verified"
echo "  ✅ Contract deployment successful"
echo "  ✅ MPC nodes started"
echo ""
echo "cross-chain-simulator is fully functional on localnet!"
echo ""

