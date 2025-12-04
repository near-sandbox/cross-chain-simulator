# cross-chain-simulator Integration Testing Guide

## Overview

This guide documents the complete end-to-end testing process for verifying that `cross-chain-simulator` can successfully integrate with `AWSNodeRunner` and function correctly on NEAR localnet.

## Prerequisites

1. ✅ AWSNodeRunner deployed and NEAR localnet node running
2. ✅ cross-chain-simulator CDK stack deployed (CrossChainSimulatorStack)
3. ✅ AWS profile configured (`export AWS_PROFILE=shai-sandbox-profile`)

## Test Status

### ✅ Phase 1: Configuration Integration (COMPLETE)
- AWSNodeRunner exports RPC URL correctly
- cross-chain-simulator reads exported configuration
- Orchestrator initializes with correct configuration

### ⚠️ Phase 2: Full Functionality Testing (IN PROGRESS)

**What We've Verified:**
- ✅ Configuration loading works
- ✅ RPC URL is correctly passed to orchestrator
- ✅ Orchestrator can be initialized

**What Still Needs Testing:**
- ⚠️ RPC connectivity (requires SSM port forwarding or VPC access)
- ⚠️ Master account key retrieval
- ⚠️ Contract deployment (v1.signer.node0)
- ⚠️ MPC node startup
- ⚠️ End-to-end Chain Signatures functionality

## Step-by-Step Testing Process

### Step 1: Set Up Network Access

Since the RPC URL uses a private IP (`http://10.0.5.132:3030`), you need network access:

**Option A: SSM Port Forwarding (Local Testing)**

```bash
export AWS_PROFILE=shai-sandbox-profile

# Get instance ID
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name near-localnet-infrastructure \
  --profile shai-sandbox-profile \
  --query "Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue" \
  --output text)

# Start port forwarding (keep this terminal open)
aws ssm start-session \
  --target $INSTANCE_ID \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3030"],"localPortNumber":["3030"]}' \
  --profile shai-sandbox-profile

# In another terminal, use localhost
export NEAR_RPC_URL=http://localhost:3030
```

**Option B: VPC Deployment (Production)**

Deploy cross-chain-simulator in the same VPC as AWSNodeRunner.

### Step 2: Get Master Account Key

The orchestrator needs a master account key to create the deployer account. For localnet, you can:

**Option A: Extract from EC2 Instance**

```bash
export AWS_PROFILE=shai-sandbox-profile
INSTANCE_ID=i-062152597d7981c0a

# Try to get validator key (node0 is a validator)
aws ssm send-command \
  --instance-ids $INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["find ~/.near -name \"validator_key.json\" -o -name \"node_key.json\" 2>/dev/null | head -3","cat ~/.near/localnet/node0/validator_key.json 2>/dev/null || cat ~/.near/validator_key.json 2>/dev/null || echo \"Not found\""]' \
  --profile shai-sandbox-profile \
  --query "Command.CommandId" --output text

# Wait a few seconds, then get output
# Look for "secret_key" field in the JSON output
```

**Option B: Use test.near Account**

If `test.near` exists on localnet, you can:
1. Query the RPC to check account status
2. Extract key from genesis configuration
3. Or initialize `test.near` with a new key

**Option C: Generate New Key (For Testing)**

```bash
cd cross-chain-simulator
./scripts/generate-near-key.sh
# This generates a new keypair - you'll need to fund it on localnet
```

### Step 3: Store Master Account Key

**Option A: Environment Variable (Quick Testing)**

```bash
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:YOUR_KEY_HERE"
```

**Option B: Secrets Manager (Production)**

```bash
# Create secret
aws secretsmanager create-secret \
  --name /near/localnet/master-account-key \
  --description "NEAR localnet master account key" \
  --secret-string '{"account":"test.near","privateKey":"ed25519:YOUR_KEY_HERE"}' \
  --profile shai-sandbox-profile

# Get ARN
export MASTER_ACCOUNT_KEY_ARN=$(aws secretsmanager describe-secret \
  --name /near/localnet/master-account-key \
  --query 'ARN' --output text)
```

### Step 4: Run Full Integration Test

