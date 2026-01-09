#!/bin/bash
# NEAR Base Restart Script
# Restarts nearup process on NEAR Base EC2 instance
# Can be called via SSM or locally
# Usage: restart-near-base.sh

set -eo pipefail

echo "=== NEAR Base Restart Started ==="
date

# Stop existing nearup process
echo "=== Stopping NEAR localnet ==="
su - ubuntu -c "nearup stop" || echo "Stop command completed (process may not have been running)"

# Brief pause to ensure clean shutdown
sleep 5

# Start nearup again
echo "=== Starting NEAR localnet ==="
su - ubuntu -c "nearup run localnet --binary-path ~/nearcore/target/release" &

# Wait for startup
sleep 10

# Verify the process is running
echo "=== Verifying startup ==="
if pgrep -f "nearup run localnet" > /dev/null; then
  echo "✅ nearup process is running"
else
  echo "❌ nearup process not found"
  exit 1
fi

# Check RPC endpoint
echo "=== Checking RPC endpoint ==="
RPC_STATUS=$(curl -s http://127.0.0.1:3030/status | jq -r '.sync_info.syncing' 2>/dev/null || echo "rpc_not_ready")
if [ "$RPC_STATUS" = "false" ]; then
  echo "✅ RPC endpoint is responding and synced"
elif [ "$RPC_STATUS" = "true" ]; then
  echo "⚠️  RPC endpoint responding but still syncing"
else
  echo "❌ RPC endpoint not ready yet"
fi

# Show current block height
curl -s http://127.0.0.1:3030/status | jq "{latest_block_height: .sync_info.latest_block_height, syncing: .sync_info.syncing}" || echo "Could not get block height"

echo "=== NEAR Base Restart Complete ==="
date