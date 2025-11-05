# AWS Key Management Strategy for NEAR Localnet

## Problem Statement

The `cross-chain-simulator` needs access to the master account (`test.near`) private key to deploy contracts and create subaccounts. Following AWS best practices, we need secure key storage and sharing across CDK stacks.

## Current Architecture Gap

**AWS Node Runner for NEAR** (Layer 1):
- Deploys NEAR localnet node
- **Missing**: No KMS/Secrets Manager key storage implemented yet
- Master account key currently on EC2 instance filesystem only

**cross-chain-simulator** (Layer 2):
- Needs master account key to deploy contracts
- Currently expects key via environment variable (insecure for production)

## AWS Best Practices for Key Management

### 1. Key Generation & Storage

**At NEAR Node Deployment (Layer 1):**

```typescript
// In AWS Node Runner common-stack.ts
export class NearLocalnetCommonStack extends Stack {
  public readonly masterAccountKeyArn: string;
  
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    
    // Option A: Use Secrets Manager (recommended for key rotation)
    const masterAccountSecret = new secretsmanager.Secret(this, 'MasterAccountKey', {
      secretName: '/near/localnet/master-account-key',
      description: 'NEAR localnet master account (test.near) private key',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ account: 'test.near' }),
        generateStringKey: 'privateKey',
        passwordLength: 64,  // ED25519 key length
      },
    });
    
    // Option B: Use KMS with custom key material (BYOK pattern)
    const masterKeyKms = new kms.Key(this, 'MasterAccountKmsKey', {
      description: 'KMS key for NEAR master account encryption',
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,  // For encrypt/decrypt
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    
    // Store encrypted private key in SSM Parameter Store
    const encryptedKeyParam = new ssm.StringParameter(this, 'MasterAccountEncryptedKey', {
      parameterName: '/near/localnet/master-account-encrypted-key',
      description: 'KMS-encrypted test.near private key',
      tier: ssm.ParameterTier.STANDARD,
      stringValue: '<will-be-set-by-userdata>',  // EC2 UserData encrypts and stores
    });
    
    // Export ARN for cross-stack access
    this.masterAccountKeyArn = masterAccountSecret.secretArn;
    
    new CfnOutput(this, 'MasterAccountKeyArn', {
      value: this.masterAccountKeyArn,
      description: 'ARN for master account key (Secrets Manager)',
      exportName: 'NearLocalnetMasterAccountKeyArn',
    });
  }
}
```

**UserData Script Enhancement:**

```bash
#!/bin/bash
# In infrastructure-stack UserData

# After nearup localnet creates test.near...

# Get master account private key from nearup
MASTER_KEY=$(cat ~/.near/localnet/node0/validator_key.json | jq -r '.secret_key')

# Option A: Store in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id /near/localnet/master-account-key \
  --secret-string "{\"account\":\"test.near\",\"privateKey\":\"$MASTER_KEY\"}" \
  --region $AWS_REGION

# Option B: Encrypt with KMS and store in SSM
KMS_KEY_ID="arn:aws:kms:..."  # From stack outputs
ENCRYPTED_KEY=$(aws kms encrypt \
  --key-id $KMS_KEY_ID \
  --plaintext "$MASTER_KEY" \
  --query 'CiphertextBlob' \
  --output text)

aws ssm put-parameter \
  --name /near/localnet/master-account-encrypted-key \
  --value "$ENCRYPTED_KEY" \
  --type SecureString \
  --key-id $KMS_KEY_ID \
  --overwrite \
  --region $AWS_REGION
```

### 2. Cross-Stack Key Sharing

**Scenario 1: Same AWS Account (Recommended)**

Use CloudFormation exports and imports:

