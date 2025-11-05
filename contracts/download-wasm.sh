#!/bin/bash
# Download v1.signer contract WASM
# 
# This script attempts to download the v1.signer contract WASM from various sources:
# 1. Download from testnet contract (v1.signer-prod.testnet)
# 2. Build from github.com/near/mpc source
# 3. Use pre-built WASM if available

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_FILE="$SCRIPT_DIR/v1.signer.wasm"

echo "📦 Downloading v1.signer contract WASM..."

# Option 1: Try to download from testnet
echo "Attempting to download from testnet..."
if command -v near &> /dev/null; then
    if near view-state v1.signer-prod.testnet --finality final --utf8 false > /dev/null 2>&1; then
        echo "✅ Found contract on testnet, downloading WASM..."
        # Note: Actual download command depends on NEAR CLI capabilities
        # This is a placeholder
        echo "⚠️  NEAR CLI download not implemented yet"
    fi
fi

# Option 2: Try to build from source
echo "Attempting to build from source..."
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

if git clone --depth 1 https://github.com/near/mpc.git 2>/dev/null; then
    echo "✅ Cloned MPC repository"
    cd mpc
    
    # Look for contract directory
    if [ -d "contract" ]; then
        cd contract
        echo "Building contract..."
        if cargo build --release --target wasm32-unknown-unknown 2>/dev/null; then
            CONTRACT_WASM=$(find target/wasm32-unknown-unknown/release -name "*.wasm" | head -1)
            if [ -n "$CONTRACT_WASM" ]; then
                cp "$CONTRACT_WASM" "$WASM_FILE"
                echo "✅ Built and copied WASM to $WASM_FILE"
                rm -rf "$TEMP_DIR"
                exit 0
            fi
        fi
    fi
fi

rm -rf "$TEMP_DIR"

# Option 3: Check if WASM already exists
if [ -f "$WASM_FILE" ]; then
    echo "✅ WASM file already exists: $WASM_FILE"
    exit 0
fi

echo "❌ Failed to obtain WASM file"
echo ""
echo "Manual steps:"
echo "1. Clone https://github.com/near/mpc"
echo "2. Build contract: cd mpc/contract && cargo build --release --target wasm32-unknown-unknown"
echo "3. Copy WASM to: $WASM_FILE"
exit 1

