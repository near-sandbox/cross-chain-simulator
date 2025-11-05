# Implementation Guide

## Overview

This guide outlines how to replace mock implementations with real MPC infrastructure. The goal is to transform `cross-chain-simulator` from a mock-based simulator to a real infrastructure orchestrator using actual NEAR MPC nodes and v1.signer contract.

## Dependencies

### 1. NEAR MPC Network

**Source**: [github.com/near/mpc](https://github.com/near/mpc)

**Integration approach** (per NEAR MPC best practices from the repository):

- **Docker Deployment**: Use Docker deployment from near/mpc repository
  - Build images using `deployment/build-images.sh`
  - Requires Docker with buildx support
  - Requires `repro-env` tool for reproducible builds

- **MPC Node Configuration**:
  - Deploy 3-8 MPC nodes for localnet (minimum 3 for threshold)
  - Each node runs:
    - NEAR Indexer: Tracks `v1.signer` contract shard
    - MPC Signing: Threshold ECDSA using cait-sith
    - Beaver Triple Generation: Background process (1M triples per node)
    - Presignature Generation: Background process

- **Network Setup**:
  - Configure nodes to watch `v1.signer-dev.testnet` contract
  - Expose MPC endpoints (localhost:3000, 3001, 3002...)
  - Set up leader/secondary leader node mapping
  - Configure MPC node communication

- **Contract Deployment**:
  - Deploy `v1.signer-dev.testnet` contract to localnet
  - Contract provides `public_key` and `sign` methods
  - MPC indexer watches for `sign` function calls

**Reference**: See [NEAR MPC README](https://github.com/near/mpc#readme) for detailed architecture

### 2. AWS Node Runner

**Source**: [github.com/shaiss/aws-blockchain-node-runners/tree/near/lib/near](https://github.com/shaiss/aws-blockchain-node-runners/tree/near/lib/near)

**Integration approach** (per AWS CDK best practices):

- **CDK Stack Composition**:
  - Import NEAR node CDK stack from aws-blockchain-node-runners
  - Extend base stack without modifying source
  - Use CDK stack composition patterns
  - Export RPC URL for cross-chain-simulator consumption

- **Guidelines** (per aws-blockchain-node-runners):
  - **ONLY modify `/lib/near` directory**
  - Do NOT modify base repository structure
  - Use CDK stack inheritance/composition
  - Export stack outputs (RPC URL, network ID)

- **Stack Pattern**:
```typescript
// Import base stack
import { NearNodeStack } from 'aws-blockchain-node-runners/lib/near';

// Extend with cross-chain-simulator specific resources
export class CrossChainNearStack extends NearNodeStack {
  public readonly rpcUrl: string;
  
  constructor(scope: Construct, id: string, props: NearNodeProps) {
    super(scope, id, props);
    
    // Add cross-chain-simulator resources
    // Export RPC URL
    this.rpcUrl = new CfnOutput(this, 'RpcUrl', {
      value: this.nodeRpcUrl
    }).value;
  }
}
```

**Note**: Per aws-blockchain-node-runners guidelines, only modify `/lib/near` directory. Do not modify base repository structure.

## Required Exports

### LocalnetConfig Interface

The following interface and helper functions must be exported from `cross-chain-simulator`:

```typescript
export interface LocalnetConfig {
  rpcUrl: string;              // From AWS Node Runner
  networkId: 'localnet';
  mpcContractId: string;       // v1.signer-dev.testnet
  mpcNodes: string[];          // MPC node endpoints
  headers?: Record<string, string>;
}

export function getNearRpcUrl(): string {
  // Get from AWS Node Runner stack output or environment
  return process.env.NEAR_RPC_URL || 'http://localhost:3030';
}

export function getMpcContractId(): string {
  // Get deployed contract address
  return process.env.MPC_CONTRACT_ID || 'v1.signer-dev.testnet';
}

export function getMpcNodes(): string[] {
  // Get from MPC network deployment
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
    // ... more nodes as needed
  ];
}
```

## Implementation Phases

### Phase 1: MPC Node Integration

**Goal**: Deploy and integrate real MPC nodes from github.com/near/mpc

**Steps**:

1. **Add NEAR MPC as dependency**
   - Clone or reference github.com/near/mpc
   - Set up Docker build environment
   - Build MPC node images using `deployment/build-images.sh`

2. **Deploy v1.signer-dev.testnet contract**
   - Deploy contract to NEAR localnet
   - Verify contract is accessible
   - Note contract address

3. **Configure MPC indexer**
   - Set up NEAR indexer to watch v1.signer contract shard
   - Configure indexer to track `sign` function calls
   - Set up leader node mapping

4. **Start Beaver triple generation**
   - Configure nodes to generate Beaver triples in background
   - Target: 1M triples per node
   - Monitor generation progress

5. **Expose MPC node endpoints**
   - Configure Docker networking
   - Expose MPC node endpoints (localhost:3000+)
   - Verify node accessibility

**Deliverables**:
- Docker compose file for MPC network
- Scripts to start/stop MPC nodes
- Configuration for v1.signer contract address
- Health check endpoints

### Phase 2: v1.signer Contract Integration

**Goal**: Replace mock address derivation with real contract calls

**Steps**:

1. **Replace AddressDerivation with contract calls**
   - Remove hash-based derivation
   - Add NEAR RPC client connection
   - Implement contract call wrapper

2. **Implement public_key method calls**
   ```typescript
   async deriveAddress(nearAccount: string, chain: SupportedChain) {
     const account = await this.near.account(this.mpcContractId);
     const result = await account.viewFunction({
       contractId: this.mpcContractId,
       methodName: 'public_key',
       args: { path: `${nearAccount},${chain}` }
     });
     
     // Convert MPC-derived public key to chain address
     return this.publicKeyToAddress(result.public_key, chain);
   }
   ```

3. **Implement sign method calls**
   - Create signature request structure
   - Call v1.signer contract `sign` method
   - Wait for MPC network to process
   - Retrieve signature from contract

4. **Add proper error handling**
   - Handle contract call failures
   - Handle MPC network failures
   - Add retry logic for transient errors
   - Add timeout handling

**Deliverables**:
- Real contract integration code
- Error handling and retry logic
- Address conversion utilities
- Integration tests

### Phase 3: AWS Node Runner Integration

**Goal**: Integrate NEAR node deployment from AWS Node Runner

**Steps**:

1. **Import NEAR CDK stack**
   - Add aws-blockchain-node-runners as dependency
   - Import NearNodeStack from lib/near
   - Set up CDK app structure

2. **Get RPC endpoint configuration**
   - Deploy NEAR node stack
   - Retrieve RPC URL from stack outputs
   - Store configuration for export

3. **Create LocalnetOrchestrator class**
   ```typescript
   export class LocalnetOrchestrator {
     async start(): Promise<LocalnetConfig> {
       // Deploy NEAR node via CDK
       // Start MPC network
       // Wait for services to be ready
       // Return configuration
     }
     
     async stop(): Promise<void> {
       // Stop MPC network
       // Stop NEAR node
     }
   }
   ```

4. **Add start/stop scripts**
   - Create `src/localnet/start.ts`
   - Create `src/localnet/stop.ts`
   - Add npm scripts to package.json
   - Add proper error handling

**Deliverables**:
- CDK stack integration
- LocalnetOrchestrator class
- npm run start:localnet script
- npm run stop:localnet script

### Phase 4: Remove Mocks

**Goal**: Delete all mock implementations and update dependencies

**Steps**:

1. **Delete MockMPCService**
   - Remove `src/chain-signatures/mock-mpc.ts`
   - Update imports in simulator.ts
   - Replace with real MPC service

2. **Delete mock AddressDerivation**
   - Remove hash-based derivation
   - Keep only address conversion utilities
   - Update imports

3. **Update all imports**
   - Update simulator.ts to use real implementations
   - Update factory.ts if needed
   - Remove any mock references

4. **Add integration tests**
   - Test real MPC node connection
   - Test v1.signer contract calls
   - Test end-to-end signature flow
   - Test error scenarios

**Deliverables**:
- Mock code removed
- Real implementations integrated
- Integration test suite
- Updated documentation

## Testing Strategy

### Unit Tests

- **Real Contract Calls**: Test v1.signer contract integration with real localnet
- **MPC Integration**: Test MPC node communication (not mocks)
- **Address Conversion**: Test public key to address conversion
- **Error Handling**: Test error scenarios and retries

### Integration Tests

- **Full MPC Network**: Test with 3-8 real MPC nodes
- **Contract Interaction**: Test signature request flow end-to-end
- **Infrastructure**: Test NEAR node + MPC network together
- **Configuration**: Test LocalnetConfig exports

### End-to-End Tests

- **With Near Intents Simulator**: Test full integration
- **Cross-Chain Flows**: Test address derivation and signing
- **Error Recovery**: Test failure scenarios and recovery
- **Performance**: Test signature generation timing

## File Structure After Implementation

```
cross-chain-simulator/
├── src/
│   ├── chain-signatures/
│   │   ├── simulator.ts          # Real MPC integration
│   │   ├── mpc-service.ts        # Real MPC service (replaces mock-mpc.ts)
│   │   └── contract-client.ts     # v1.signer contract client
│   ├── localnet/
│   │   ├── orchestrator.ts        # Infrastructure orchestration
│   │   ├── config.ts              # LocalnetConfig exports
│   │   ├── start.ts               # Start script
│   │   └── stop.ts                # Stop script
│   ├── types.ts
│   ├── config.ts
│   ├── factory.ts
│   └── index.ts
├── deployment/
│   ├── docker-compose.mpc.yml     # MPC network deployment
│   └── cdk/
│       └── cross-chain-stack.ts   # CDK stack integration
├── ARCHITECTURE.md
├── IMPLEMENTATION_GUIDE.md
└── README.md
```

## Dependencies to Add

```json
{
  "dependencies": {
    "near-api-js": "^2.x.x",              // For v1.signer contract calls
    "aws-blockchain-node-runners": "...",  // For NEAR node deployment
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@aws-cdk/core": "^2.x.x",            // For CDK integration
    "@aws-cdk/aws-ec2": "^2.x.x",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.7",
    "typescript": "^5.3.3"
  }
}
```

## Success Criteria

- [ ] Real MPC nodes deployed and running
- [ ] v1.signer contract deployed and accessible
- [ ] Address derivation uses real contract calls
- [ ] Signature generation uses real MPC network
- [ ] AWS Node Runner integrated
- [ ] LocalnetConfig exports working
- [ ] Infrastructure scripts functional
- [ ] All mocks removed
- [ ] Integration tests passing
- [ ] Documentation updated

## References

- [NEAR MPC Repository](https://github.com/near/mpc) - MPC node implementation
- [AWS Blockchain Node Runners](https://github.com/shaiss/aws-blockchain-node-runners) - NEAR node deployment
- [NEAR Chain Signatures Docs](https://docs.near.org/concepts/abstraction/chain-signatures) - Protocol documentation
- [NEAR API JS](https://github.com/near/near-api-js) - NEAR RPC client library

