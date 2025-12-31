#!/bin/bash

# Properly Initialize v1.signer Contract using MpcSetup
# This uses the production-equivalent initialization path

set -e

echo "🔧 Initializing v1.signer contract using MpcSetup (production-equivalent)..."
echo ""

# Configuration
export USE_MPC_SETUP=true
export NEAR_RPC_URL=http://localhost:13030  # MPC NEAR endpoint (via SSM)
export DEPLOYER_KMS_KEY_ID=arn:aws:kms:us-east-1:311843862895:key/b2abcd6a-d5a3-49e4-8708-10cd84a2fb3a
export MASTER_ACCOUNT_PRIVATE_KEY=ed25519:3J9URWyrEjxXNBy28RZGaU1NSP2eEgsGLSt1Pc8to1qurKDS9AT68EA2nWvuds87WBtQwSyLA5CFqWXahhidLCrb
export AWS_PROFILE=shai-sandbox-profile
export AWS_REGION=us-east-1

echo "📋 Configuration:"
echo "   USE_MPC_SETUP: true (production-equivalent path)"
echo "   NEAR_RPC_URL: $NEAR_RPC_URL"
echo "   Using MpcSetup class for proper initialization"
echo ""

cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

echo "🔄 Ensuring latest code is built..."
npm run build > /dev/null 2>&1

echo ""
echo "🚀 Running orchestrator with MpcSetup..."
echo "   This will:"
echo "   1. Detect contract already deployed"
echo "   2. Detect MPC nodes already running"
echo "   3. Call vote_add_domains for ECDSA domain"
echo "   4. Trigger distributed key generation"
echo ""

# Run orchestrator
node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  try {
    const orchestrator = new LocalnetOrchestrator({
      rpcUrl: process.env.NEAR_RPC_URL,
      networkId: 'localnet',
      masterAccountPrivateKey: process.env.MASTER_ACCOUNT_PRIVATE_KEY,
      useMpcSetup: true,  // Use production-equivalent path
      mpcThreshold: 2,
    });

    console.log('🏁 Starting MPC application layer setup...\n');
    const config = await orchestrator.start();
    
    console.log('\n✅ MPC setup complete!');
    console.log('   Contract:', config.mpcContractId);
    console.log('   MPC Nodes:', config.mpcNodes.length, 'nodes');
    console.log('');
    console.log('⏳ Key generation in progress (5-10 minutes)');
    console.log('   MPC nodes are performing distributed key generation');
    console.log('');
    console.log('📊 Monitor key generation:');
    console.log('   aws ssm start-session --target i-0f765de002761e3be --profile shai-sandbox-profile');
    console.log('   # Then: docker logs -f mpc-node-fix | grep -i key');
    console.log('');
    console.log('🧪 After keys are ready, test with:');
    console.log('   node test-chain-signatures.js');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
})();
"

echo ""
echo "✨ Initialization script complete"

