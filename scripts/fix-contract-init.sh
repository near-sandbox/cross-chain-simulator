#!/bin/bash

# Fix Contract Initialization
# Call init() and vote_add_domains on the existing v1.signer contract
# MPC is REQUIRED for Layer 3 Chain Signatures.

set -e

echo "🔧 Fixing v1.signer contract initialization..."
echo ""

# Check environment
if [ -z "$MASTER_ACCOUNT_PRIVATE_KEY" ]; then
  echo "❌ MASTER_ACCOUNT_PRIVATE_KEY not set"
  echo "   Export the localnet master account private key"
  exit 1
fi

# Use MpcSetup to properly initialize
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

echo "🔄 Rebuilding..."
npm run build

echo ""
echo "🚀 Running orchestrator (will initialize contract)..."
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
    masterAccountPrivateKey: process.env.MASTER_ACCOUNT_PRIVATE_KEY,
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