```bash
cd cross-chain-simulator
export AWS_PROFILE=shai-sandbox-profile
export NEAR_RPC_URL=http://localhost:3030  # If using port forwarding
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --profile shai-sandbox-profile \
  --query "Stacks[0].Outputs[?OutputKey=='DeployerKmsKeyId'].OutputValue" \
  --output text)

# Set master key (choose one)
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."  # Option A
# OR
export MASTER_ACCOUNT_KEY_ARN="arn:aws:secretsmanager:..."  # Option B

# Run orchestrator
npm run start:localnet
```

### Step 5: Verify Success

The orchestrator should:
1. ✅ Connect to NEAR RPC
2. ✅ Initialize master account
3. ✅ Create deployer.node0 account
4. ✅ Deploy v1.signer.node0 contract
5. ✅ Start MPC nodes (3-node network)
6. ✅ Output contract ID and MPC endpoints

**Expected Output:**
```
✅ Infrastructure ready!
   RPC URL: http://localhost:3030
   Contract: v1.signer.node0
   MPC Nodes: http://localhost:3000, http://localhost:3001, http://localhost:3002
```

### Step 6: Test Chain Signatures

Once infrastructure is running, test Chain Signatures:

```typescript
import { createChainSignaturesClient } from '@near-sandbox/cross-chain-simulator';

const client = createChainSignaturesClient({
  rpcUrl: 'http://localhost:3030',
  networkId: 'localnet',
  mpcContractId: 'v1.signer.node0',
  mpcNodes: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']
});

// Test address derivation
const btcAddr = await client.deriveAddress('user.test.near', 'bitcoin');
console.log('Bitcoin address:', btcAddr.address);

// Test signature request
const sig = await client.requestSignature({
  nearAccount: 'user.test.near',
  chain: 'ethereum',
  payload: '0x...'
});
console.log('Signature:', sig);
```

## Troubleshooting

### RPC Connection Failed

**Error**: `Failed to connect to NEAR RPC`

**Solutions**:
1. Verify SSM port forwarding is active (check terminal)
2. Test connectivity: `curl http://localhost:3030/status`
3. Check security group allows port 3030 from your IP
4. Verify instance is running: `aws ec2 describe-instances --instance-ids $INSTANCE_ID`

### Master Account Key Not Found

**Error**: `Master account key required`

**Solutions**:
1. Verify `MASTER_ACCOUNT_PRIVATE_KEY` or `MASTER_ACCOUNT_KEY_ARN` is set
2. Check Secrets Manager secret exists and is accessible
3. Verify IAM permissions for Secrets Manager access
4. Extract key from EC2 instance (see Step 2)

### Contract Deployment Failed

**Error**: `Failed to deploy contract`

**Solutions**:
1. Verify master account has sufficient balance
2. Check deployer account was created successfully
3. Verify contract WASM file exists: `ls contracts/v1.signer.wasm`
4. Check NEAR RPC logs for detailed error

### MPC Nodes Won't Start

**Error**: `Failed to start MPC nodes`

**Solutions**:
1. Verify Docker is running: `docker ps`
2. Check Docker has buildx support: `docker buildx version`
3. Verify ports 3000-3002 are available
4. Check MPC node logs: `docker logs mpc-node-0`

## Next Steps After Successful Test

Once full integration is verified:

1. ✅ Document any issues found and resolutions
2. ✅ Update integration test script with actual master key handling
3. ✅ Create automated test suite
4. ✅ Proceed with building remaining simulators (near-intents-simulator, shade-agents-simulator)

## Current Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| AWSNodeRunner Deployment | ✅ Complete | Stacks deployed, node running |
| Configuration Export | ✅ Complete | RPC URL exported correctly |
| cross-chain-simulator Config | ✅ Complete | Reads RPC URL from environment |
| Orchestrator Initialization | ✅ Complete | Initializes with correct config |
| RPC Connectivity | ⚠️ Pending | Requires port forwarding or VPC |
| Master Key Retrieval | ⚠️ Pending | Need to extract from EC2 or generate |
| Contract Deployment | ⚠️ Pending | Requires master key + RPC access |
| MPC Node Startup | ⚠️ Pending | Requires contract deployment |
| End-to-End Test | ⚠️ Pending | Requires all above |

## Quick Test Script

Use the automated test script:

```bash
cd cross-chain-simulator
export AWS_PROFILE=shai-sandbox-profile
./scripts/test-full-integration.sh
```

This script will guide you through the complete testing process.

