#!/bin/bash
# Layer 3 Reset Script
# Orchestrates reset of MPC nodes and optionally NEAR Base
# Usage: reset-layer3.sh [--include-near-base]

set -eo pipefail

# Default settings
INCLUDE_NEAR_BASE=false
PROFILE="${AWS_PROFILE:-shai-sandbox-profile}"
REGION="${AWS_REGION:-us-east-1}"
NEAR_INFRA_STACK="near-localnet-infrastructure"
MPC_STACK="MpcStandaloneStack"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --include-near-base)
      INCLUDE_NEAR_BASE=true
      shift
      ;;
    --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    --region=*)
      REGION="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--include-near-base] [--profile=PROFILE] [--region=REGION]"
      exit 1
      ;;
  esac
done

echo "=== Layer 3 Reset Started ==="
echo "Include NEAR Base: $INCLUDE_NEAR_BASE"
echo "AWS Profile: $PROFILE"
echo "AWS Region: $REGION"
echo "NEAR Infra Stack: $NEAR_INFRA_STACK"
echo "MPC Stack: $MPC_STACK"
date

# Function to get CloudFormation output value
get_cf_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
    --output text
}

# Function to get multiple MPC node instance IDs
get_mpc_instances() {
  local instances=""
  for i in 0 1 2; do
    local instance_id
    instance_id=$(get_cf_output "$MPC_STACK" "Node${i}InstanceId")
    if [ "$instance_id" = "None" ] || [ -z "$instance_id" ]; then
      echo "ERROR: Could not find MPC Node $i instance ID" >&2
      exit 1
    fi
    instances="$instances $instance_id"
  done
  echo "$instances"
}

# Verify stacks exist and get infrastructure details
echo "=== Checking infrastructure ==="

if $INCLUDE_NEAR_BASE; then
  NEAR_INSTANCE=$(get_cf_output "$NEAR_INFRA_STACK" "near-instance-id")
  if [ "$NEAR_INSTANCE" = "None" ] || [ -z "$NEAR_INSTANCE" ]; then
    echo "ERROR: Could not find NEAR Base instance ID" >&2
    exit 1
  fi
  echo "✅ NEAR Base instance: $NEAR_INSTANCE"
fi

MPC_INSTANCES=$(get_mpc_instances)
echo "✅ MPC instances: $MPC_INSTANCES"

# Optionally restart NEAR Base
if $INCLUDE_NEAR_BASE; then
  echo "=== Restarting NEAR Base ==="
  aws ssm send-command \
    --instance-ids "$NEAR_INSTANCE" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[
      'echo === Stopping NEAR localnet ===',
      'su - ubuntu -c \"nearup stop\" || echo Stop command completed',
      'sleep 5',
      'echo === Starting NEAR localnet ===',
      'su - ubuntu -c \"nearup run localnet --binary-path ~/nearcore/target/release\" &',
      'sleep 10',
      'echo === Verifying startup ===',
      'curl -s http://127.0.0.1:3030/status | jq \"{latest_block_height: .sync_info.latest_block_height, syncing: .sync_info.syncing}\" || echo RPC not ready yet'
    ]" \
    --timeout-seconds 180 \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "Command.CommandId" \
    --output text

  echo "✅ NEAR Base restart command sent"
fi

# Reset MPC nodes
echo "=== Resetting MPC nodes ==="
COMMAND_ID=$(aws ssm send-command \
  --instance-ids $MPC_INSTANCES \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    'echo === MPC Node Reset Starting ===',
    'if [ -f /opt/mpc/reset-mpc-node.sh ]; then',
    '  /opt/mpc/reset-mpc-node.sh',
    'else',
    '  echo \"ERROR: Reset script not found at /opt/mpc/reset-mpc-node.sh\" >&2',
    '  exit 1',
    'fi'
  ]" \
  --timeout-seconds 600 \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query "Command.CommandId" \
  --output text)

echo "✅ MPC reset command sent: $COMMAND_ID"

# Wait for MPC reset to complete
echo "=== Waiting for MPC reset completion ==="
sleep 30

for instance in $MPC_INSTANCES; do
  echo "--- Checking MPC node $instance ---"
  aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$instance" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "[Status, StandardOutputContent, StandardErrorContent]" \
    --output json || echo "Command still running on $instance"
done

# Wait additional time for nodes to sync and start keygen
echo "=== Waiting for MPC nodes to sync (2 minutes) ==="
sleep 120

# Check contract state
echo "=== Checking contract state ==="
if $INCLUDE_NEAR_BASE; then
  CONTRACT_CHECK_CMD=$(aws ssm send-command \
    --instance-ids "$NEAR_INSTANCE" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[
      'echo === Contract State Check ===',
      'curl -s http://127.0.0.1:3030/status | jq \"{latest_block_height: .sync_info.latest_block_height}\"',
      'echo',
      'echo === Contract State ===',
      'RESULT=\$(curl -s http://127.0.0.1:3030 -H \"Content-Type: application/json\" -d \"{\\\\\"jsonrpc\\\\\":\\\\\"2.0\\\\\\\",\\\\\\\"method\\\\\\\":\\\\\\\"query\\\\\\\",\\\\\\\"params\\\\\\\":{\\\\\\\"request_type\\\\\\\":\\\\\\\"call_function\\\\\\\",\\\\\\\"finality\\\\\\\":\\\\\\\"final\\\\\\\",\\\\\\\"account_id\\\\\\\":\\\\\\\"v1.signer.localnet\\\\\\\",\\\\\\\"method_name\\\\\\\":\\\\\\\"state\\\\\\\",\\\\\\\"args_base64\\\\\\\":\\\\\\\"e30=\\\\\\\"},\\\\\\\"id\\\\\\\":1}\")',
      'echo \$RESULT | jq -r .result.result 2>/dev/null | python3 -c \"import sys,json; data=json.load(sys.stdin); print(\\\"Protocol State:\\\", data.get(\\\"protocol_state\\\", \\\"unknown\\\")); print(\\\"Generating Key Instance:\\\", data.get(\\\"generating_key\\\", {}).get(\\\"instance\\\", \\\"none\\\"))\" || echo \"Could not parse contract state\"'
    ]" \
    --timeout-seconds 60 \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "Command.CommandId" \
    --output text)

  echo "Contract check command sent: $CONTRACT_CHECK_CMD"

  # Wait and show result
  sleep 10
  aws ssm get-command-invocation \
    --command-id "$CONTRACT_CHECK_CMD" \
    --instance-id "$NEAR_INSTANCE" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "StandardOutputContent" \
    --output text
fi

echo "=== Layer 3 Reset Complete ==="
echo "Next steps:"
echo "1. Monitor MPC node logs: docker logs mpc-node --tail 20"
echo "2. Check for keygen activity in contract state"
echo "3. Run parity tests: npm run test-parity"
date