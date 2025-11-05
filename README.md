# cross-chain-simulator

NEAR Chain Signatures with **real MPC integration** for localnet development. Provides production-equivalent Chain Signatures infrastructure for testing and development.

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

**CRITICAL**: This module is **~20% complete**. Current implementation uses **MOCKS** which is **INCORRECT** for the intended architecture.

### What Needs to be Implemented:

1. **Replace MockMPCService** with real MPC node integration from github.com/near/mpc
2. **Add v1.signer contract integration** - Replace deterministic derivation with real contract calls
3. **Deploy real MPC network** - Use Docker to deploy 3-8 MPC nodes
4. **Add AWS Node Runner dependency** - Import NEAR node CDK stack
5. **Create LocalnetConfig exports** - Export configuration for consumers
6. **Add infrastructure orchestration scripts** - `start:localnet` and `stop:localnet`

### Current Mock Components (To Be Replaced):

- `MockMPCService` - Temporary placeholder, must be replaced with real MPC
- `AddressDerivation` - Mock deterministic derivation, must call v1.signer contract

See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for detailed implementation steps.

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Tests (to be implemented)
npm test
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Complete architecture overview
- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Step-by-step implementation plan

## References

- [NEAR MPC Repository](https://github.com/near/mpc) - Real MPC node implementation
- [AWS Blockchain Node Runners](https://github.com/shaiss/aws-blockchain-node-runners) - NEAR node deployment
- [NEAR Chain Signatures Docs](https://docs.near.org/concepts/abstraction/chain-signatures) - Protocol documentation

## License

MIT
