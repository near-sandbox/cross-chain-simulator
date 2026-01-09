#!/bin/bash
# MPC Node Reset Script
# Resets NEAR chain state and MPC keyshares while preserving secrets
# Can be called from UserData during instance boot or via SSM for running instances
# Usage: reset-mpc-node.sh [GENESIS_S3_URL] [IMAGE_URI] [CHAIN_ID] [NEAR_BOOT_NODES]
#
# CRITICAL: MPC Secrets Management
# --------------------------------
# MPC containers require three secrets from AWS Secrets Manager:
#   - mpc-node-{i}-mpc_account_sk
#   - mpc-node-{i}-mpc_p2p_private_key
#   - mpc-node-{i}-mpc_secret_store_key
#
# These secrets are ONLY set during CDK UserData execution on first boot.
# When running via SSM, we MUST fetch them from Secrets Manager before starting
# the container. Simply referencing $MPC_ACCOUNT_SK etc. will fail because
# those environment variables are undefined in the SSM session context.
#
# This script automatically fetches secrets from Secrets Manager based on
# the node index extracted from /data/config.yaml.

set -exo pipefail

echo "=== MPC Node Reset Started ==="
date

# Arguments with defaults
GENESIS_S3_URL="${1:-$GENESIS_S3_URL}"
IMAGE_URI="${2:-$IMAGE_URI}"
CHAIN_ID="${3:-$CHAIN_ID}"
NEAR_BOOT_NODES="${4:-$NEAR_BOOT_NODES}"

# Default to Connected Localnet values if not provided
if [ -z "$CHAIN_ID" ]; then
  CHAIN_ID="localnet"
fi

# Get AWS region from instance metadata
AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

echo "Configuration:"
echo "  GENESIS_S3_URL: $GENESIS_S3_URL"
echo "  IMAGE_URI: $IMAGE_URI"
echo "  CHAIN_ID: $CHAIN_ID"
echo "  NEAR_BOOT_NODES: $NEAR_BOOT_NODES"
echo "  AWS_REGION: $AWS_REGION"

# Stop the Docker container
echo "=== Stopping MPC container ==="
docker stop mpc-node || true
docker rm mpc-node || true

# Create backup directory for essential files
mkdir -p /tmp/mpc-reset-backup

# Backup essential config files (will be restored after wipe)
if [ -f /data/config.yaml ]; then
  cp /data/config.yaml /tmp/mpc-reset-backup/
  echo "Backed up config.yaml"
fi

if [ -f /data/secrets.json ]; then
  cp /data/secrets.json /tmp/mpc-reset-backup/
  echo "Backed up secrets.json"
fi

# Wipe NEAR chain state and MPC keyshares (preserve logs for debugging)
echo "=== Wiping NEAR chain state and MPC keyshares ==="
rm -rf /data/data /data/config.json /data/node_key.json /data/validator_key.json
rm -rf /data/permanent_keys /data/temporary_keys
# Also remove encryption keys that may be tied to old state
rm -f /data/backup_encryption_key.hex

# Download genesis from S3 if URL provided (Connected Localnet mode)
if [ -n "$GENESIS_S3_URL" ]; then
  echo "=== Downloading genesis from S3 ==="
  aws s3 cp "$GENESIS_S3_URL" /data/genesis.json --region "$AWS_REGION"

  # Verify download
  if [ ! -f /data/genesis.json ]; then
    echo "ERROR: Failed to download genesis from S3: $GENESIS_S3_URL"
    exit 1
  fi

  GENESIS_SIZE=$(wc -c < /data/genesis.json)
  echo "✅ Genesis downloaded: $GENESIS_SIZE bytes"
fi

# Restore essential config files
if [ -f /tmp/mpc-reset-backup/config.yaml ]; then
  cp /tmp/mpc-reset-backup/config.yaml /data/
  echo "Restored config.yaml"
fi

if [ -f /tmp/mpc-reset-backup/secrets.json ]; then
  cp /tmp/mpc-reset-backup/secrets.json /data/
  echo "Restored secrets.json"
fi

