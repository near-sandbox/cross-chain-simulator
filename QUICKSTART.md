# Quick Start Guide

## 🚀 Deploy cross-chain-simulator in 3 steps

### Prerequisites

- ✅ AWS credentials configured (`aws configure`)
- ✅ EC2 NEAR node running at `http://54.90.246.254:3030` (via `/AWSNodeRunner/lib/near`)
- ✅ Docker installed (for MPC nodes)
- ✅ Node.js 18+ and npm

### Step 1: Deploy CDK Infrastructure (2 minutes)

```bash
# Clone and setup
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator
npm install
npm run build

# Deploy KMS key and IAM roles
npm run cdk:deploy
```

**Save this output:**
```bash
export DEPLOYER_KMS_KEY_ID=<DeployerKmsKeyId from stack output>
```

### Step 2: Obtain Contract WASM (1-5 minutes)

```bash
# Download or build v1.signer contract
./contracts/download-wasm.sh

# If download fails, see contracts/README.md for manual build instructions
```

### Step 3: Deploy to Localnet (1-2 minutes)

```bash
# Set environment variables
export DEPLOYER_KMS_KEY_ID=<from-step-1>
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_PRIVATE_KEY=<test.near-private-key>

# Deploy contracts and start MPC
npm run start:localnet
```

**Expected output:**
```
🚀 [ORCHESTRATOR] Connecting to NEAR localnet and deploying infrastructure...
📡 [ORCHESTRATOR] Verifying RPC connection...
✅ [DEPLOYER] RPC connection verified
...
✅ [ORCHESTRATOR] Infrastructure ready!
   Contract: v1.signer.node0
   MPC Nodes: http://localhost:3000, http://localhost:3001, http://localhost:3002
```

**Save encrypted deployer key for future use:**
```bash
# Look for this in output:
DEPLOYER_ENCRYPTED_KEY=AQICAHi...

# Store in SSM
aws ssm put-parameter \
  --name /CrossChainSimulatorStack/deployer-encrypted-key \
  --value "$DEPLOYER_ENCRYPTED_KEY" \
  --type SecureString \
  --kms-key-id "$DEPLOYER_KMS_KEY_ID"
```

## 🎉 Done!

Your localnet now has:
- ✅ `deployer.node0` account (KMS-encrypted key)
- ✅ `v1.signer.node0` contract deployed
- ✅ 3 MPC nodes running (localhost:3000-3002)
- ✅ Real chain signatures working

## Verify Installation

```bash
# 1. Check contract deployment
curl -X POST http://54.90.246.254:3030 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"query","params":{"request_type":"view_account","account_id":"v1.signer.node0","finality":"final"}}' \
  | jq .

# 2. Check MPC nodes
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health

# 3. Test chain signatures
node -e "
const { createChainSignaturesClient } = require('./dist');
(async () => {
  const client = createChainSignaturesClient();
  const addr = await client.deriveAddress('test.near', 'ethereum');
  console.log('✅ Ethereum address:', addr.address);
})();
"
```

## Subsequent Deployments

After first deployment, reuse encrypted deployer key:

```bash
# Get encrypted key from SSM
export DEPLOYER_ENCRYPTED_KEY=$(aws ssm get-parameter \
  --name /CrossChainSimulatorStack/deployer-encrypted-key \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)

# Deploy (will skip deployer account creation)
export DEPLOYER_KMS_KEY_ID=<your-key-id>
export NEAR_RPC_URL=http://54.90.246.254:3030
npm run start:localnet
```

## Stop Infrastructure

```bash
# Stop MPC nodes (contracts persist on blockchain)
npm run stop:localnet
```

## Need Help?

- **Deployment issues**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **CDK issues**: See [cdk/README.md](./cdk/README.md)
- **Contract issues**: See [CONTRACT_DEPLOYMENT_STRATEGY.md](./CONTRACT_DEPLOYMENT_STRATEGY.md)
- **KMS pattern**: See `/chain-mobil/docs/kms-near-integration.md`

## What's Next?

1. **Test chain signatures examples**: Try [near-examples/near-multichain](https://github.com/near-examples/near-multichain)
2. **Integrate with near-intents-simulator**: Use exported `LocalnetConfig`
3. **Production setup**: Move master key to SSM, use EC2 instance profile

