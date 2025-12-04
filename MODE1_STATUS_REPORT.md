# Mode 1 Deployment Status Report

**Date**: Current Session  
**Goal**: Test Mode 1 deployment with existing NEAR localnet node

## Current Status Summary

### ✅ Verified Working

1. **NEAR RPC Node**
   - ✅ Accessible at `http://54.90.246.254:3030`
   - ✅ Responding to status requests
   - ✅ Chain ID: `test-chain-jszNl`
   - ✅ Synced and running

2. **Code Implementation**
   - ✅ Orchestrator supports `masterAccountKeyArn`
   - ✅ `fetchKeyFromSecretsManager()` implemented
   - ✅ CDK stack grants Secrets Manager read permissions
   - ✅ Mode detection logic in `cdk/bin/app.ts`
   - ✅ All code compiles successfully

### ⚠️ Needs Verification (AWS Credentials Required)

Since AWS credentials aren't configured in this environment, you'll need to verify these yourself:

1. **AWS Stack State** (`CrossChainSimulatorStack`)
   - **Action**: Run verification script or AWS CLI commands
   - **Script**: `./scripts/verify-mode1-setup.sh`
   - **Manual**: `aws cloudformation describe-stacks --stack-name CrossChainSimulatorStack`

2. **Secrets Manager Secret**
   - **Action**: Check if master account key secret exists
   - **Script**: Included in verification script
   - **Manual**: `aws secretsmanager list-secrets --query 'SecretList[?contains(Name, `near`)]'`

3. **Stack Permissions**
   - **Action**: Verify IAM role has Secrets Manager permissions
   - **How**: Check IAM role policies attached to stack's EC2 role
   - **Note**: If stack was deployed before Secrets Manager integration, it needs redeploy

## Answers to Your Questions

### 1. Check Current AWS Stack State

**To Do:**
```bash
# Run the verification script
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator
./scripts/verify-mode1-setup.sh

# Or manually:
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' \
  --output json
```

**Expected Outcomes:**

**A. Stack doesn't exist:**
- ✅ **Action**: Deploy fresh stack (includes all Secrets Manager permissions)
- ✅ **Command**: `cdk deploy CrossChainSimulatorStack -c deployNearNode=false`

**B. Stack exists (deployed before Secrets Manager integration):**
- ⚠️ **Action**: Redeploy to add Secrets Manager permissions
- ⚠️ **Command**: `cdk deploy CrossChainSimulatorStack -c deployNearNode=false`
- ⚠️ **Why**: CDK stack was updated to grant Secrets Manager permissions, but existing stack doesn't have them

**C. Stack exists (recently deployed with Secrets Manager):**
- ✅ **Action**: No redeploy needed, just verify permissions
- ✅ **Check**: Verify IAM role has `secretsmanager:GetSecretValue` permission

### 2. Verify if Secrets Manager Secret Exists

**To Do:**
```bash
# List NEAR-related secrets
aws secretsmanager list-secrets \
  --region us-east-1 \
  --query 'SecretList[?contains(Name, `near`) || contains(Name, `master`) || contains(Name, `test.near`)].{Name:Name,ARN:ARN}' \
  --output table
```

**If Secret Doesn't Exist - Create It:**
```bash
# You'll need the test.near private key from your NEAR localnet node
aws secretsmanager create-secret \
  --name /near/localnet/master-account-key \
  --description "NEAR localnet master account (test.near) private key" \
  --secret-string '{"account":"test.near","privateKey":"ed25519:YOUR_KEY_HERE"}' \
  --region us-east-1

# Get the ARN
export MASTER_ACCOUNT_KEY_ARN=$(aws secretsmanager describe-secret \
  --name /near/localnet/master-account-key \
  --region us-east-1 \
  --query 'ARN' \
  --output text)
```

**Secret Format:**
```json
{
  "account": "test.near",
  "privateKey": "ed25519:..."
}
```

### 3. Determine if Stack Needs Redeploy

**Decision Flow:**

```
Does stack exist?
├─ NO → ✅ Deploy (includes Secrets Manager permissions)
└─ YES → Check IAM role permissions
    ├─ Has secretsmanager:GetSecretValue? → ✅ No redeploy needed
    └─ Missing permissions? → ⚠️ Redeploy to add permissions
```

**Check IAM Permissions:**
```bash
# Get role name from stack
ROLE_NAME=$(aws cloudformation describe-stack-resources \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'StackResources[?ResourceType==`AWS::IAM::Role`].PhysicalResourceId' \
  --output text | head -1)

# Check policies
aws iam list-attached-role-policies --role-name "$ROLE_NAME"
aws iam list-role-policies --role-name "$ROLE_NAME"
```

