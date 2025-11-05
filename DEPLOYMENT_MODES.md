# Deployment Modes

## Overview

The cross-chain-simulator supports **two deployment modes** depending on whether you already have a NEAR localnet node running.

## Mode 1: Existing Infrastructure

**Use Case**: You already have a NEAR localnet node running and want to add cross-chain signatures capability.

### When to Use

- ✅ You have existing NEAR contracts deployed to localnet
- ✅ You want to reuse your existing NEAR node infrastructure
- ✅ You manage your own NEAR node deployment
- ✅ You have master account key stored in AWS Secrets Manager

### Requirements

1. **Existing NEAR Localnet Node**
   - RPC endpoint accessible (e.g., `http://your-node:3030`)
   - Node is running and synced

2. **Master Account Key in Secrets Manager**
   - Private key for `test.near` (or your master account)
   - Stored in AWS Secrets Manager
   - ARN available for reference

3. **AWS Credentials**
   - Configured AWS CLI or environment variables
   - Permissions to read Secrets Manager secret
   - Permissions to create KMS keys and IAM roles

### Deployment Steps

```bash
# 1. Set environment variables
export NEAR_RPC_URL=http://your-existing-node:3030
export MASTER_ACCOUNT_KEY_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:near/master-key-AbCdEf
export DEPLOYER_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012

# 2. Deploy CrossChainSimulatorStack only (explicitly disable NEAR node deployment)
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack -c deployNearNode=false
```

**Note**: The CDK app will automatically detect Mode 1 if both `NEAR_RPC_URL` and `MASTER_ACCOUNT_KEY_ARN` are provided. You can also explicitly set `-c deployNearNode=false`.

### What Gets Deployed

- ✅ KMS key for deployer account encryption
- ✅ IAM roles for EC2 instances
- ✅ EC2 instance profile
- ✅ CloudFormation outputs
- ❌ **NOT deployed**: NEAR localnet node (uses existing)

### Configuration

**Environment Variables**:
```bash
NEAR_RPC_URL=http://your-existing-node:3030
MASTER_ACCOUNT_KEY_ARN=arn:aws:secretsmanager:...
DEPLOYER_KMS_KEY_ID=arn:aws:kms:...
AWS_REGION=us-east-1
```

**CDK Context** (alternative):
```bash
cdk deploy CrossChainSimulatorStack \
  -c nearRpcUrl=http://your-existing-node:3030 \
  -c masterAccountKeyArn=arn:aws:secretsmanager:...
```

### After Deployment

```bash
# Deploy contracts and start MPC nodes
npm run start:localnet
```

## Mode 2: Integrated Deployment

**Use Case**: You want to deploy both NEAR localnet node and cross-chain simulator together.

### When to Use

- ✅ You don't have a NEAR node yet
- ✅ You want a complete NEAR + Chain Signatures setup
- ✅ You want single deployment for both layers
- ✅ You're starting fresh with localnet

### Requirements

1. **AWS Node Runner Code**
   - Available from [shaiss/aws-blockchain-node-runners/near](https://github.com/shaiss/aws-blockchain-node-runners/tree/near) (dev)
   - Or [aws-samples/aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners) (future)

2. **AWS Credentials**
   - Configured AWS CLI or environment variables
   - Permissions to deploy EC2 instances, VPCs, etc.
   - Permissions to create KMS keys and IAM roles

### Deployment Steps

**Current Implementation** (CloudFormation Imports):

```bash
# 1. Deploy NearLocalnetStack first (from AWS Node Runner)
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/AWSNodeRunner/lib/near
cdk deploy --all

# 2. Deploy CrossChainSimulatorStack (will import from NearLocalnetStack)
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack
```

**Future Implementation** (Direct Stack Import):

Once AWS Node Runner is published to npm, Mode 2 will import the stack directly:

```bash
# Install AWS Node Runner package
npm install @aws-samples/aws-blockchain-node-runners

# Deploy both stacks together
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack --all
```

The CDK app will automatically:
1. Import `NearLocalnetStack` from AWS Node Runner
2. Deploy both stacks together
3. Pass RPC URL and master key ARN automatically

### What Gets Deployed

**Layer 1: NearLocalnetStack** (from AWS Node Runner):
- ✅ VPC with NAT Gateway
- ✅ EC2 instance (T3.LARGE)
- ✅ NEAR localnet node (via nearup)
- ✅ Secrets Manager secret for master account key
- ✅ CloudFormation exports: `NearLocalnetRpcUrl`, `NearLocalnetMasterAccountKeyArn`

**Layer 2: CrossChainSimulatorStack**:
- ✅ KMS key for deployer account encryption
- ✅ IAM roles for EC2 instances
- ✅ EC2 instance profile
- ✅ CloudFormation outputs
- ✅ **Imports**: RPC URL and master key ARN from Layer 1

### Configuration

**CDK Context** (to disable NEAR node deployment):
```bash
# Deploy only simulator (Mode 1)
cdk deploy CrossChainSimulatorStack -c deployNearNode=false

# Deploy both (Mode 2, default)
cdk deploy CrossChainSimulatorStack
```

**Environment Variables**:
```bash
DEPLOYER_KMS_KEY_ID=arn:aws:kms:...  # Required
AWS_REGION=us-east-1                   # Optional
```

### After Deployment

```bash
# Get RPC URL from stack outputs
export NEAR_RPC_URL=$(aws cloudformation describe-stacks \
  --stack-name NearLocalnetStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NearLocalnetRpcUrl`].OutputValue' \
  --output text)

