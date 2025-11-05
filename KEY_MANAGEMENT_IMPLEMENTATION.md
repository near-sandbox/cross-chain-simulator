# Key Management Implementation Status

## ✅ What We Have Now (cross-chain-simulator)

### Code Implementation

**1. Secrets Manager Integration**
- ✅ `@aws-sdk/client-secrets-manager` dependency added
- ✅ `fetchKeyFromSecretsManager()` method implemented
- ✅ Parses JSON secret format: `{"account": "test.near", "privateKey": "ed25519:..."}`

**2. Configuration Support**
- ✅ `getMasterAccountKeyArn()` function in `src/config.ts`
- ✅ `OrchestratorConfig` accepts `masterAccountKeyArn` (preferred)
- ✅ Falls back to `masterAccountPrivateKey` (local dev only)

**3. Orchestrator Logic**
- ✅ Prioritizes ARN over direct key
- ✅ Validates key source (must have one)
- ✅ Error handling for Secrets Manager access issues
- ✅ Clear error messages for missing permissions

**4. CDK Stack Integration**
- ✅ Accepts `masterAccountKeyArn` in stack props
- ✅ Imports secret via `Secret.fromSecretCompleteArn()`
- ✅ Grants IAM permissions to EC2 role
- ✅ CloudFormation export import support

**5. CDK App Configuration**
- ✅ Supports ARN via context: `-c masterAccountKeyArn=...`
- ✅ Supports ARN via environment: `MASTER_ACCOUNT_KEY_ARN=...`
- ✅ Auto-imports from CloudFormation export: `NearLocalnetMasterAccountKeyArn`
- ✅ Fallback to direct key (with warning)

## 🔄 What AWS Node Runner Needs to Provide

### Expected CloudFormation Export

**Export Name**: `NearLocalnetMasterAccountKeyArn`

**Export Value**: ARN of Secrets Manager secret
- Format: `arn:aws:secretsmanager:region:account:secret:name-xxxxx`
- Example: `arn:aws:secretsmanager:us-east-1:123456789012:secret:near/localnet/master-account-key-AbCdEf`

### Expected Secret Format

**JSON Structure**:
```json
{
  "account": "test.near",
  "privateKey": "ed25519:5J7..."
}
```

**Storage Location**: 
- Secret Name: `/near/localnet/master-account-key` (or similar)
- Stored after `nearup localnet` creates `test.near` account

### Expected IAM Permissions

**EC2 Instance Role** (in AWS Node Runner):
- `secretsmanager:GetSecretValue` permission
- Applied to the secret ARN

**Note**: cross-chain-simulator will grant its own EC2 role permission to read the secret when `masterAccountKeyArn` is provided.

## 📋 Integration Checklist

### AWS Node Runner (Layer 1) - To Implement

- [ ] Add Secrets Manager secret to `common-stack.ts`
  ```typescript
  const masterAccountSecret = new secretsmanager.Secret(this, 'MasterAccountKey', {
    secretName: '/near/localnet/master-account-key',
    description: 'NEAR localnet master account (test.near) private key',
  });
  ```

- [ ] Export ARN as CloudFormation output
  ```typescript
  new CfnOutput(this, 'MasterAccountKeyArn', {
    value: masterAccountSecret.secretArn,
    exportName: 'NearLocalnetMasterAccountKeyArn',
  });
  ```

- [ ] Update UserData script to store key after nearup creates it
  ```bash
  # After nearup localnet creates test.near
  MASTER_KEY=$(cat ~/.near/localnet/node0/validator_key.json | jq -r '.secret_key')
  aws secretsmanager put-secret-value \
    --secret-id /near/localnet/master-account-key \
    --secret-string "{\"account\":\"test.near\",\"privateKey\":\"$MASTER_KEY\"}"
  ```

- [ ] Grant EC2 instance role permission to write secret
  ```typescript
  masterAccountSecret.grantWrite(instanceRole);
  ```

### cross-chain-simulator (Layer 2) - ✅ Complete

- [x] Secrets Manager client integration
- [x] ARN-based key retrieval
- [x] CDK stack IAM permissions
- [x] CloudFormation export import
- [x] Fallback to direct key (local dev)

## 🧪 Deployment Modes

### Mode 1: Existing Infrastructure (Use Existing NEAR Node)

**Use Case**: User already has NEAR localnet node running and wants to add cross-chain signatures.

**Requirements**:
- Existing NEAR localnet node (RPC endpoint accessible)
- Master account private key stored in AWS Secrets Manager (KMS ARN)

