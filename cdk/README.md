# CDK Infrastructure for Cross-Chain Simulator

## Overview

This CDK stack deploys the infrastructure for NEAR Chain Signatures with real MPC integration:

- **KMS Key**: For encrypting/decrypting deployer account private key
- **SSM Parameter**: For master account key storage (optional, production use)
- **IAM Role**: For EC2 instances running orchestrator
- **Instance Profile**: For EC2 to access KMS and SSM

**Note**: MPC nodes and contract deployment are managed via scripts (not Lambda) since orchestration requires Docker support.

## Prerequisites

- AWS CDK v2 installed: `npm install -g aws-cdk`
- AWS credentials configured
- EC2 NEAR node running (deployed via `/AWSNodeRunner/lib/near`)

## Deployment

### 1. Install dependencies

```bash
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
cdk bootstrap
```

### 3. Deploy stack

```bash
# Set NEAR RPC URL (EC2 instance)
export NEAR_RPC_URL=http://54.90.246.254:3030

# Deploy
cdk deploy CrossChainSimulatorStack

# Or with context variables
cdk deploy CrossChainSimulatorStack \
  -c nearRpcUrl=http://54.90.246.254:3030 \
  -c masterAccountId=test.near
```

### 4. Get outputs

```bash
# Get KMS key ID
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text

# Get Lambda function name
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`OrchestratorLambdaName`].OutputValue' \
  --output text
```

## Usage

### On EC2 Instance

If running orchestrator on EC2:

```bash
# 1. Attach the EC2 instance profile to your instance
aws ec2 associate-iam-instance-profile \
  --instance-id i-xxxxx \
  --iam-instance-profile Name=<EC2InstanceProfileName>

# 2. SSH to instance and run orchestrator
ssh ec2-user@<instance-ip>
export DEPLOYER_KMS_KEY_ID=<DeployerKmsKeyId>
npm run start:localnet
```

### On Local Machine

If running orchestrator locally with AWS credentials:

```bash
# 1. Configure AWS credentials
aws configure --profile shai-sandbox-profile

# 2. Export KMS key ID
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text \
  --profile shai-sandbox-profile)

# 3. Export NEAR RPC URL
export NEAR_RPC_URL=http://54.90.246.254:3030

# 4. Run orchestrator
npm run start:localnet
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│ CrossChainSimulatorStack (CDK)                  │
├─────────────────────────────────────────────────┤
│ • KMS Key (deployer account encryption)         │
│ • SSM Parameter (master account key - optional) │
│ • IAM Role (EC2 instance profile)               │
│ • Permissions (KMS encrypt/decrypt)             │
└─────────────────────────────────────────────────┘
                    ↓ used by
┌─────────────────────────────────────────────────┐
│ EC2 or Local Machine                            │
├─────────────────────────────────────────────────┤
│ • npm run start:localnet (scripts)              │
│ • LocalnetOrchestrator (TypeScript)             │
│ • Docker (for MPC nodes)                        │
└─────────────────────────────────────────────────┘
                    ↓ orchestrates
┌─────────────────────────────────────────────────┐
│ Infrastructure Components                       │
├─────────────────────────────────────────────────┤
│ 1. Connect to EC2 NEAR RPC                      │
│ 2. Deploy deployer.node0 (KMS-encrypted key) │
│ 3. Deploy v1.signer.node0 contract           │
│ 4. Start MPC nodes (Docker)                     │
│ 5. Health checks                                │
└─────────────────────────────────────────────────┘
```

**Why not Lambda?**
- Lambda cannot run Docker containers (needed for MPC nodes)
- Orchestrator needs long-running process support
- Better suited for EC2, ECS, or local development

## Security

### KMS Key Management

- KMS key created with rotation enabled
- Scoped IAM permissions (encrypt/decrypt only)
- Key retained on stack deletion (RETAIN policy)

### Lambda Security

- Runs in VPC (if configured)
- IAM role with minimal permissions
- CloudWatch logs for audit trail
- Environment variables for configuration

### Private Key Storage

**DO NOT** pass master account private key via stack props in production!

**Production approach:**
1. Store master account key in SSM Parameter Store or Secrets Manager
2. Grant Lambda permission to read from SSM/Secrets Manager
3. Remove `masterAccountPrivateKey` from stack props

```typescript
// Example: Read from SSM Parameter Store
const masterKeyParam = ssm.StringParameter.fromStringParameterName(
  this,
  'MasterAccountKey',
  '/near/localnet/master-account-key'
);

// Grant Lambda read permission
masterKeyParam.grantRead(orchestratorRole);

// Lambda reads at runtime
const masterKey = await ssm.getParameter({
  Name: '/near/localnet/master-account-key',
  WithDecryption: true
}).promise();
```

## Monitoring

### CloudWatch Dashboard

Access the dashboard:
```bash
open "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CrossChainSimulatorStack-CrossChainSimulator"
```

### Script Logging

The orchestrator scripts log to stdout. When running on EC2 or local:

```bash
# View real-time logs
npm run start:localnet

# Or redirect to file
npm run start:localnet > orchestrator.log 2>&1
```

## Cleanup

```bash
# Destroy stack (KMS key will be retained)
cdk destroy CrossChainSimulatorStack

# To manually delete KMS key (if needed)
aws kms schedule-key-deletion \
  --key-id <DeployerKmsKeyId> \
  --pending-window-in-days 7
```

## Development

### Local testing with KMS

```bash
# Export KMS key ID from stack
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

# Run orchestrator locally
npm run start:localnet
```

### Update stack

```bash
# Modify cdk/cross-chain-simulator-stack.ts
# Then redeploy
cdk deploy CrossChainSimulatorStack
```

## Notes

- **MPC Nodes**: Run via Docker on EC2 or local machine (not Lambda/Fargate)
- **EC2 Instance**: NEAR node must be running before starting orchestrator
- **Contract WASM**: Must be available at `contracts/v1.signer.wasm`
- **KMS Key**: Created with rotation enabled, retained on stack deletion

