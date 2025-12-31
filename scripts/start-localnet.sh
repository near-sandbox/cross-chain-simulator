#!/bin/bash

# Enable production-equivalent MPC setup by default
export USE_MPC_SETUP=${USE_MPC_SETUP:-true}
# Connect to EC2 NEAR localnet RPC and deploy Chain Signatures infrastructure
# Note: EC2 NEAR node deployed separately via /AWSNodeRunner/lib/near
# This script manages contract deployment and MPC nodes only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting NEAR localnet infrastructure deployment..."
echo ""
echo "Prerequisites:"
echo "  - EC2 NEAR node running at NEAR_RPC_URL (default: http://localhost:3030)"
echo "  - AWS credentials configured (for KMS access)"
echo "  - DEPLOYER_KMS_KEY_ID environment variable set"
echo ""

# Check for required environment variables
if [ -z "$DEPLOYER_KMS_KEY_ID" ] && [ -z "$MASTER_ACCOUNT_PRIVATE_KEY" ]; then
    echo "❌ Error: DEPLOYER_KMS_KEY_ID or MASTER_ACCOUNT_PRIVATE_KEY environment variable is required"
    echo "   Set DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id"
    echo "   OR set MASTER_ACCOUNT_PRIVATE_KEY=ed25519:..."
    exit 1
fi

# Check if AWS credentials are available
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "⚠️  Warning: AWS credentials not found. Ensure AWS credentials are configured."
    echo "   Use: aws configure or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
fi

# Run orchestrator via Node.js
cd "$PROJECT_ROOT"

# Check if TypeScript is compiled
if [ ! -d "dist/localnet" ]; then
    echo "📦 Building TypeScript..."
    npm run build
fi

# Run orchestrator
echo "🔧 Running orchestrator..."
node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  try {
    // Build config from environment variables
    const config = {};
    
    if (process.env.MASTER_ACCOUNT_KEY_ARN) {
      config.masterAccountKeyArn = process.env.MASTER_ACCOUNT_KEY_ARN;
    } else if (process.env.MASTER_ACCOUNT_PRIVATE_KEY) {
      config.masterAccountPrivateKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
    }
    
    if (process.env.MASTER_ACCOUNT_ID) {
      config.masterAccountId = process.env.MASTER_ACCOUNT_ID;
    }
    
    if (process.env.MPC_CONTRACT_ID) {
      config.contractAccountId = process.env.MPC_CONTRACT_ID;
    }
    
    if (process.env.NEAR_RPC_URL) {
      config.rpcUrl = process.env.NEAR_RPC_URL;
    }
    
    const orchestrator = new LocalnetOrchestrator(config);
    const result = await orchestrator.start();
    console.log('\\n✅ Infrastructure ready!');
    console.log('   RPC URL:', result.rpcUrl);
    console.log('   Contract:', result.mpcContractId);
    console.log('   MPC Nodes:', result.mpcNodes.join(', '));
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack.split('\\n').slice(0, 10).join('\\n'));
    }
    process.exit(1);
  }
})();
"

