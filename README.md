# cross-chain-simulator

NEAR Chain Signatures with **real MPC integration** for localnet development. Provides production-equivalent Chain Signatures infrastructure for testing and development.

> **✅ NEW**: Full CDK deployment with AWS KMS integration! See [QUICKSTART.md](./QUICKSTART.md) for 3-step deployment.

## Installation

```bash
npm install @near-sandbox/cross-chain-simulator
```

## Usage

```typescript
import { ChainSignaturesSimulator, createChainSignaturesClient } from '@near-sandbox/cross-chain-simulator';

// Address derivation via real MPC
const chainSigs = createChainSignaturesClient();
const btcAddr = await chainSigs.deriveAddress('user.near', 'bitcoin');
console.log('Bitcoin:', btcAddr.address);

// Signature creation via real MPC network
const sig = await chainSigs.requestSignature({
  nearAccount: 'user.near',
  chain: 'ethereum',
  payload: '0x...'
});
```

## Prerequisites

- Docker with buildx support (for MPC nodes from github.com/near/mpc)
- AWS CDK v2 (for Node Runner integration)
- Node.js 18+
- Rust toolchain (for building MPC nodes if needed)

## Supported Chains

- Bitcoin
- Ethereum
- Dogecoin
- Ripple
- Polygon
- Arbitrum
- Optimism

## Features