```typescript
// In cross-chain-simulator CDK stack
import { Fn } from 'aws-cdk-lib';

export class CrossChainSimulatorStack extends Stack {
  constructor(scope: Construct, id: string, props: CrossChainSimulatorStackProps) {
    super(scope, id, props);
    
    // Import master account key ARN from AWS Node Runner stack
    const masterKeyArn = props.masterAccountKeyArn || 
      Fn.importValue('NearLocalnetMasterAccountKeyArn');
    
    // Grant read access to orchestrator role
    const masterAccountSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MasterAccountSecret',
      masterKeyArn
    );
    
    // Grant orchestrator role permission to read secret
    masterAccountSecret.grantRead(this.ec2Role);
    
    // Pass ARN via environment
    new CfnOutput(this, 'MasterAccountKeyArnUsed', {
      value: masterKeyArn,
      description: 'Master account key ARN (from AWS Node Runner)',
    });
  }
}
```

**Scenario 2: Different AWS Accounts (Cross-Account)**

Use resource-based policies:

```typescript
// In AWS Node Runner stack - grant cross-account access
const crossAccountPrincipal = new iam.AccountPrincipal('111122223333');  // Simulator account

masterAccountSecret.addToResourcePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  principals: [crossAccountPrincipal],
  actions: ['secretsmanager:GetSecretValue'],
  resources: ['*'],
}));
```

### 3. Usage in cross-chain-simulator

**Update LocalnetOrchestrator:**

```typescript
// src/localnet/orchestrator.ts
export interface OrchestratorConfig {
  rpcUrl?: string;
  networkId?: string;
  
  // Key management options
  masterAccountKeyArn?: string;        // ARN from AWS Node Runner (preferred)
  masterAccountPrivateKey?: string;    // Fallback for local dev only
  
  deployerKmsKeyId?: string;
  encryptedDeployerPrivateKey?: string;
}

export class LocalnetOrchestrator {
  constructor(private config: OrchestratorConfig = {}) {
    // Validate key source
    if (!config.masterAccountKeyArn && !config.masterAccountPrivateKey) {
      throw new Error(
        'Master account key required. Provide either:\n' +
        '  - masterAccountKeyArn (from AWS Node Runner) OR\n' +
        '  - masterAccountPrivateKey (local dev only)'
      );
    }
  }
  
  async start(): Promise<LocalnetConfig> {
    // 1. Retrieve master account key
    const masterKey = await this.getMasterAccountKey();
    
    // 2. Add key to deployer's keystore
    await this.deployer.addMasterAccountKey(masterKey);
    
    // ... rest of orchestration
  }
  
  private async getMasterAccountKey(): Promise<string> {
    // Prefer ARN (production)
    if (this.config.masterAccountKeyArn) {
      return await this.fetchKeyFromSecretsManager(this.config.masterAccountKeyArn);
    }
    
    // Fallback to direct key (local dev only)
    if (this.config.masterAccountPrivateKey) {
      console.warn('⚠️  Using direct private key (not recommended for production)');
      return this.config.masterAccountPrivateKey;
    }
    
    throw new Error('No master account key source configured');
  }
  
  private async fetchKeyFromSecretsManager(arn: string): Promise<string> {
    const client = new SecretsManagerClient({ region: this.config.region });
    const command = new GetSecretValueCommand({ SecretId: arn });
    
    try {
      const response = await client.send(command);
      const secret = JSON.parse(response.SecretString!);
      return secret.privateKey;
    } catch (error) {
      throw new Error(`Failed to retrieve master key from Secrets Manager: ${error}`);
    }
  }
}
```

### 4. Deployment Modes

**Mode 1: Existing Infrastructure (Use Existing NEAR Node)**

User already has NEAR localnet node and wants to add cross-chain signatures:

```bash
# User provides existing infrastructure details
export NEAR_RPC_URL=http://existing-node:3030
export MASTER_ACCOUNT_KEY_ARN=arn:aws:secretsmanager:region:account:secret:existing-key

# Deploy only CrossChainSimulatorStack
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack
```

**CDK Configuration**:
```typescript
new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
  nearRpcUrl: process.env.NEAR_RPC_URL,  // User-provided
  masterAccountKeyArn: process.env.MASTER_ACCOUNT_KEY_ARN,  // User-provided
});
```

**Pattern B: Integrated Deployment (Deploy NEAR Node + Simulator)**

User wants to deploy both stacks together:

```bash
# Deploy both stacks (default mode)
cd /cross-chain-simulator
cdk deploy CrossChainSimulatorStack --all
```

