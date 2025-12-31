# Contract Deployment Strategy

## Overview

This document outlines the strategy for deploying the v1.signer contract and orchestrating MPC infrastructure on NEAR localnet.

## Key Findings from RPC Investigation

**Localnet Node Status:**
- ✅ RPC accessible at `http://54.90.246.254:3030`
- ✅ Chain ID: `test-chain-jszNl` (localnet/test setup)
- ✅ Validators: `node0`, `node3` (genesis accounts with large balances)
- ✅ `test.near` exists but currently has 0 access keys

**Account Naming Conventions:**
- **Master Account**: `test.near` (confirmed, but needs initialization)
- **Deployer Account**: `deployer.node0` (to be created)
- **Contract Account**: `v1.signer-dev.localnet` (to be created)
- **Suffix Pattern**: `.localnet` suffix aligns with production naming (`v1.signer-dev.testnet` → `v1.signer-dev.localnet`)

## Deployment Architecture

### Account Hierarchy

```
test.near (master account - needs initialization)
  └── deployer.node0 (deployment account - AWS KMS managed)
      └── v1.signer-dev.localnet (MPC signer contract)
```

### Component Responsibilities

1. **Master Account (`test.near`)**
   - Genesis/master account with deployment privileges
   - Used to create `deployer.node0`
   - Should be initialized with access keys if needed

2. **Deployer Account (`deployer.node0`)**
   - Centralized deployment account
   - AWS KMS managed private key
   - Creates and manages contract accounts
   - Deploys contract WASM files

3. **Contract Account (`v1.signer-dev.localnet`)**
   - Hosts the v1.signer MPC contract
   - Provides `public_key(path)` and `sign(request)` methods
   - Interacts with MPC network

## AWS KMS Key Management Strategy

### Key Storage Approach

