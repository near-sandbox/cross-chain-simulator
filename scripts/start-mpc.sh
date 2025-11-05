#!/bin/bash
# Start MPC Network for localnet development
# This script starts the MPC nodes using Docker Compose

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/deployment/docker-compose.mpc.yml"

echo "🚀 Starting NEAR MPC Network..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Error: docker-compose is not installed. Please install docker-compose and try again."
    exit 1
fi

# Use docker compose (v2) if available, otherwise docker-compose (v1)
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

# NEAR RPC URL Configuration
# Priority: NEAR_RPC_URL env var > default localhost
# See src/config.ts for single source of truth and EC2 instance option
NEAR_RPC_URL="${NEAR_RPC_URL:-http://localhost:3030}"

# For Docker containers, convert localhost to host.docker.internal
# If using EC2 instance, use the public IP directly
if [[ "$NEAR_RPC_URL" == *"localhost"* ]] || [[ "$NEAR_RPC_URL" == *"127.0.0.1"* ]]; then
    DOCKER_RPC_URL="${NEAR_RPC_URL/localhost/host.docker.internal}"
    DOCKER_RPC_URL="${DOCKER_RPC_URL/127.0.0.1/host.docker.internal}"
else
    # For EC2 or other remote endpoints, use as-is
    DOCKER_RPC_URL="$NEAR_RPC_URL"
fi

# Check if NEAR RPC is accessible (from host, not Docker network)
if ! curl -s "$NEAR_RPC_URL/health" > /dev/null 2>&1 && ! curl -s "$NEAR_RPC_URL" > /dev/null 2>&1; then
    echo "⚠️  Warning: NEAR RPC at $NEAR_RPC_URL may not be accessible."
    echo "   Make sure NEAR localnet is running before starting MPC nodes."
    echo "   To use EC2 instance: export NEAR_RPC_URL=http://54.90.246.254:3030"
fi

# Export environment variables for docker-compose
export NEAR_RPC_URL="$DOCKER_RPC_URL"
export MPC_CONTRACT_ID="${MPC_CONTRACT_ID:-v1.signer.node0}"

echo "📡 Using NEAR RPC: $NEAR_RPC_URL (for Docker containers)"

# Start MPC nodes
echo "📦 Starting MPC nodes..."
cd "$PROJECT_ROOT"
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d

# Wait for nodes to be ready
echo "⏳ Waiting for MPC nodes to be ready..."
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ MPC Node 0 is ready"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "⚠️  Warning: MPC nodes may not be fully ready. Check logs with: docker-compose -f $COMPOSE_FILE logs"
else
    echo "✅ All MPC nodes are ready!"
    echo ""
    echo "MPC Node Endpoints:"
    echo "  - Node 0: http://localhost:3000"
    echo "  - Node 1: http://localhost:3001"
    echo "  - Node 2: http://localhost:3002"
    echo ""
    echo "To view logs: $COMPOSE_CMD -f $COMPOSE_FILE logs -f"
    echo "To stop: npm run stop:mpc"
fi