**CDK Configuration**:
```typescript
// Import NearLocalnetStack from AWS Node Runner
// Source: https://github.com/shaiss/aws-blockchain-node-runners/tree/near
// Future: https://github.com/aws-samples/aws-blockchain-node-runners
import { NearLocalnetStack } from '@aws-samples/aws-blockchain-node-runners/lib/near';

const nearStack = new NearLocalnetStack(app, 'NearLocalnetStack', {/*...*/});
const simulatorStack = new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
  nearRpcUrl: nearStack.rpcUrl,  // Auto-imported
  masterAccountKeyArn: nearStack.masterAccountKeyArn,  // Auto-imported
});

simulatorStack.addDependency(nearStack);
```

## Implementation Plan

### Phase 1: Update AWS Node Runner (Layer 1)

- [ ] Add Secrets Manager secret to `common-stack.ts`
- [ ] Update UserData to store master key in Secrets Manager
- [ ] Export `NearLocalnetMasterAccountKeyArn` CloudFormation output
- [ ] Export `NearLocalnetRpcUrl` CloudFormation output
- [ ] Add KMS key for optional encryption pattern
- [ ] Update README with key management documentation
- [ ] Publish to npm or make importable for Mode 2 deployment

### Phase 2: Update cross-chain-simulator (Layer 2) ✅ COMPLETE

- [x] Add `@aws-sdk/client-secrets-manager` dependency
- [x] Update `OrchestratorConfig` to accept `masterAccountKeyArn`
- [x] Implement `fetchKeyFromSecretsManager()` method
- [x] Update CDK stack to import ARN via CloudFormation export or context
- [x] Grant EC2 role permission to read secret
- [x] Update CDK app to support Mode 1 (existing infrastructure)
- [x] Update CDK app to support Mode 2 (integrated deployment)
- [x] Update documentation with deployment modes

### Phase 3: Integration Testing

- [ ] Test Mode 1: Existing infrastructure (user-provided RPC + ARN)
- [ ] Test Mode 2: Integrated deployment (deploy both stacks)
- [ ] Verify CloudFormation exports/imports work correctly
- [ ] Verify Secrets Manager access permissions

## Security Considerations

### ✅ Best Practices Followed

1. **No Keys in Code**: Keys stored in Secrets Manager/SSM only
2. **IAM Permissions**: Least-privilege access to secrets
3. **Encryption at Rest**: Secrets Manager encrypts by default
4. **Audit Trail**: CloudTrail logs all secret access
5. **Key Rotation**: Secrets Manager supports automatic rotation
6. **Cross-Stack Sharing**: Via ARN references, not copying keys

### ⚠️ Security Warnings

**NEVER:**
- Commit private keys to git
- Pass keys via environment variables in production
- Store keys in CloudFormation parameters (visible in console)
- Log private key values

**ALWAYS:**
- Use Secrets Manager or SSM SecureString
- Grant minimal IAM permissions
- Use CloudFormation exports for ARN sharing
- Enable CloudTrail for audit logging

## Migration Path

### Current State → Target State

**Current (Insecure):**
```bash
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."  # ❌ Insecure
npm run start:localnet
```

**Target (Secure):**
```bash
export MASTER_ACCOUNT_KEY_ARN="arn:aws:secretsmanager:..."  # ✅ Secure
npm run start:localnet
```

### Backward Compatibility

For local development, support both patterns:

```typescript
// Environment variable priority:
// 1. MASTER_ACCOUNT_KEY_ARN (production)
// 2. MASTER_ACCOUNT_PRIVATE_KEY (local dev, with warning)

const config = {
  masterAccountKeyArn: process.env.MASTER_ACCOUNT_KEY_ARN,
  masterAccountPrivateKey: process.env.MASTER_ACCOUNT_PRIVATE_KEY,  // Fallback
};
```

## References

- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [AWS KMS Key Management](https://docs.aws.amazon.com/kms/latest/developerguide/overview.html)
- [CloudFormation Cross-Stack References](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/walkthrough-crossstackref.html)
- [AWS BYOK for Web3](https://aws.amazon.com/blogs/web3/import-ethereum-private-keys-to-aws-kms/)