Based on [AWS KMS BYOK best practices](https://aws.amazon.com/blogs/web3/import-ethereum-private-keys-to-aws-kms/):

**For EC2 Deployments:**
- Store `deployer.node0` private key in AWS KMS
- Use AWS KMS asymmetric key with `ECC_SECG_P256K1` spec (if compatible) or `ED25519` for NEAR
- Import existing key material or generate new key via KMS
- Use IAM roles for EC2 instances to access KMS keys
- Never store keys in code or environment variables

**For Local Development:**
- Use AWS KMS for consistency (if AWS credentials available)
- Fallback to environment variables with clear warnings
- Support both KMS and local key storage modes

### KMS Key Configuration

```typescript
// Key specification for NEAR (ED25519)
Key Type: Asymmetric
Key Usage: Sign and verify
Key Spec: ED25519 (NEAR standard) or ECC_SECG_P256K1 (if MPC compatible)
Key Material: External (Import) or AWS-generated
Region: Single-region key
```

### Key Access Pattern

```typescript
// Example: Sign transaction using KMS
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';

const kmsClient = new KMSClient({ region: 'us-east-1' });
const signCommand = new SignCommand({
  KeyId: process.env.DEPLOYER_KMS_KEY_ID,
  Message: Buffer.from(transactionBytes),
  MessageType: 'RAW',
  SigningAlgorithm: 'ECDSA_SHA_256' // or ED25519 equivalent
});
```

## Contract Deployment Flow

### Phase 1: Initialize Master Account

```typescript
// Check if test.near has access keys
// If not, initialize with a key pair
// Store master key securely (AWS KMS or secure env var)
```

### Phase 2: Create Deployer Account

```typescript
// 1. Generate deployer key pair
// 2. Import to AWS KMS (if using KMS)
// 3. Create deployer.node0 account from test.near
// 4. Fund deployer account
// 5. Store KMS key ID in configuration
```

### Phase 3: Deploy v1.signer Contract

```typescript
// 1. Check if v1.signer-dev.localnet exists
// 2. If not, create from deployer.node0
// 3. Load contract WASM file
// 4. Deploy using deployer account (signed via KMS)
// 5. Initialize contract
// 6. Verify deployment
```

### Phase 4: Start MPC Nodes

```typescript
// 1. Start MPC Docker containers
// 2. Configure MPC nodes to watch v1.signer-dev.localnet
// 3. Wait for MPC nodes to be ready
// 4. Verify MPC health checks
```

## Implementation Components

### 1. Contract Deployer (`src/localnet/contract-deployer.ts`)

```typescript
export class ContractDeployer {
  constructor(
    private rpcUrl: string,
    private deployerAccountId: string = 'deployer.node0',
    private masterAccountId: string = 'test.near',
    private kmsKeyId?: string // AWS KMS key ID for deployer
  ) {}

  async initializeMasterAccount(): Promise<void>
  async createDeployerAccount(): Promise<void>
  async deploySignerContract(contractAccountId: string): Promise<string>
  async verifyContractDeployment(contractId: string): Promise<boolean>
}
```

### 2. KMS Key Manager (`src/localnet/kms-key-manager.ts`)

```typescript
export class KMSKeyManager {
  async importPrivateKey(keyId: string, privateKey: string): Promise<void>
  async signTransaction(keyId: string, message: Buffer): Promise<Buffer>
  async getPublicKey(keyId: string): Promise<string>
}
```

### 3. Localnet Orchestrator (`src/localnet/orchestrator.ts`)

```typescript
export class LocalnetOrchestrator {
  async start(): Promise<LocalnetConfig> {
    // 1. Verify NEAR RPC is accessible
    // 2. Initialize master account (if needed)
    // 3. Create deployer account (if needed)
    // 4. Deploy v1.signer contract (if not exists)
    // 5. Start MPC nodes
    // 6. Wait for all services to be ready
    // 7. Return LocalnetConfig
  }

  async stop(): Promise<void> {
    // Stop MPC nodes
    // (Don't delete contracts - they persist on blockchain)
  }
}
```

## Configuration Updates

### Environment Variables

```bash
# NEAR Configuration
NEAR_RPC_URL=http://54.90.246.254:3030
NEAR_NETWORK_ID=localnet

# Master Account
MASTER_ACCOUNT_ID=test.near
MASTER_ACCOUNT_KEY=<master-key-or-kms-id>

# Deployer Account
DEPLOYER_ACCOUNT_ID=deployer.node0
DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id

# Contract Configuration
MPC_CONTRACT_ID=v1.signer-dev.localnet
CONTRACT_WASM_PATH=./contracts/v1.signer.wasm

# AWS Configuration (for KMS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<optional-if-using-iam-role>
AWS_SECRET_ACCESS_KEY=<optional-if-using-iam-role>
```

### Config Functions Update

```typescript
// src/config.ts
export function getMpcContractId(): string {
  return process.env.MPC_CONTRACT_ID || 'v1.signer-dev.localnet'; // Updated from .testnet
}

export function getDeployerAccountId(): string {
  return process.env.DEPLOYER_ACCOUNT_ID || 'deployer.node0';
}

export function getMasterAccountId(): string {
  return process.env.MASTER_ACCOUNT_ID || 'test.near';
}

export function getDeployerKmsKeyId(): string | undefined {
  return process.env.DEPLOYER_KMS_KEY_ID;
}
```

## Security Considerations

### Key Management

1. **AWS KMS Best Practices:**
   - Use IAM roles for EC2 instances (no hardcoded credentials)
   - Enable KMS key rotation if supported
   - Use separate KMS keys for different environments
   - Monitor KMS key usage via CloudTrail

2. **Local Development:**
   - Never commit keys to repository
   - Use `.env.local` files (gitignored)
   - Clear warnings when using local keys vs KMS

3. **Deployment Account:**
   - Minimal permissions (only deploy contracts)
   - Separate from master account
   - Audit all deployments

### Network Security

- RPC endpoint secured (currently open, should restrict in production)
- MPC nodes in private network (Docker bridge)
- Contract calls over HTTPS/TLS when possible

## Testing Strategy

### Unit Tests
- Test contract deployer logic (mocked KMS)
- Test account creation flows
- Test contract deployment verification

### Integration Tests
- Test with real NEAR RPC (EC2)
- Test KMS key signing (if AWS credentials available)
- Test contract deployment end-to-end
- Test MPC node integration

### Manual Verification
```bash
# Check deployed contract
curl -X POST http://54.90.246.254:3030 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"query",
    "id":"dontcare",
    "params":{
      "request_type":"view_account",
      "account_id":"v1.signer-dev.localnet",
      "finality":"final"
    }
  }'
```

## Dependencies to Add

```json
{
  "dependencies": {
    "@aws-sdk/client-kms": "^3.x.x",
    "near-api-js": "^2.1.0",
    "uuid": "^9.0.1"
  }
}
```

## Next Steps

1. ✅ **RPC Investigation** - Confirmed node accessibility and account patterns
2. ⏭️ **Implement KMS Key Manager** - AWS KMS integration for key storage
3. ⏭️ **Implement Contract Deployer** - Deploy v1.signer contract
4. ⏭️ **Implement Orchestrator** - Full infrastructure orchestration
5. ⏭️ **Update Configuration** - Use `.localnet` suffix throughout
6. ⏭️ **Integration Testing** - Test with EC2 RPC endpoint

## References

- [AWS KMS BYOK Guide](https://aws.amazon.com/blogs/web3/import-ethereum-private-keys-to-aws-kms/)
- [NEAR Contract Deployment](https://docs.near.org/develop/contracts/introduction)
- [NEAR Account Creation](https://docs.near.org/concepts/basics/accounts)
- [AWS KMS Documentation](https://docs.aws.amazon.com/kms/)

