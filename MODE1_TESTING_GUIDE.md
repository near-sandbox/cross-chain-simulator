# Mode 1 Testing Guide

## Quick Status Check

Run the verification script to check your current setup:

```bash
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator
./scripts/verify-mode1-setup.sh
```

## Current Situation

✅ **NEAR RPC**: Accessible at `http://54.90.246.254:3030`  
✅ **Code**: Complete and compiles successfully  
⚠️ **AWS Stack**: Need to verify Secrets Manager permissions  
⚠️ **Secrets Manager**: Need to verify/create master account key secret  

## Step-by-Step Testing Process

### Step 1: Verify AWS Credentials

```bash
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/..."
}
```

### Step 2: Check Current Stack State

```bash
export AWS_REGION=us-east-1

# Check if stack exists
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' \
  --output json
```

**Possible Outcomes:**

**A. Stack doesn't exist:**
- ✅ Good - Fresh deployment will include all Secrets Manager permissions
- Proceed to Step 3

**B. Stack exists:**
- ⚠️ Need to verify if it has Secrets Manager permissions
- Check IAM role policies (see Step 2B)
- May need to redeploy to add permissions

**C. Stack exists but was deployed before Secrets Manager integration:**
- ❌ Must redeploy to add Secrets Manager permissions
- Proceed to Step 3

### Step 2B: Verify Secrets Manager Permissions (if stack exists)

```bash
# Get the IAM role name
ROLE_NAME=$(aws cloudformation describe-stack-resources \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'StackResources[?ResourceType==`AWS::IAM::Role`].PhysicalResourceId' \
  --output text | head -1)

echo "IAM Role: $ROLE_NAME"

# Check attached policies
aws iam list-attached-role-policies --role-name "$ROLE_NAME"

# Check inline policies
aws iam list-role-policies --role-name "$ROLE_NAME"
aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name <policy-name>
```

**What to look for:**
- Policies containing `secretsmanager:GetSecretValue`
- Or a Secrets Manager grant from the CDK stack

**If permissions are missing:**
- Redeploy the stack (Step 3) - CDK will update IAM permissions

### Step 3: Create/Verify Secrets Manager Secret

#### Option A: Check if secret already exists

```bash
aws secretsmanager list-secrets \
  --region us-east-1 \
  --query 'SecretList[?contains(Name, `near`) || contains(Name, `master`) || contains(Name, `test.near`)].{Name:Name,ARN:ARN}' \
  --output table
```

#### Option B: Create new secret (if doesn't exist)

**Prerequisites:**
- You need the private key for `test.near` account
- Get it from your NEAR localnet node (SSH to EC2 instance if needed)

```bash
# Create the secret
aws secretsmanager create-secret \
  --name /near/localnet/master-account-key \
  --description "NEAR localnet master account (test.near) private key" \
  --secret-string '{"account":"test.near","privateKey":"ed25519:YOUR_PRIVATE_KEY_HERE"}' \
  --region us-east-1

# Get the ARN
export MASTER_ACCOUNT_KEY_ARN=$(aws secretsmanager describe-secret \
  --name /near/localnet/master-account-key \
  --region us-east-1 \
  --query 'ARN' \
  --output text)

echo "Master Account Key ARN: $MASTER_ACCOUNT_KEY_ARN"
```

**Secret Format:**
```json
{
  "account": "test.near",
  "privateKey": "ed25519:..."
}
```

### Step 4: Deploy/Update CDK Stack

```bash
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

# Set environment variables
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<from-step-3>
export AWS_REGION=us-east-1

# Optional: Set CDK account/region
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

# Synthesize to verify configuration
npm run cdk:synth

# Deploy (Mode 1: explicitly disable NEAR node deployment)
cdk deploy CrossChainSimulatorStack -c deployNearNode=false
```

**Expected CDK Output:**
```
📦 Mode 1: Deploying CrossChainSimulatorStack with existing infrastructure
   RPC URL: http://54.90.246.254:3030
   Master Key ARN: arn:aws:secretsmanager:us-east-1:...
```

**What Gets Deployed:**
- ✅ KMS key for deployer account encryption
- ✅ IAM role with Secrets Manager read permissions
- ✅ EC2 instance profile
- ✅ CloudFormation outputs

