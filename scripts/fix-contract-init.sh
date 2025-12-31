#!/bin/bash

# Fix Contract Initialization
# Call init() and vote_add_domains on the existing v1.signer contract

set -e

echo "🔧 Fixing v1.signer contract initialization..."
echo ""

# Check environment
if [ -z "$MASTER_ACCOUNT_PRIVATE_KEY" ]; then
  echo "❌ MASTER_ACCOUNT_PRIVATE_KEY not set"
  echo "   Export the node0 private key from your localnet"
  exit 1
fi

if [ -z "$USE_MPC_SETUP" ]; then
  echo "📌 Setting USE_MPC_SETUP=true"
  export USE_MPC_SETUP=true
fi

# Use MpcSetup to properly initialize
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

echo "🔄 Rebuilding with updated MpcSetup..."
npm run build

echo ""
echo "🚀 Running orchestrator with MpcSetup (will initialize contract)..."
echo "   This will:"
echo "   1. Call init() on contract"
echo "   2. Vote to add ECDSA domain (domain_id: 0)"
echo "   3. Trigger key generation"
echo ""

# Run orchestrator
node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  const orchestrator = new LocalnetOrchestrator({
    rpcUrl: 'http://localhost:13030',  // MPC NEAR endpoint
    networkId: 'localnet',
    masterAccountPrivateKey: process.env.MASTER_ACCOUNT_PRIVATE_KEY,
    useMpcSetup: true,  // Use proper initialization path
    mpcThreshold: 2,
  });

  try {
    console.log('Starting MPC setup...');
    const config = await orchestrator.start();
    console.log('✅ MPC setup complete!');
    console.log('Contract:', config.mpcContractId);
    console.log('');
    console.log('⏳ Key generation started - will take 5-10 minutes');
    console.log('   Check status with: npm run check:mpc');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
})();
"