- **Real MPC integration** via [github.com/near/mpc](https://github.com/near/mpc)
- **Real v1.signer contract** interaction for address derivation
- **Real threshold signatures** using cait-sith protocol
- Cross-chain transaction simulation
- Fee estimation
- Production-equivalent localnet environment

## Architecture

This module orchestrates real blockchain infrastructure:

- **NEAR Localnet**: Real blockchain node via AWS Node Runner
- **MPC Network**: Real 3-8 node MPC network from github.com/near/mpc
- **Chain Signatures**: Real v1.signer contract on localnet
- **Threshold Signatures**: Real cryptographic signing via MPC

See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete architecture documentation.

## Current Implementation Status

**Phase 1-2 Complete**: Real MPC integration and v1.signer contract calls are now implemented.

### ✅ Completed:

1. **Real MPC Service** - `MPCService` integrates with real MPC nodes from github.com/near/mpc
2. **v1.signer Contract Integration** - `NearClient` calls real contract for address derivation and signing
3. **LocalnetConfig Exports** - Configuration exported for near-intents-simulator consumption
4. **MPC Docker Infrastructure** - Docker Compose setup for MPC network deployment
5. **Infrastructure Scripts** - `npm run start:mpc` and `npm run stop:mpc` scripts
6. **Mock Removal** - All mock implementations removed

### ✅ Contract Deployment & Orchestration (New):

7. **Contract Deployment** - `ContractDeployer` with AWS KMS integration for secure deployment
8. **Localnet Orchestrator** - `LocalnetOrchestrator` coordinates full infrastructure startup
9. **Infrastructure Scripts** - `npm run start:localnet` and `npm run stop:localnet` for full orchestration

### 🚧 Pending (Phase 3):

- **AWS Node Runner Integration** - NEAR node deployment via CDK (managed separately via `/AWSNodeRunner/lib/near`)

### Usage with LocalnetConfig

```typescript
import { 
  createChainSignaturesClient,
  LocalnetConfig,
  getNearRpcUrl,
  getMpcContractId,
  getMpcNodes
} from '@near-sandbox/cross-chain-simulator';

// Use default config from environment
const client = createChainSignaturesClient();

// Or provide custom config
const config: LocalnetConfig = {
  rpcUrl: getNearRpcUrl(),
  networkId: 'localnet',
  mpcContractId: getMpcContractId(),
  mpcNodes: getMpcNodes(),
};
const client = createChainSignaturesClient(config);
```

### Deployment Modes

The simulator supports two deployment modes. See [DEPLOYMENT_MODES.md](./DEPLOYMENT_MODES.md) for details.

**Mode 1: Existing Infrastructure** (Use existing NEAR node)
```bash
# Prerequisites:
# - Existing NEAR localnet node running
# - Master account key in AWS Secrets Manager
# - AWS credentials configured

export NEAR_RPC_URL=http://your-existing-node:3030
export MASTER_ACCOUNT_KEY_ARN=arn:aws:secretsmanager:region:account:secret:key
export DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id

# Deploy simulator stack
cdk deploy CrossChainSimulatorStack

# Deploy contracts and start MPC
npm run start:localnet
```

**Mode 2: Integrated Deployment** (Deploy NEAR node + simulator)
```bash
# Prerequisites:
# - AWS Node Runner code available
# - AWS credentials configured

export DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id

# Deploy both NEAR node and simulator
cdk deploy CrossChainSimulatorStack --all

# Deploy contracts and start MPC
npm run start:localnet
```

### Starting Infrastructure

After deploying the CDK stack:

```bash
# Deploy contracts and start MPC nodes
npm run start:localnet

# Stop infrastructure (MPC nodes only, contracts persist)
npm run stop:localnet
```

**MPC Nodes Only:**
```bash
# Start MPC nodes (requires NEAR localnet running and contract deployed)
npm run start:mpc

# Stop MPC nodes
npm run stop:mpc
```

**Note**: `start:localnet` and `stop:localnet` manage contract deployment and MPC nodes. The EC2 NEAR node itself is managed separately via `/AWSNodeRunner/lib/near` and must be running before calling `start:localnet`.

### Configuring NEAR RPC Endpoint

The RPC URL is centralized in `src/config.ts` as the single source of truth.

**Option 1: Use localhost (default)**
```bash
# No configuration needed - uses http://localhost:3030
npm run start:mpc
```

**Option 2: Use EC2 instance**
```bash
# Set environment variable before starting
export NEAR_RPC_URL=http://54.90.246.254:3030
npm run start:mpc
```

**Option 3: Change default in config.ts**
Edit `src/config.ts` and change `DEFAULT_NEAR_RPC_URL` constant:
```typescript
const DEFAULT_NEAR_RPC_URL = 'http://54.90.246.254:3030';
```

The EC2 instance details:
- Instance ID: `i-05fce3d18e6b1ba8b`
- Public IP: `54.90.246.254`
- Port: `3030` (open from 0.0.0.0)

### Contract Deployment

The orchestrator handles deployment of the `v1.signer.node0` contract to your EC2 localnet:

```bash
# Ensure contract WASM is available
./contracts/download-wasm.sh

# Deploy infrastructure (includes contract deployment)
export DEPLOYER_KMS_KEY_ID=arn:aws:kms:region:account:key/key-id
npm run start:localnet
```

**Contract Account Naming:**
- **Mainnet**: `v1.signer`
- **Testnet**: `v1.signer-prod.testnet`
- **Localnet**: `v1.signer.node0`

See [CONTRACT_DEPLOYMENT_STRATEGY.md](./CONTRACT_DEPLOYMENT_STRATEGY.md) for deployment details.
See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for detailed implementation steps.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment guide.

**Quick start with CDK:**
```bash
# 1. Deploy CDK stack (KMS key + IAM roles)
npm run cdk:deploy

# 2. Export KMS key ID
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

# 3. Deploy infrastructure
npm run start:localnet
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Tests (to be implemented)
npm test

# CDK commands
npm run cdk:synth    # Synthesize CloudFormation template
npm run cdk:deploy   # Deploy infrastructure
npm run cdk:destroy  # Remove infrastructure (KMS key retained)
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Complete architecture overview
- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Step-by-step implementation plan
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide for CDK and scripts
- [CONTRACT_DEPLOYMENT_STRATEGY.md](./CONTRACT_DEPLOYMENT_STRATEGY.md) - Contract deployment strategy
- [cdk/README.md](./cdk/README.md) - CDK infrastructure details

## References

- [NEAR MPC Repository](https://github.com/near/mpc) - Real MPC node implementation
- [AWS Blockchain Node Runners](https://github.com/shaiss/aws-blockchain-node-runners) - NEAR node deployment
- [NEAR Chain Signatures Docs](https://docs.near.org/concepts/abstraction/chain-signatures) - Protocol documentation

## License

MIT
