# cross-chain-simulator

> **Layer 3: Chain Signatures** - Cross-chain signing primitives with embedded MPC infrastructure

NEAR Chain Signatures with **real MPC integration** for localnet development. Provides production-equivalent Chain Signatures infrastructure for testing and development.

## Layer Architecture

This is **Layer 3** of the 5-layer NEAR Localnet Simulator Stack:

```
Layer 1: NEAR Base                  → AWSNodeRunner
Layer 2: NEAR Services              → near-localnet-services
Layer 3: Chain Signatures (this)    ← You are here (includes MPC)
Layer 4: Intents Protocol           → near-intents-simulator
Layer 5: User Applications          → Your dApp
```

**Depends on**: Layer 2 (NEAR Services)
**Provides to higher layers**: Chain Signatures API for address derivation and transaction signing

### Embedded MPC Infrastructure

This layer **includes** the MPC infrastructure (from github.com/near/mpc). MPC is not a separate layer - it's embedded within this package at `cross-chain-simulator/mpc-repo/`.

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

## Layer boundary (important): Broadcasting is Layer 5

Chain Signatures (Layer 3) produces signatures (and/or signed transaction payloads). **Broadcasting** the signed transaction to the destination chain (e.g. Ethereum JSON-RPC) is the responsibility of the **client/app** (Layer 5).

Reference: NEAR docs “Relaying the Signature” step: `https://docs.near.org/chain-abstraction/chain-signatures/getting-started`

## Architecture

This module orchestrates real blockchain infrastructure:

- **NEAR Localnet**: Real blockchain node via AWS Node Runner (Layer 1)
- **NEAR Services**: Faucet and utilities (Layer 2)
- **MPC Network**: Real 3-8 node MPC network from github.com/near/mpc (embedded in this layer)
- **Chain Signatures**: Real v1.signer contract on localnet
- **Threshold Signatures**: Real cryptographic signing via MPC

**Important**: The MPC infrastructure is **embedded within this layer**, not a separate layer. The MPC CDK code resides at `cross-chain-simulator/mpc-repo/infra/aws-cdk/`.

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

### Deployment

- **Canonical guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Historical notes** (older “mode 1/mode 2” iterations, node0-era naming, etc.) are kept under `docs/archive/`.

### Starting Infrastructure

After deploying the CDK stack:

```bash
# Deploy contracts and start MPC nodes (uses production-equivalent MpcSetup by default)
npm run start:localnet

# Stop infrastructure (MPC nodes only, contracts persist)
npm run stop:localnet
```

**MPC is REQUIRED for Layer 3 Chain Signatures.** The orchestrator:
- Initializes contract with `init()` method
- Votes to add ECDSA domain (domain_id: 0)
- Triggers distributed key generation
- Mirrors mainnet/testnet initialization flow

**MPC Nodes Only:**
```bash
# Start MPC nodes (requires NEAR localnet running and contract deployed)
npm run start:mpc

# Stop MPC nodes
npm run stop:mpc
```

**Note**: `start:localnet` and `stop:localnet` manage contract deployment and MPC nodes. The EC2 NEAR node itself is managed separately via `/AWSNodeRunner/lib/near` and must be running before calling `start:localnet`.

### Configuring NEAR RPC Endpoint

The RPC URL is centralized in `src/config.ts` as the single source of truth. The `getNearRpcUrl()` function reads from `NEAR_RPC_URL` environment variable (highest priority) or defaults to `http://localhost:3030`.

**Option 1: Use AWSNodeRunner exported configuration (Recommended)**
```bash
# Load configuration exported by AWSNodeRunner
source ../AWSNodeRunner/lib/near/.env.localnet
export NEAR_RPC_URL  # Ensure it's exported to child processes
npm run start:mpc
```

**Option 2: Use localhost (default)**
```bash
# No configuration needed - uses http://localhost:3030
# Requires SSM port forwarding if using AWSNodeRunner
npm run start:mpc
```

**Option 3: Manual environment variable**
```bash
# Set environment variable before starting
export NEAR_RPC_URL=http://10.0.5.132:3030  # Use private IP from AWSNodeRunner
npm run start:mpc
```

**Option 4: Change default in config.ts**
Edit `src/config.ts` and change `DEFAULT_NEAR_RPC_URL` constant:
```typescript
const DEFAULT_NEAR_RPC_URL = 'http://10.0.5.132:3030';
```

**Note**: If using AWSNodeRunner, the RPC URL uses a private IP address. You'll need:
- VPC access (Lambda/EC2 in same VPC), OR
- SSM port forwarding (see AWSNodeRunner docs for setup)

### Contract Deployment

The orchestrator handles deployment of the `v1.signer.localnet` contract to your EC2 localnet:

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
- **Localnet**: `v1.signer.localnet` (uses `localnet` root account)

For historical context (older naming/deployer patterns), see `docs/archive/`.

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

## Operational Tooling

### Primary Deployment Mechanism: TypeScript Orchestrator

Layer 3 deployment is driven by the **TypeScript `LocalnetOrchestrator`** class:

```bash
npm run start:localnet  # Calls LocalnetOrchestrator.start()
```

This orchestrator:
- Reads AWS infrastructure state from CloudFormation
- Deploys the v1.signer contract
- Initializes with MPC participants
- Votes to add ECDSA domains
- Detects and auto-resets stale participant configurations (localnet only)

### near-cli-rs for Operational Tasks

The `near` CLI (near-cli-rs) is used for **operational tooling** on the NEAR base EC2 instance, not as the primary deployment mechanism.

**Temp reset script** (for emergency recovery):
```bash
# Run on NEAR base instance via SSM
./scripts/TEMP_redeploy_v1_signer_localnet.sh
```

This script uses near-cli-rs to delete/recreate/deploy/init the contract with current MPC participant URLs when the contract is stuck in "Initializing" state.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Complete architecture overview
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide for CDK and scripts
- [contracts/README.md](./contracts/README.md) - Contract WASM + naming
- `docs/archive/` - Historical docs from earlier iterations (kept for reference)

## References

- [NEAR MPC Repository](https://github.com/near/mpc) - Real MPC node implementation
- [AWS Blockchain Node Runners](https://github.com/shaiss/aws-blockchain-node-runners) - NEAR node deployment
- [NEAR Chain Signatures Docs](https://docs.near.org/concepts/abstraction/chain-signatures) - Protocol documentation

## License

MIT
