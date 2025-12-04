#!/bin/bash
# Build MPC Node Docker Image from source
# References: https://github.com/near/mpc

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Fix potential nested paths from previous runs
if [ -d "$PROJECT_ROOT/cross-chain-simulator/mpc-repo" ]; then
    MPC_REPO_DIR="$PROJECT_ROOT/cross-chain-simulator/mpc-repo"
elif [ -d "$PROJECT_ROOT/mpc-repo" ]; then
    MPC_REPO_DIR="$PROJECT_ROOT/mpc-repo"
else
    MPC_REPO_DIR="$PROJECT_ROOT/mpc-repo"
    echo "⬇️  Cloning near/mpc repository..."
    git clone https://github.com/near/mpc.git "$MPC_REPO_DIR"
fi

echo "🏗️  Building MPC Node Docker Image in $MPC_REPO_DIR..."
cd "$MPC_REPO_DIR"

if [ -d ".git" ]; then
    echo "🔄 Updating near/mpc repository..."
    git pull
fi

# Copy start.sh to root to ensure it's available in context
if [ -f "deployment/start.sh" ]; then
    cp deployment/start.sh ./start.sh
else
    echo "❌ Error: deployment/start.sh not found."
    exit 1
fi

# Create a multi-stage Dockerfile to build inside Linux
# This avoids cross-compilation issues (macOS -> Linux) and architecture mismatches
echo "📝 Creating multi-stage Dockerfile.local..."
cat > Dockerfile.local << 'DOCKERFILE'
# Build stage
FROM rust:1.81-slim-bookworm as builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    git \
    g++ \
    make \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . .

# Build binary
RUN cargo build --release --bin mpc-node

# Runtime stage
FROM debian:bookworm-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/mpc-node /app/mpc-node
# Copy start script (from local context where we copied it)
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Environment setup
ENV RUST_LOG=info
EXPOSE 3000
ENTRYPOINT ["/app/start.sh"]
DOCKERFILE

# Build Docker image
echo "🐳 Building Docker image (this may take a while)..."
docker build --no-cache -t near/mpc-node:latest -f Dockerfile.local .

echo "✅ MPC Node image built successfully: near/mpc-node:latest"
