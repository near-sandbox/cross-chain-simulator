#!/bin/bash
set -e

# Check MPC Node Status
# This script checks if MPC nodes are synced and ready for signing

echo "🔍 Checking MPC Node Status"
echo "================================"

# Configuration from deployment state
NEAR_RPC="http://10.0.55.70:3030"
MPC_NODE_0="i-0f765de002761e3be"
MPC_NODE_1="i-0bfee76f879a54a93"
MPC_NODE_2="i-06f52551814a61615"
CONTRACT_ID="v1.signer.node0"
PROFILE="shai-sandbox-profile"

echo ""
echo "📡 Checking NEAR Base RPC..."
NEAR_STATUS=$(curl -s -X POST "$NEAR_RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"status","id":"dontcare"}' | jq -r '.result.sync_info.syncing')

if [ "$NEAR_STATUS" = "false" ]; then
  echo "✅ NEAR Base is synced"
  NEAR_HEIGHT=$(curl -s -X POST "$NEAR_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"status","id":"dontcare"}' | jq -r '.result.sync_info.latest_block_height')
  echo "   Block height: $NEAR_HEIGHT"
else
  echo "⚠️  NEAR Base is still syncing"
fi

echo ""
echo "📋 Checking v1.signer contract..."
CONTRACT_CHECK=$(curl -s -X POST "$NEAR_RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"account_id\":\"$CONTRACT_ID\",\"finality\":\"final\"},\"id\":\"dontcare\"}")

if echo "$CONTRACT_CHECK" | jq -e '.result.code_hash' > /dev/null 2>&1; then
  CODE_HASH=$(echo "$CONTRACT_CHECK" | jq -r '.result.code_hash')
  echo "✅ Contract deployed: $CONTRACT_ID"
  echo "   Code hash: $CODE_HASH"
else
  echo "❌ Contract not found: $CONTRACT_ID"
  echo "   Response: $CONTRACT_CHECK"
fi

echo ""
echo "🖥️  Checking MPC Node Instances..."

# Function to check MPC node via SSM
check_mpc_node() {
  local NODE_ID=$1
  local NODE_NUM=$2
  
  echo ""
  echo "Node $NODE_NUM ($NODE_ID):"
  
  # Check instance state
  INSTANCE_STATE=$(aws ec2 describe-instances \
    --instance-ids "$NODE_ID" \
    --profile "$PROFILE" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text)
  
  echo "  Instance state: $INSTANCE_STATE"
  
  if [ "$INSTANCE_STATE" != "running" ]; then
    echo "  ❌ Instance not running"
    return
  fi
  
  # Get private IP
  PRIVATE_IP=$(aws ec2 describe-instances \
    --instance-ids "$NODE_ID" \
    --profile "$PROFILE" \
    --query 'Reservations[0].Instances[0].PrivateIpAddress' \
    --output text)
  
  echo "  Private IP: $PRIVATE_IP"
  
  # Try to check NEAR node status on MPC instance
  echo "  Checking NEAR node sync status..."
  
  # Create a temporary script to run via SSM
  TEMP_SCRIPT=$(mktemp)
  cat > "$TEMP_SCRIPT" << 'EOF'
#!/bin/bash
# Check if NEAR node is running
if pgrep -f neard > /dev/null; then
  echo "NEAR_RUNNING=true"
  # Get sync status
  SYNC_STATUS=$(curl -s http://localhost:3030/status 2>/dev/null | jq -r '.sync_info.syncing // "unknown"')
  BLOCK_HEIGHT=$(curl -s http://localhost:3030/status 2>/dev/null | jq -r '.sync_info.latest_block_height // "unknown"')
  echo "SYNC_STATUS=$SYNC_STATUS"
  echo "BLOCK_HEIGHT=$BLOCK_HEIGHT"
else
  echo "NEAR_RUNNING=false"
fi

# Check if MPC service is running
if pgrep -f mpc-node > /dev/null; then
  echo "MPC_RUNNING=true"
else
  echo "MPC_RUNNING=false"
fi

# Check MPC logs for errors (last 20 lines)
if [ -f /var/log/mpc-node.log ]; then
  echo "MPC_LOG_TAIL:"
  tail -20 /var/log/mpc-node.log | grep -i "error\|warn\|contract\|sync" || echo "No relevant log entries"
fi
EOF

  # Execute via SSM (with timeout)
  echo "  Running diagnostics via SSM..."
  aws ssm send-command \
    --instance-ids "$NODE_ID" \
    --profile "$PROFILE" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[\"$(cat $TEMP_SCRIPT)\"]" \
    --output text \
    --query 'Command.CommandId' > /tmp/ssm_command_id_$NODE_NUM.txt 2>&1 || {
      echo "  ⚠️  SSM command failed (may need to check manually)"
    }
  
  rm "$TEMP_SCRIPT"
}

# Check all MPC nodes
check_mpc_node "$MPC_NODE_0" "0"
check_mpc_node "$MPC_NODE_1" "1"
check_mpc_node "$MPC_NODE_2" "2"

echo ""
echo "================================"
echo "📊 Summary"
echo "================================"
echo ""
echo "To get SSM command results, run:"
echo ""
for i in 0 1 2; do
  if [ -f "/tmp/ssm_command_id_$i.txt" ]; then
    CMD_ID=$(cat "/tmp/ssm_command_id_$i.txt")
    echo "# Node $i:"
    echo "aws ssm get-command-invocation \\"
    echo "  --command-id \"$CMD_ID\" \\"
    echo "  --instance-id \"\$(cat /tmp/ssm_command_id_$i.txt | grep -oE 'i-[a-f0-9]+')\" \\"
    echo "  --profile $PROFILE \\"
    echo "  --query 'StandardOutputContent' \\"
    echo "  --output text"
    echo ""
  fi
done

echo ""
echo "Or manually SSH into nodes:"
echo "aws ssm start-session --target $MPC_NODE_0 --profile $PROFILE"
echo "aws ssm start-session --target $MPC_NODE_1 --profile $PROFILE"
echo "aws ssm start-session --target $MPC_NODE_2 --profile $PROFILE"
echo ""
echo "Once connected, check:"
echo "  sudo journalctl -u mpc-node -n 100"
echo "  curl http://localhost:3030/status | jq '.sync_info'"
echo "  ps aux | grep -E 'neard|mpc-node'"

