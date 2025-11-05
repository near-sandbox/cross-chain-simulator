#!/bin/bash
# Stop MPC Network
# This script stops the MPC nodes using Docker Compose

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/deployment/docker-compose.mpc.yml"

echo "🛑 Stopping NEAR MPC Network..."

# Use docker compose (v2) if available, otherwise docker-compose (v1)
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

cd "$PROJECT_ROOT"

# Stop and remove containers
$COMPOSE_CMD -f "$COMPOSE_FILE" down

echo "✅ MPC Network stopped"

