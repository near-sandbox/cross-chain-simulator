#!/bin/bash
# Stop MPC infrastructure only (contracts persist on blockchain)
# EC2 NEAR node managed separately via /AWSNodeRunner/lib/near

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🛑 Stopping NEAR localnet infrastructure..."

# Stop MPC nodes
cd "$PROJECT_ROOT"
npm run stop:mpc

echo "✅ Infrastructure stopped"
echo "   Note: Contracts persist on blockchain"