# Reinitialize nearcore config if we have genesis and boot nodes
if [ -f /data/genesis.json ] && [ -n "$NEAR_BOOT_NODES" ]; then
  echo "=== Reinitializing nearcore config ==="

  # Get chain ID from genesis if not provided
  if [ -z "$CHAIN_ID" ] || [ "$CHAIN_ID" = "localnet" ]; then
    CHAIN_ID=$(cat /data/genesis.json | jq -r '.chain_id')
  fi
  echo "Chain ID: $CHAIN_ID"

  # Preserve original genesis for init
  cp /data/genesis.json /data/genesis.original.json

  # Clean any previously-written minimal/invalid config
  rm -f /data/config.json /data/validator_key.json || true

  # Use the binary directly for init to avoid start.sh logic
  docker run --rm --net=host -v /data:/data --entrypoint /app/mpc-node ${IMAGE_URI} \
    init --dir /data --chain-id "${CHAIN_ID}" --genesis /data/genesis.original.json --boot-nodes "${NEAR_BOOT_NODES}"

  # Remove validator key (MPC nodes are NOT validators)
  rm -f /data/validator_key.json || true

  echo "✅ Near config.json reinitialized"

  # Force state_sync_enabled=true for Connected Localnet
  # This overwrites default init behavior which might default to false or try to download
  # Also set tracked_shards to AllShards for testing stability
  if [ -f /data/config.json ]; then
    cp /data/config.json /data/config.json.bak
    jq '.state_sync_enabled=true | .tracked_shards_config="AllShards" | .store.load_mem_tries_for_tracked_shards=false' /data/config.json.bak > /data/config.json
    echo "✅ Forced state_sync_enabled=true in config.json"
  fi
else
  echo "=== Skipping nearcore init (no genesis or boot nodes) ==="
fi

# Clean up backup
rm -rf /tmp/mpc-reset-backup

# Fetch secrets from AWS Secrets Manager if not already set
# Determine node index from hostname or config
echo "=== Fetching secrets from AWS Secrets Manager ==="
NODE_INDEX="${NODE_INDEX:-0}"
if [ -f /data/config.yaml ]; then
  # Try to extract node index from account_id in config.yaml
  ACCOUNT_ID=$(grep 'account_id' /data/config.yaml | head -1 | sed 's/.*mpc-node-\([0-9]\).*/\1/' || echo "")
  if [ -n "$ACCOUNT_ID" ]; then
    NODE_INDEX="$ACCOUNT_ID"
  fi
fi
echo "Node index: $NODE_INDEX"

# Fetch secrets if not already in environment
if [ -z "$MPC_ACCOUNT_SK" ]; then
  MPC_ACCOUNT_SK=$(aws secretsmanager get-secret-value --secret-id "mpc-node-${NODE_INDEX}-mpc_account_sk" --region "$AWS_REGION" --query SecretString --output text 2>/dev/null | tr -d '\n' || echo "")
fi
if [ -z "$MPC_P2P_PRIVATE_KEY" ]; then
  MPC_P2P_PRIVATE_KEY=$(aws secretsmanager get-secret-value --secret-id "mpc-node-${NODE_INDEX}-mpc_p2p_private_key" --region "$AWS_REGION" --query SecretString --output text 2>/dev/null | tr -d '\n' || echo "")
fi
if [ -z "$MPC_SECRET_STORE_KEY" ]; then
  MPC_SECRET_STORE_KEY=$(aws secretsmanager get-secret-value --secret-id "mpc-node-${NODE_INDEX}-mpc_secret_store_key" --region "$AWS_REGION" --query SecretString --output text 2>/dev/null | tr -d '\n' || echo "")
fi

# Validate secrets
if [ -z "$MPC_ACCOUNT_SK" ] || [ -z "$MPC_P2P_PRIVATE_KEY" ] || [ -z "$MPC_SECRET_STORE_KEY" ]; then
  echo "ERROR: Failed to fetch MPC secrets from Secrets Manager"
  echo "  MPC_ACCOUNT_SK: ${MPC_ACCOUNT_SK:+set}"
  echo "  MPC_P2P_PRIVATE_KEY: ${MPC_P2P_PRIVATE_KEY:+set}"
  echo "  MPC_SECRET_STORE_KEY: ${MPC_SECRET_STORE_KEY:+set}"
  exit 1
fi
echo "✅ Secrets fetched successfully"

# Restart the Docker container with proper environment variables
echo "=== Restarting MPC container ==="
# Note: For Connected Localnet mode, we need to pass environment variables
# that would normally be set by /app/start.sh
docker run -d --name mpc-node --restart=always --net=host \
  -v /data:/data \
  -e MPC_HOME_DIR="/data" \
  -e MPC_ACCOUNT_SK="$MPC_ACCOUNT_SK" \
  -e MPC_P2P_PRIVATE_KEY="$MPC_P2P_PRIVATE_KEY" \
  -e MPC_SECRET_STORE_KEY="$MPC_SECRET_STORE_KEY" \
  -e RUST_BACKTRACE="full" \
  -e RUST_LOG="mpc=debug,info" \
  --entrypoint /app/mpc-node \
  ${IMAGE_URI:-nearone/mpc-node:3.2.0} start local

echo "=== MPC Node Reset Complete ==="
date

# Show container status
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep mpc-node || echo "Container not running yet"

echo "=== Next steps ==="
echo "1. Wait for MPC node to sync (check logs with: docker logs mpc-node --tail 20)"
echo "2. Verify keygen starts (contract should be in 'Running' state)"
echo "3. Run parity tests to confirm signing works"