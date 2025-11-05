# Mode 1 Testing Checklist

## ✅ Code Ready

- [x] Orchestrator supports `masterAccountKeyArn`
- [x] `fetchKeyFromSecretsManager()` implemented
- [x] CDK stack accepts `masterAccountKeyArn` prop
- [x] CDK stack grants Secrets Manager read permissions
- [x] Mode detection logic in `cdk/bin/app.ts`

## 🔍 Pre-Deployment Check

### 1. Check Current Stack State

```bash
# Check if stack exists
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "Stack does not exist"
```

### 2. Check Required Resources

**Mode 1 Requirements:**
- ✅ Existing NEAR localnet node (we have: http://54.90.246.254:3030)
- ⚠️  Master account key in Secrets Manager (NEED TO CREATE)
- ⚠️  KMS key for deployer (may need to create)

### 3. Check Secrets Manager

```bash
# List secrets related to NEAR
aws secretsmanager list-secrets \
  --query 'SecretList[?contains(Name, `near`) || contains(Name, `master`) || contains(Name, `test.near`)]' \
  --output table
```

## 🚀 Deployment Steps for Mode 1 Testing

### Step 1: Create Master Account Key Secret (If Not Exists)

```bash
# Get test.near private key from EC2 localnet
# (You'll need to SSH to the EC2 instance)

# Create secret in Secrets Manager
aws secretsmanager create-secret \
  --name /near/localnet/master-account-key \
  --description "NEAR localnet master account (test.near) private key" \
  --secret-string '{"account":"test.near","privateKey":"ed25519:YOUR_KEY_HERE"}' \
  --region us-east-1

# Get the ARN
export MASTER_ACCOUNT_KEY_ARN=$(aws secretsmanager describe-secret \
  --name /near/localnet/master-account-key \
  --query 'ARN' \
  --output text)
```

### Step 2: Check/Deploy CDK Stack

```bash
cd /cross-chain-simulator

# Check if stack needs update
npm run cdk:synth

# Compare with deployed stack
aws cloudformation get-template \
  --stack-name CrossChainSimulatorStack \
  --query 'TemplateBody' > deployed-template.json 2>/dev/null || echo "Stack not deployed"

# Deploy/Update stack with Mode 1 config
export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<from-step-1>
export DEPLOYER_KMS_KEY_ID=<create-or-use-existing>

cdk deploy CrossChainSimulatorStack -c deployNearNode=false
```

### Step 3: Verify Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs' \
  --output table
```

### Step 4: Test Orchestrator

```bash
# Set environment variables
export DEPLOYER_KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name CrossChainSimulatorStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployerKmsKeyId`].OutputValue' \
  --output text)

export NEAR_RPC_URL=http://54.90.246.254:3030
export MASTER_ACCOUNT_KEY_ARN=<from-step-1>

# Run orchestrator
npm run start:localnet
```

## ⚠️ Decision: Redeploy Stack?

**YES - Redeploy if:**
- Stack doesn't exist yet
- Stack was deployed before Secrets Manager integration was added
- You want to test the new IAM permissions

**NO - Update only if:**
- Stack exists and has Secrets Manager permissions already
- You just need to pass new environment variables

## 🔧 Quick Check Commands

```bash
# 1. Check if stack exists and status
aws cloudformation describe-stacks --stack-name CrossChainSimulatorStack 2>&1 | grep -E "StackStatus|does not exist"

# 2. Check if EC2 role has Secrets Manager permissions
aws iam get-role-policy \
  --role-name CrossChainSimulatorStack-EC2OrchestratorRole \
  --policy-name <policy-name> 2>&1 | grep -i secrets || echo "Need to check IAM policies"

# 3. Verify NEAR RPC is accessible
curl -X POST http://54.90.246.254:3030 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"status","params":[],"id":1}' | jq .

# 4. Check if master account key secret exists
aws secretsmanager describe-secret \
  --secret-id /near/localnet/master-account-key 2>&1 | grep -E "ARN|does not exist"
```

## 📋 Mode 1 Testing Requirements Summary

**Must Have:**
1. ✅ NEAR localnet node running (http://54.90.246.254:3030)
2. ⚠️  Master account key in Secrets Manager (CREATE THIS)
3. ⚠️  KMS key for deployer (may need CREATE)
4. ⚠️  CDK stack deployed with Secrets Manager permissions (CHECK/REDEPLOY)

**Code Status:**
- ✅ All code ready for Mode 1
- ✅ Orchestrator can fetch from Secrets Manager
- ✅ CDK stack grants IAM permissions

**Action Items:**
1. Create Secrets Manager secret for master account key
2. Verify/redeploy CDK stack (if needed)
3. Test orchestrator with Mode 1 config