**Code Evidence:**

Looking at `cdk/cross-chain-simulator-stack.ts` lines 109-119:
```typescript
// Grant Secrets Manager read permission for master account key
if (props.masterAccountKeyArn) {
  const masterAccountSecret = secretsmanager.Secret.fromSecretCompleteArn(
    this,
    'MasterAccountSecret',
    props.masterAccountKeyArn
  );
  
  // Grant read access
  masterAccountSecret.grantRead(this.ec2Role);
}
```

**This code was added** to grant Secrets Manager permissions. If your stack was deployed before this code existed, it needs redeploy.

### 4. Guide Through Mode 1 Testing Steps

**Complete Testing Flow:**

See `MODE1_TESTING_GUIDE.md` for detailed step-by-step instructions.

**Quick Start:**
```bash
# 1. Verify setup
./scripts/verify-mode1-setup.sh

# 2. Set environment variables
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<your-secret-arn>
export AWS_REGION=us-east-1

# 3. Deploy/update stack
cdk deploy CrossChainSimulatorStack -c deployNearNode=false

# 4. Get KMS key ID from stack outputs
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

# 5. Test orchestrator
npm run start:localnet
```

## Recommended Next Steps

### Immediate Actions (Do These First)

1. **Run Verification Script**
   ```bash
   cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator
   ./scripts/verify-mode1-setup.sh
   ```
   This will check:
   - AWS credentials
   - NEAR RPC accessibility
   - Stack state
   - Secrets Manager secrets
   - IAM permissions

2. **Create Secrets Manager Secret** (if doesn't exist)
   - Get `test.near` private key from your NEAR localnet node
   - Create secret using command above
   - Save the ARN for next steps

3. **Decide on Stack Deployment**
   - If stack doesn't exist → Deploy
   - If stack exists but missing Secrets Manager permissions → Redeploy
   - If stack exists with permissions → Skip deploy, just set env vars

### Testing Sequence

1. ✅ **Pre-deployment checks** (verification script)
2. ✅ **Create/verify Secrets Manager secret**
3. ✅ **Deploy/update CDK stack** (if needed)
4. ✅ **Verify stack outputs**
5. ✅ **Test orchestrator** (`npm run start:localnet`)

## Files Created for You

1. **`scripts/verify-mode1-setup.sh`**
   - Automated verification script
   - Checks all prerequisites
   - Provides suggested commands

2. **`MODE1_TESTING_GUIDE.md`**
   - Complete step-by-step guide
   - Troubleshooting section
   - Decision matrix for redeploy

3. **`MODE1_STATUS_REPORT.md`** (this file)
   - Summary of current status
   - Answers to your questions
   - Next steps

## Key Code References

- **CDK Stack**: `cdk/cross-chain-simulator-stack.ts` (lines 109-119 for Secrets Manager grant)
- **Orchestrator**: `src/localnet/orchestrator.ts` (lines 201-250 for Secrets Manager fetch)
- **Config**: `src/config.ts` (line 117 for `getMasterAccountKeyArn()`)
- **CDK App**: `cdk/bin/app.ts` (Mode 1 detection logic)

## Expected Orchestrator Flow

When you run `npm run start:localnet`, you should see:

```
🚀 [ORCHESTRATOR] Connecting to NEAR localnet and deploying infrastructure...
📡 [ORCHESTRATOR] Verifying RPC connection...
   ✅ RPC connection verified
🔑 [ORCHESTRATOR] Retrieving master account key...
   Using Secrets Manager ARN: arn:aws:secretsmanager:...
   ✅ Master account key retrieved from Secrets Manager
👤 [ORCHESTRATOR] Initializing master account...
🔑 [ORCHESTRATOR] Creating deployer account...
📦 [ORCHESTRATOR] Deploying v1.signer contract...
🔗 [ORCHESTRATOR] Starting MPC nodes...
⏳ [ORCHESTRATOR] Waiting for services to be ready...
✅ [ORCHESTRATOR] Infrastructure ready!
```

## Summary

**What We Know:**
- ✅ NEAR RPC is accessible
- ✅ Code is complete and ready
- ✅ CDK stack code includes Secrets Manager permissions

**What You Need to Verify:**
- ⚠️ AWS stack state (run verification script)
- ⚠️ Secrets Manager secret existence (create if needed)
- ⚠️ IAM permissions (verify or redeploy stack)

**Recommended Action:**
1. Run `./scripts/verify-mode1-setup.sh`
2. Follow the output to create secret (if needed)
3. Deploy/redeploy stack as indicated
4. Test orchestrator

Good luck with Mode 1 testing! 🚀

