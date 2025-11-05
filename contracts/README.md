# Contract WASM Files

This directory contains the v1.signer contract WASM binary.

## Obtaining the Contract WASM

### Option 1: Download Script (Recommended)

```bash
./contracts/download-wasm.sh
```

This script attempts to:
1. Download from testnet contract (`v1.signer-prod.testnet`)
2. Build from github.com/near/mpc source
3. Use existing WASM if available

### Option 2: Build from Source

```bash
# Clone MPC repository
git clone https://github.com/near/mpc.git
cd mpc/contract  # or wherever the contract source is located

# Build contract
cargo build --release --target wasm32-unknown-unknown

# Copy WASM to contracts directory
cp target/wasm32-unknown-unknown/release/*.wasm ../../cross-chain-simulator/contracts/v1.signer.wasm
```

### Option 3: Download from Testnet

If you have NEAR CLI installed:

```bash
# Extract WASM from testnet contract
near view-state v1.signer-prod.testnet --finality final --utf8 false
# Then extract and save the code hash or download via explorer
```

## Contract Naming

- **Mainnet**: `v1.signer`
- **Testnet**: `v1.signer-prod.testnet`
- **Localnet**: `v1.signer.node0`

## References

- [NEAR MPC Repository](https://github.com/near/mpc)
- [NEAR Contract Deployment](https://docs.near.org/develop/contracts/introduction)

