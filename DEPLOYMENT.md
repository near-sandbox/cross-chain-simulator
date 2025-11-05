# Deployment Guide

## Overview

This guide covers deploying the cross-chain-simulator infrastructure with real MPC integration to NEAR localnet.

## Architecture Components

1. **EC2 NEAR Node** - Deployed separately via `/AWSNodeRunner/lib/near`
2. **KMS Key** - For deployer account encryption (deployed via CDK)
3. **Contract Deployer** - Deploys `deployer.node0` and `v1.signer.node0`
4. **MPC Nodes** - 3-node Docker network for threshold signatures
5. **Orchestrator** - Coordinates all components

## Deployment Options

### Option 1: CDK + Scripts (Recommended for Production)

**Step 1: Deploy CDK infrastructure**

```bash
# Deploy KMS key, IAM roles, and SSM parameters
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

# Set NEAR RPC URL
export NEAR_RPC_URL=http://54.90.246.254:3030

# Deploy stack
npm run cdk:deploy

# Get KMS key ID
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

echo "KMS Key ID: $DEPLOYER_KMS_KEY_ID"
```

**Step 2: Obtain contract WASM**

```bash
# Download or build v1.signer contract
./contracts/download-wasm.sh

# Verify WASM exists
ls -lh contracts/v1.signer.wasm
```

**Step 3: Get master account key**

For localnet (`test.near`):

```bash
# Option A: If you have the key
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."

# Option B: Get from SSM (if stored there)
export MASTER_ACCOUNT_PRIVATE_KEY=$(aws ssm get-parameter \
  --name /CrossChainSimulatorStack/master-account-key \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)
```

**Step 4: Run orchestrator**

```bash
# Run deployment
npm run start:localnet

# Or use programmatically
node -e "
const { LocalnetOrchestrator } = require('./dist/localnet/orchestrator');

(async () => {
  const orch = new LocalnetOrchestrator({
    masterAccountPrivateKey: process.env.MASTER_ACCOUNT_PRIVATE_KEY,
    encryptedDeployerPrivateKey: process.env.DEPLOYER_ENCRYPTED_KEY, // If reusing
  });
  
  const config = await orch.start();
  console.log('Deployed:', config);
})();
"
```

### Option 2: Scripts Only (Development)

If you have AWS credentials locally and want to skip CDK:

```bash
# 1. Create KMS key manually
aws kms create-key \
  --description "NEAR deployer account encryption key" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT

# 2. Get key ID
export DEPLOYER_KMS_KEY_ID=<key-id-from-above>

# 3. Obtain contract WASM
./contracts/download-wasm.sh

# 4. Run orchestrator
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."
npm run start:localnet
```

## First-Time Setup

### 1. Deploy Infrastructure

```bash
# Clone repository
git clone <repo-url>
cd cross-chain-simulator

# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy CDK stack
npm run cdk:deploy
```

### 2. Configure Environment

```bash
# Export required variables
export DEPLOYER_KMS_KEY_ID=<from-cdk-output>
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..." # For localnet only
```

### 3. Deploy Contracts

```bash
# Ensure WASM is available
./contracts/download-wasm.sh

# Run orchestrator
npm run start:localnet
```

Expected output:
```
🚀 [ORCHESTRATOR] Connecting to NEAR localnet and deploying infrastructure...
   RPC URL: http://54.90.246.254:3030
   Contract: v1.signer.node0

📡 [ORCHESTRATOR] Verifying RPC connection...
✅ [DEPLOYER] RPC connection verified

🔑 [ORCHESTRATOR] Adding master account key...
✅ [DEPLOYER] Master account key added to keystore

👤 [ORCHESTRATOR] Initializing master account...
✅ [DEPLOYER] Master account initialized

🔑 [ORCHESTRATOR] Creating deployer account...
✅ [DEPLOYER] Deployer account created: deployer.node0
💾 [DEPLOYER] Encrypted private key stored (save this for future use):
   DEPLOYER_ENCRYPTED_KEY=AQICAHi...

📦 [ORCHESTRATOR] Deploying v1.signer contract...
✅ [DEPLOYER] Contract deployed: v1.signer.node0

🔗 [ORCHESTRATOR] Starting MPC nodes...
✅ [ORCHESTRATOR] MPC nodes started

✅ [ORCHESTRATOR] Infrastructure ready!
```

