#!/bin/bash
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
if [ -z "$DEPLOYER_KMS_KEY_ID" ]; then
    echo "❌ Error: DEPLOYER_KMS_KEY_ID environment variable is required"
    echo "   Set it with: export DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id"
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
    const orchestrator = new LocalnetOrchestrator();
    const config = await orchestrator.start();
    console.log('\\n✅ Infrastructure ready!');
    console.log('   RPC URL:', config.rpcUrl);
    console.log('   Contract:', config.mpcContractId);
    console.log('   MPC Nodes:', config.mpcNodes.join(', '));
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
"