**What Does NOT Get Deployed:**
- ❌ NEAR localnet node (uses existing at http://54.90.246.254:3030)

### Step 5: Verify Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' \
  --output table
```

**Expected Outputs:**
- `DeployerKmsKeyId` - KMS key ID for deployer account
- `DeployerKmsKeyArn` - KMS key ARN
- `EC2InstanceProfileName` - Instance profile for EC2
- `NearRpcUrl` - NEAR RPC URL
- `MasterAccountKeyArnUsed` - Confirms which secret ARN is used

### Step 6: Test Orchestrator

```bash
cd /Users/Shai.Perednik/Documents/code_workspace/near_mobile/cross-chain-simulator

# Get KMS key ID from stack outputs
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

# Set required environment variables
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<from-step-3>
export AWS_REGION=us-east-1

# Run orchestrator
npm run start:localnet
```

**Expected Orchestrator Flow:**
1. ✅ Verifies RPC connection
2. ✅ Retrieves master account key from Secrets Manager
3. ✅ Initializes master account
4. ✅ Creates deployer account
5. ✅ Deploys v1.signer contract
6. ✅ Starts MPC nodes
7. ✅ Health checks all services

## Troubleshooting

### Error: "Secret not found"

**Symptom:**
```
Secret not found: arn:aws:secretsmanager:...
```

**Solution:**
1. Verify secret exists:
   ```bash
   aws secretsmanager describe-secret --secret-id <arn>
   ```
2. Check ARN is correct (full ARN, not just name)
3. Ensure secret is in the same region (us-east-1)

### Error: "Access denied to secret"

**Symptom:**
```
Access denied to secret: arn:aws:secretsmanager:...
```

**Solution:**
1. Verify IAM role has Secrets Manager permissions:
   ```bash
   # Get role name from stack
   ROLE_NAME=$(aws cloudformation describe-stack-resources \
     --stack-name CrossChainSimulatorStack \
     --query 'StackResources[?ResourceType==`AWS::IAM::Role`].PhysicalResourceId' \
     --output text | head -1)
   
   # Check policies
   aws iam list-attached-role-policies --role-name "$ROLE_NAME"
   ```
2. If permissions missing, redeploy stack:
   ```bash
   cdk deploy CrossChainSimulatorStack -c deployNearNode=false
   ```

### Error: "KMS key ID is required"

**Symptom:**
```
KMS key ID is required. Set DEPLOYER_KMS_KEY_ID environment variable.
```

**Solution:**
```bash
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)
```

### Error: "RPC connection verification failed"

**Symptom:**
```
RPC connection verification failed: ...
```

**Solution:**
1. Verify NEAR RPC is accessible:
   ```bash
   curl -X POST http://54.90.246.254:3030 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"status","params":[],"id":1}'
   ```
2. Check firewall/security group allows access
3. Verify node is running on EC2 instance

## Decision Matrix: Redeploy Stack?

| Scenario | Action |
|----------|--------|
| Stack doesn't exist | ✅ Deploy (includes Secrets Manager permissions) |
| Stack exists, deployed before Secrets Manager integration | ✅ Redeploy (adds Secrets Manager permissions) |
| Stack exists, unsure about permissions | ⚠️ Check IAM role, then redeploy if needed |
| Stack exists, confirmed Secrets Manager permissions | ✅ No redeploy needed, just set env vars |

## Quick Reference Commands

```bash
# Full Mode 1 deployment flow
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<your-secret-arn>
export AWS_REGION=us-east-1

# Deploy stack
cdk deploy CrossChainSimulatorStack -c deployNearNode=false

# Get KMS key ID
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

# Run orchestrator
npm run start:localnet
```

## Verification Checklist

- [ ] AWS credentials configured (`aws sts get-caller-identity`)
- [ ] NEAR RPC accessible (`http://54.90.246.254:3030`)
- [ ] Secrets Manager secret exists for master account key
- [ ] CDK stack deployed with Secrets Manager permissions
- [ ] Stack outputs retrieved (KMS key ID, etc.)
- [ ] Environment variables set (NEAR_RPC_URL, MASTER_ACCOUNT_KEY_ARN, DEPLOYER_KMS_KEY_ID)
- [ ] Orchestrator runs successfully

## Next Steps After Successful Test

1. ✅ Verify contracts deployed to localnet
2. ✅ Verify MPC nodes running and healthy
3. ✅ Test cross-chain operations
4. ✅ Document any issues or improvements needed

