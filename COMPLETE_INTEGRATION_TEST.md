# Complete Integration Test - Final Steps

## Status: ✅ Account Creation Resolved, Ready for Deployment

### Completed Steps

1. ✅ **Account Creation Issue Resolved**
   - Root cause: Dots in sub-account name (`v1.signer.node0`)
   - Solution: Changed to `v1-signer.node0` (hyphen instead of dot)
   - Verified: Account creation works successfully

2. ✅ **Contract WASM Downloaded**
   - Source: `github.com/near/mpc` repository archive
   - File: `contracts/v1.signer.wasm` (1.1MB)
   - Version: `signer-3_0_2.wasm`

### Remaining Steps

To complete the full integration test, you need to:

## Step 1: Start SSM Port Forwarding

**In Terminal 1** (keep this running):
```bash
export AWS_PROFILE=shai-sandbox-profile

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name near-localnet-infrastructure \
  --profile shai-sandbox-profile \
  --query "Stacks[0].Outputs[?OutputKey=='nearinstanceid'].OutputValue" \
  --output text)

aws ssm start-session \
  --target $INSTANCE_ID \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3030"],"localPortNumber":["3030"]}' \
  --profile shai-sandbox-profile
```

## Step 2: Run Full Integration Test

**In Terminal 2**:
```bash
cd cross-chain-simulator
export AWS_PROFILE=shai-sandbox-profile
export NEAR_RPC_URL=http://localhost:3030
export DEPLOYER_KMS_KEY_ID=1054ea40-042a-458f-9e91-e3efb8edfb01
export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:3D4YudUQRE39Lc4JHghuB5WM8kbgDDa34mnrEP5DdTApVH81af7e2dWgNPEaiQfdJnZq1CNPp5im4Rg5b733oiMP"
export MASTER_ACCOUNT_ID="node0"
export MPC_CONTRACT_ID="v1-signer.node0"

npm run build
npm run start:localnet
```

## Expected Results

The orchestrator should:
1. ✅ Connect to NEAR RPC via port forwarding
2. ✅ Initialize master account (`node0`)
3. ✅ Create/verify deployer account (`deployer.node0`)
4. ✅ Create contract account (`v1-signer.node0`)
5. ✅ Deploy contract WASM to account
6. ✅ Start MPC nodes (3-node network)
7. ✅ Verify all services are ready

## Success Output

```
╔════════════════════════════════════════════════════════════╗
║     ✅ FULL INTEGRATION TEST COMPLETE - SUCCESS!          ║
╚════════════════════════════════════════════════════════════╝

Summary:
  ✅ RPC connectivity verified
  ✅ Master account initialized
  ✅ Contract account created
  ✅ Contract deployed: v1-signer.node0
  ✅ MPC nodes started: http://localhost:3000, http://localhost:3001, http://localhost:3002

🎉 cross-chain-simulator is FULLY FUNCTIONAL on localnet!
✅ Ready to build other simulators on top!
```

## Troubleshooting

### Port Forwarding Issues

If port forwarding fails:
1. Check instance is running: `aws ec2 describe-instances --instance-ids $INSTANCE_ID`
2. Verify SSM agent is running on instance
3. Check security group allows port 3030

### Contract Deployment Issues

If contract deployment fails:
1. Verify WASM file exists: `ls -lh contracts/v1.signer.wasm`
2. Check account has sufficient balance
3. Verify contract account was created: `curl -X POST http://localhost:3030 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":"test","method":"query","params":{"request_type":"view_account","finality":"final","account_id":"v1-signer.node0"}}'`

### MPC Node Startup Issues

If MPC nodes fail to start:
1. Check Docker is running: `docker ps`
2. Verify ports 3000-3002 are available
3. Check MPC node logs: `docker logs mpc-node-0`

## Next Steps After Success

Once the full integration test passes:

1. ✅ **Documentation**: Update README with working setup instructions
2. ✅ **Automation**: Create scripts for easy localnet setup
3. ✅ **Other Simulators**: Proceed with building:
   - `near-intents-simulator`
   - `shade-agents-simulator`
   - Other simulators as needed

## Files Modified

- `src/config.ts`: Changed default contract ID to `v1-signer.node0`
- `src/localnet/contract-deployer.ts`: Improved account creation logic
- `contracts/download-wasm.sh`: Updated to use pre-built WASM from archive
- `contracts/v1.signer.wasm`: Downloaded from MPC repository

## Integration Status

**✅ VERIFIED AND WORKING:**
- AWSNodeRunner exports RPC URL correctly
- cross-chain-simulator reads configuration
- Account creation works (with fixed naming)
- Contract WASM downloaded and ready
- All components ready for deployment

**⏳ PENDING:**
- Full end-to-end test (requires port forwarding in separate terminal)
- MPC node startup verification
- End-to-end Chain Signatures functionality test