# Deploy contracts and start MPC nodes
npm run start:localnet
```

## Comparison

| Feature | Mode 1: Existing Infrastructure | Mode 2: Integrated Deployment |
|---------|----------------------------------|--------------------------------|
| **NEAR Node** | Uses existing | Deploys new |
| **RPC URL** | User-provided | Auto-imported from NearLocalnetStack |
| **Master Key ARN** | User-provided | Auto-imported from NearLocalnetStack |
| **Deployment Time** | ~5 minutes | ~25 minutes (includes NEAR node) |
| **Infrastructure Cost** | Lower (reuses node) | Higher (new EC2 instance) |
| **Use Case** | Add chain signatures to existing setup | Fresh deployment |

## Switching Between Modes

### From Mode 2 to Mode 1

If you deployed via Mode 2 but want to switch to Mode 1:

```bash
# 1. Get RPC URL and master key ARN from Mode 2 deployment
export NEAR_RPC_URL=$(aws cloudformation describe-stacks \
  --stack-name NearLocalnetStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NearLocalnetRpcUrl`].OutputValue' \
  --output text)

export MASTER_ACCOUNT_KEY_ARN=$(aws cloudformation describe-stacks \
  --stack-name NearLocalnetStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NearLocalnetMasterAccountKeyArn`].OutputValue' \
  --output text)

# 2. Deploy simulator with explicit values (Mode 1)
cdk deploy CrossChainSimulatorStack -c deployNearNode=false
```

### From Mode 1 to Mode 2

If you want to deploy your own NEAR node:

```bash
# 1. Deploy NEAR node first (AWS Node Runner)
cd /AWSNodeRunner/lib/near
cdk deploy --all

# 2. Deploy simulator (will auto-import from NEAR node)
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack
```

## Troubleshooting

### Mode 1: "Secret not found"

**Error**: `Secret not found: arn:aws:secretsmanager:...`

**Solution**: Ensure the secret exists and ARN is correct:
```bash
aws secretsmanager describe-secret --secret-id <your-arn>
```

### Mode 1: "Access denied to secret"

**Error**: `Access denied to secret: arn:aws:secretsmanager:...`

**Solution**: Grant IAM permissions:
```bash
aws iam attach-role-policy \
  --role-name CrossChainSimulatorStack-EC2OrchestratorRole \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

### Mode 2: "Cannot import NearLocalnetStack"

**Error**: `Failed to import NearLocalnetStack`

**Solution**: 
1. Ensure AWS Node Runner is deployed first
2. Or use Mode 1 with explicit RPC URL and ARN

### Mode 2: "CloudFormation export not found"

**Error**: `NearLocalnetMasterAccountKeyArn export not found`

**Solution**: Deploy NearLocalnetStack first:
```bash
cd /AWSNodeRunner/lib/near
cdk deploy --all
```

## References

- [AWS Node Runner for NEAR](https://github.com/shaiss/aws-blockchain-node-runners/tree/near) - Development version
- [AWS Blockchain Node Runners](https://github.com/aws-samples/aws-blockchain-node-runners) - Official AWS repo
- [KEY_MANAGEMENT_STRATEGY.md](./KEY_MANAGEMENT_STRATEGY.md) - Key management details
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide

