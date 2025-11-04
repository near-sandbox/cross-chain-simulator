# cross-chain-simulator

NEAR Chain Signatures (MPC) + cross-chain simulator for localnet development. Provides production-shaped interfaces for address derivation and cross-chain transaction simulation.

## Installation

```bash
npm install @telco/cross-chain-simulator
```

## Usage

```typescript
import { ChainSignaturesSimulator, createChainSignaturesClient } from '@telco/cross-chain-simulator';

// Address derivation
const chainSigs = createChainSignaturesClient();
const btcAddr = await chainSigs.deriveAddress('user.near', 'bitcoin');
console.log('Bitcoin:', btcAddr.address);

// Signature creation
const sig = await chainSigs.requestSignature({
  nearAccount: 'user.near',
  chain: 'ethereum',
  payload: '0x...'
});
```

## Supported Chains

- Bitcoin
- Ethereum
- Dogecoin
- Ripple
- Polygon
- Arbitrum
- Optimism

## Features

- Deterministic address derivation
- Mock MPC signature generation
- Cross-chain transaction simulation
- Fee estimation