**Deployment**:
```bash
# Provide existing infrastructure details
export NEAR_RPC_URL=http://existing-node:3030
export MASTER_ACCOUNT_KEY_ARN=arn:aws:secretsmanager:region:account:secret:existing-key

# Deploy only CrossChainSimulatorStack
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack
```

**Configuration**:
- `nearRpcUrl`: User-provided RPC endpoint
- `masterAccountKeyArn`: User-provided Secrets Manager ARN
- Stack deploys: KMS key (for deployer), IAM roles, SSM parameters
- Stack does NOT deploy: NEAR node (uses existing)

**Expected**: ✅ Works with existing infrastructure

### Mode 2: Integrated Deployment (Deploy NEAR Node + Simulator)

**Use Case**: User wants to deploy both NEAR localnet node and cross-chain simulator together.

**Requirements**:
- AWS Node Runner code available (from [shaiss/aws-blockchain-node-runners/near](https://github.com/shaiss/aws-blockchain-node-runners/tree/near) or [aws-samples/aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners))

**Deployment**:
```bash
# Deploy both stacks together
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack --all
```

**Configuration**:
- `deployNearNode`: true (via context or default)
- Stack imports and deploys: `NearLocalnetStack` from AWS Node Runner
- Stack deploys: CrossChainSimulatorStack
- `masterAccountKeyArn`: Auto-imported from NearLocalnetStack export
- `nearRpcUrl`: Auto-imported from NearLocalnetStack export

**CDK Code**:
```typescript
// In cdk/bin/app.ts
const deployNearNode = app.node.tryGetContext('deployNearNode') !== false;

if (deployNearNode) {
  // Import AWS Node Runner stack
  const nearStack = new NearLocalnetStack(app, 'NearLocalnetStack', {
    // ... config
  });
  
  const simulatorStack = new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
    nearRpcUrl: nearStack.rpcUrl,
    masterAccountKeyArn: nearStack.masterAccountKeyArn,
  });
  
  simulatorStack.addDependency(nearStack);
} else {
  // Mode 1: Use existing infrastructure
  const simulatorStack = new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
    nearRpcUrl: process.env.NEAR_RPC_URL,
    masterAccountKeyArn: process.env.MASTER_ACCOUNT_KEY_ARN,
  });
}
```

**Expected**: ✅ Works (deploys both stacks together)

## 🔒 Security Verification

### ✅ Secure Patterns Implemented

1. **No Keys in Code**: Keys only in Secrets Manager/SSM
2. **IAM-Based Access**: Least-privilege permissions
3. **ARN References**: Cross-stack sharing via ARN, not copying keys
4. **Audit Trail**: CloudTrail logs all secret access
5. **Encryption**: Secrets Manager encrypts at rest by default

### ⚠️ Fallback Pattern (Local Dev Only)

- Direct key → Stored in SSM Parameter Store
- Only used if ARN not provided
- Warning logged to console
- Not recommended for production

## 📝 Environment Variables Reference

### Mode 1: Existing Infrastructure

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEAR_RPC_URL` | ✅ Yes | - | Existing NEAR localnet RPC endpoint |
| `MASTER_ACCOUNT_KEY_ARN` | ✅ Yes | - | ARN of Secrets Manager secret containing master account key |
| `DEPLOYER_KMS_KEY_ID` | ✅ Yes | - | KMS key for deployer account encryption |
| `AWS_REGION` | No | `us-east-1` | AWS region for Secrets Manager |

### Mode 2: Integrated Deployment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEPLOYER_KMS_KEY_ID` | ✅ Yes | - | KMS key for deployer account encryption |
| `AWS_REGION` | No | `us-east-1` | AWS region for Secrets Manager |
| `NEAR_RPC_URL` | No | - | Auto-imported from NearLocalnetStack |
| `MASTER_ACCOUNT_KEY_ARN` | No | - | Auto-imported from NearLocalnetStack |

**CDK Context Variables**:
- `deployNearNode`: `true` (default) or `false` - Controls whether to deploy NEAR node

## 🎯 Next Steps

1. **AWS Node Runner**: Implement Secrets Manager storage (see checklist above)
2. **Integration Test**: Deploy both stacks and verify key retrieval
3. **Documentation**: Update AWS Node Runner README with key management details

## 📚 References

- [KEY_MANAGEMENT_STRATEGY.md](./KEY_MANAGEMENT_STRATEGY.md) - Complete strategy document
- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [CloudFormation Cross-Stack References](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/walkthrough-crossstackref.html)

