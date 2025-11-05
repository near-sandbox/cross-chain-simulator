# Cross-Chain Simulator Architecture

## Overview

The `cross-chain-simulator` provides **real NEAR Chain Signatures (MPC)** infrastructure for localnet development. This module orchestrates real MPC nodes from [github.com/near/mpc](https://github.com/near/mpc) and integrates with AWS Node Runner for NEAR blockchain deployment.

## Current State (What Exists)

### Implemented Components

- **Chain Signatures Interface Definitions**
  - `IChainSignatures` - Core Chain Signatures interface
  - `ICrossChainExec` - Cross-chain execution interface
  - Type definitions for supported chains
  - Signature request/response types

- **TypeScript Project Structure**
  - Proper compilation setup
  - Type-safe interfaces
  - Factory pattern for client creation

- **Basic Orchestration Patterns**
  - Factory function for client creation
  - Configuration management

### Current Implementation Status

**CRITICAL**: The current implementation uses **MOCK** components which are **INCORRECT** for the intended architecture. This module should use **REAL MPC infrastructure**, not simulations.

## Critical Architecture Gaps

### 1. Mock MPC Implementation

**Current**: `MockMPCService` simulates MPC signature generation

**Should Be**: Real MPC node integration from [github.com/near/mpc](https://github.com/near/mpc)
- Real 3-8 node MPC network
- Real threshold ECDSA signatures (cait-sith)
- Real Beaver triple generation
- Real presignature generation
- Real signature aggregation

### 2. Missing v1.signer Contract Integration

**Current**: Deterministic address derivation via hash functions

**Should Be**: Real contract calls to `v1.signer-dev.testnet`
- Call `public_key` method for address derivation
- Call `sign` method for signature requests
- Real MPC-derived public keys
- Real on-chain state management

### 3. Missing LocalnetConfig Exports

**Current**: No configuration exports

**Should Be**: 
```typescript
export interface LocalnetConfig {
  rpcUrl: string;              // From AWS Node Runner
  networkId: 'localnet';
  mpcContractId: string;       // v1.signer-dev.testnet
  mpcNodes: string[];          // MPC node endpoints
  headers?: Record<string, string>;
}

export function getNearRpcUrl(): string;
export function getMpcContractId(): string;
export function getMpcNodes(): string[];
```

### 4. Missing Infrastructure Orchestration

**Current**: No infrastructure scripts

**Should Be**:
- `npm run start:localnet` - Deploy NEAR node + start MPC network
- `npm run stop:localnet` - Stop all infrastructure
- Docker orchestration for MPC nodes
- CDK stack deployment for NEAR node

### 5. Missing AWS Node Runner Dependency

**Current**: No dependency

**Should Be**: Import NEAR node CDK stack from `aws-blockchain-node-runners`
- Extend base stack (per AWS CDK best practices)
- Only modify `/lib/near` directory
- Export RPC endpoint configuration

## Intended Architecture

```
cross-chain-simulator
├── Chain Signatures (REAL MPC)
│   ├── Real v1.signer contract calls
│   │   ├── public_key method → address derivation
│   │   └── sign method → signature generation
│   ├── Real MPC node integration (github.com/near/mpc)
│   │   ├── 3-8 MPC nodes (Docker)
│   │   ├── MPC indexer (watches v1.signer)
│   │   ├── Beaver triple generation
│   │   └── Presignature generation
│   └── Real threshold signatures
│       └── Threshold ECDSA (cait-sith)
└── Localnet Infrastructure Orchestration
    ├── Import AWS Node Runner (CDK stack)
    │   └── NEAR node deployment
    ├── Deploy NEAR localnet
    │   └── Expose RPC endpoint (localhost:3030)
    ├── Start MPC network (3-8 nodes)
    │   └── Expose MPC endpoints (localhost:3000+)
    └── Export LocalnetConfig for consumers
        └── Used by near-intents-simulator
```

## Dependencies

### External Dependencies

1. **NEAR MPC Network**
   - Source: [github.com/near/mpc](https://github.com/near/mpc)
   - Purpose: Real threshold signature generation
   - Integration: Docker deployment from near/mpc repository
   - Reference: [NEAR MPC README](https://github.com/near/mpc#readme)

2. **AWS Node Runner**
   - Source: [github.com/shaiss/aws-blockchain-node-runners/tree/near/lib/near](https://github.com/shaiss/aws-blockchain-node-runners/tree/near/lib/near)
   - Purpose: NEAR blockchain node deployment
   - Integration: CDK stack composition (extend, don't modify base)
   - Guidelines: Only modify `/lib/near` directory

### Internal Components

1. **Chain Signatures Simulator**
   - Implements `IChainSignatures` interface
   - Connects to real MPC network
   - Calls real v1.signer contract

2. **Localnet Orchestrator**
   - Manages infrastructure lifecycle
   - Coordinates NEAR node + MPC network
   - Exports configuration

## Integration Points

### With NEAR MPC

**Contract Interface**:
```rust
// v1.signer contract methods
pub fn public_key(&self, path: String) -> PublicKey;
pub fn sign(&mut self, request: SignRequest) -> Promise;
```

**MPC Node Architecture** (from github.com/near/mpc):
- NEAR Indexer: Tracks `v1.signer` contract for signature requests
- MPC Signing: Threshold ECDSA using cait-sith
- Beaver Triple Generation: Background process (1M triples per node)
- Presignature Generation: Background process
- Signature Generation: Uses presignature + one round of communication

### With AWS Node Runner

**CDK Stack Pattern**:
```typescript
// Import base NEAR node stack
import { NearNodeStack } from 'aws-blockchain-node-runners/lib/near';

// Extend without modifying source
export class CrossChainNearStack extends NearNodeStack {
  // Add cross-chain-simulator specific resources
  // Export RPC URL
}
```

**Best Practices**:
- Only modify `/lib/near` directory
- Use CDK stack composition
- Export outputs for consumption
- Don't modify base repository

### With Near Intents Simulator

**Exports Consumed**:
```typescript
import { 
  LocalnetConfig,
  getNearRpcUrl,
  getMpcContractId,
  getMpcNodes
} from '@near-sandbox/cross-chain-simulator';
```

**Usage Pattern**:
```typescript
const config = {
  rpcUrl: getNearRpcUrl(),
  mpcContractId: getMpcContractId(),
  mpcNodes: getMpcNodes()
};

const adapter = new LocalnetMPCAdapter(config);
```

## Implementation Status

**Current Completion**: ~20%

- ✅ Interface definitions (10%)
- ✅ Project structure (10%)
- ❌ Real MPC integration (should be 40% - MISSING)
- ❌ Infrastructure orchestration (should be 40% - MISSING)

## Next Steps

See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for detailed implementation steps.

## References

- [NEAR MPC Repository](https://github.com/near/mpc) - Real MPC node implementation
- [AWS Blockchain Node Runners](https://github.com/shaiss/aws-blockchain-node-runners) - NEAR node deployment
- [NEAR Chain Signatures Documentation](https://docs.near.org/concepts/abstraction/chain-signatures) - Protocol overview