### 4. Save Encrypted Deployer Key

**Important**: Save the `DEPLOYER_ENCRYPTED_KEY` output for future deployments:

```bash
# Store in SSM Parameter Store
aws ssm put-parameter \
  --name /CrossChainSimulatorStack/deployer-encrypted-key \
  --value "<DEPLOYER_ENCRYPTED_KEY>" \
  --type SecureString \
  --kms-key-id "$DEPLOYER_KMS_KEY_ID"
```

## Subsequent Deployments

Once deployer account is created, reuse the encrypted key:

```bash
# Get encrypted deployer key
export DEPLOYER_ENCRYPTED_KEY=$(aws ssm get-parameter \
  --name /CrossChainSimulatorStack/deployer-encrypted-key \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)

# Run orchestrator (will skip deployer account creation)
npm run start:localnet
```

## Stopping Infrastructure

```bash
# Stop MPC nodes (contracts persist on blockchain)
npm run stop:localnet
```

## Troubleshooting

### Master Account Key Issues

**Error**: `Master account key not in keystore`

**Solution**: Provide master account private key:
```bash
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."
npm run start:localnet
```

### KMS Access Issues

**Error**: `KMS decryption failed`

**Solutions**:
1. Verify AWS credentials: `aws sts get-caller-identity`
2. Check KMS key exists: `aws kms describe-key --key-id $DEPLOYER_KMS_KEY_ID`
3. Verify IAM permissions for KMS encrypt/decrypt

### Contract WASM Not Found

**Error**: `Contract WASM file not found`

**Solution**:
```bash
./contracts/download-wasm.sh
# Or build manually from github.com/near/mpc
```

### RPC Connection Failed

**Error**: `RPC connection failed`

**Solutions**:
1. Verify NEAR node is running: `curl http://54.90.246.254:3030/health`
2. Check security group allows port 3030
3. Verify RPC URL is correct: `echo $NEAR_RPC_URL`

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEPLOYER_KMS_KEY_ID` | ✅ Yes | - | AWS KMS key ID for encryption |
| `NEAR_RPC_URL` | No | `http://localhost:3030` | NEAR RPC endpoint |
| `MASTER_ACCOUNT_ID` | No | `test.near` | Master account name |
| `MASTER_ACCOUNT_PRIVATE_KEY` | For first deployment | - | Master account private key |
| `DEPLOYER_ACCOUNT_ID` | No | `deployer.node0` | Deployer account name |
| `DEPLOYER_ENCRYPTED_KEY` | For reuse | - | Pre-encrypted deployer key |
| `MPC_CONTRACT_ID` | No | `v1.signer.node0` | MPC contract name |
| `AWS_REGION` | No | `us-east-1` | AWS region for KMS |

## Security Best Practices

1. **Never commit private keys**: Use SSM/Secrets Manager
2. **Enable KMS key rotation**: Automatic via CDK
3. **Use IAM roles on EC2**: Attach instance profile from CDK
4. **Audit KMS usage**: Monitor via CloudTrail
5. **Separate environments**: Different KMS keys per environment

## Production Considerations

### Master Account Key Storage

**DO NOT** pass master account key via environment variables in production!

Instead:
```bash
# Store in SSM Parameter Store (SecureString)
aws ssm put-parameter \
  --name /near/localnet/master-key \
  --value "ed25519:..." \
  --type SecureString \
  --kms-key-id $DEPLOYER_KMS_KEY_ID

# Update orchestrator to read from SSM
```

### MPC Nodes on Production

For production, consider:
- **ECS Fargate**: Managed containers for MPC nodes
- **EC2 Auto Scaling**: For high availability
- **Private Subnets**: Network isolation
- **Application Load Balancer**: For MPC node endpoints

## References

- [CDK README](./cdk/README.md) - CDK infrastructure details
- [CONTRACT_DEPLOYMENT_STRATEGY.md](./CONTRACT_DEPLOYMENT_STRATEGY.md) - Deployment strategy
- [/chain-mobil/docs/kms-near-integration.md](../chain-mobil/docs/kms-near-integration.md) - KMS integration pattern

