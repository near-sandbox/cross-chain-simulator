# Deployment Guide

## Overview

This guide covers deploying the cross-chain-simulator **Layer 3 (Chain Signatures)** infrastructure with real MPC integration to NEAR localnet.

Scope note:
- Layer 3 provides **signatures** (via `v1.signer.*` + MPC).
- Broadcasting signed transactions to destination chains is **Layer 5 app responsibility** (see NEAR docs “Relaying the Signature”): https://docs.near.org/chain-abstraction/chain-signatures/getting-started

## Architecture Components

1. **Layer 1: NEAR Base** - NEAR localnet node on EC2 (deployed via `AWSNodeRunner`)
2. **Layer 2: NEAR Services** - faucet + core contracts (deployed via `near-localnet-services`)
3. **Layer 3: MPC Nodes** - MPC EC2 instances (deployed via embedded `mpc-repo/infra/aws-cdk` `MpcStandaloneStack`)
4. **Layer 3: v1.signer Contract** - deployed on NEAR localnet as `v1.signer.localnet`
5. **Layer 3 Scripts/Orchestration** - `scripts/start-localnet.sh` (uses `MASTER_ACCOUNT_PRIVATE_KEY` or KMS)

## Deployment Options

### Option 1: Deploy via the 5-layer orchestrator (recommended for this workspace)

If you’re using the full 5-layer stack, deploy Layer 3 via `near-localnet-orchestrator`:

This ensures:
- MPC nodes are deployed into the same VPC as NEAR Base
- MPC nodes use the authoritative NEAR genesis + boot nodes
- Contract is deployed as `v1.signer.localnet`

### Option 2: Standalone Layer 3 deployment (manual)

This is useful if you want to manage Layers 1–2 yourself but still deploy MPC + `v1.signer.localnet`.

High-level steps:

1) Deploy NEAR Base (Layer 1) and ensure `localnet` root key exists in SSM:
- `/near-localnet/localnet-account-id`
- `/near-localnet/localnet-account-key`

2) Deploy MPC EC2 instances (`MpcStandaloneStack`) from:
- `cross-chain-simulator/mpc-repo/infra/aws-cdk`

3) Populate Secrets Manager keys for MPC nodes (if placeholders exist):
- `scripts/generate-test-keys.sh`
- `scripts/update-secrets.sh`

4) Deploy/initialize the signer contract + accounts:
- `MASTER_ACCOUNT_ID=localnet`
- `MPC_CONTRACT_ID=v1.signer.localnet`
- `scripts/start-localnet.sh`

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
   Contract: v1.signer.localnet

📡 [ORCHESTRATOR] Verifying RPC connection...
✅ [DEPLOYER] RPC connection verified

📦 [ORCHESTRATOR] Deploying v1.signer contract...
✅ [DEPLOYER] Contract deployed: v1.signer.localnet

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
| `MASTER_ACCOUNT_ID` | No | `localnet` | Master account name (localnet root) |
| `MASTER_ACCOUNT_PRIVATE_KEY` | For first deployment | - | Master account private key |
| `DEPLOYER_ACCOUNT_ID` | No | `deployer.localnet` | Deployer account name (deprecated, not used) |
| `DEPLOYER_ENCRYPTED_KEY` | For reuse | - | Pre-encrypted deployer key |
| `MPC_CONTRACT_ID` | No | `v1.signer.localnet` | MPC contract name |
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
- Historical docs (older naming/deployer patterns): `docs/archive/`
- [/chain-mobil/docs/kms-near-integration.md](../chain-mobil/docs/kms-near-integration.md) - KMS integration pattern

