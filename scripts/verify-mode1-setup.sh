#!/bin/bash
# Mode 1 Setup Verification Script
# Checks AWS stack state, Secrets Manager, and prepares for Mode 1 deployment
#
# Usage:
#   ./scripts/verify-mode1-setup.sh
#   ./scripts/verify-mode1-setup.sh --profile my-profile
#   ./scripts/verify-mode1-setup.sh -p my-profile

set -e

# Parse command line arguments
AWS_PROFILE_FLAG=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile|-p)
            AWS_PROFILE_FLAG="--profile $2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--profile|-p PROFILE_NAME]"
            exit 1
            ;;
    esac
done

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="CrossChainSimulatorStack"
NEAR_RPC_URL="${NEAR_RPC_URL:-http://54.90.246.254:3030}"

echo "🔍 Mode 1 Setup Verification"
if [ -n "$AWS_PROFILE_FLAG" ]; then
    echo "Using AWS profile: ${AWS_PROFILE_FLAG#--profile }"
fi
echo "============================"
echo ""

# Check AWS credentials
echo "1️⃣  Checking AWS credentials..."
if ! aws $AWS_PROFILE_FLAG sts get-caller-identity &>/dev/null; then
    echo "❌ AWS credentials not configured"
    if [ -n "$AWS_PROFILE_FLAG" ]; then
        echo "   Profile: ${AWS_PROFILE_FLAG#--profile }"
    fi
    echo "   Run: aws configure${AWS_PROFILE_FLAG:+ $AWS_PROFILE_FLAG}"
    exit 1
fi
ACCOUNT_ID=$(aws $AWS_PROFILE_FLAG sts get-caller-identity --query Account --output text)
echo "   ✅ AWS credentials OK (Account: $ACCOUNT_ID)"
echo ""

# Check NEAR RPC accessibility
echo "2️⃣  Checking NEAR RPC accessibility..."
if curl -s -X POST "$NEAR_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"status","params":[],"id":1}' | grep -q "chain_id"; then
    echo "   ✅ NEAR RPC accessible: $NEAR_RPC_URL"
else
    echo "   ❌ NEAR RPC not accessible: $NEAR_RPC_URL"
    exit 1
fi
echo ""

# Check if stack exists
echo "3️⃣  Checking CDK stack state..."
if aws $AWS_PROFILE_FLAG cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
    STACK_STATUS=$(aws $AWS_PROFILE_FLAG cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)
    echo "   ✅ Stack exists: $STACK_STATUS"
    
    # Check if stack has Secrets Manager permissions
    echo "   Checking IAM role for Secrets Manager permissions..."
    ROLE_NAME=$(aws $AWS_PROFILE_FLAG cloudformation describe-stack-resources \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'StackResources[?ResourceType==`AWS::IAM::Role`].PhysicalResourceId' \
        --output text | head -1)
    
    if [ -n "$ROLE_NAME" ]; then
        echo "   Found IAM role: $ROLE_NAME"
        # Check for Secrets Manager policies
        POLICIES=$(aws $AWS_PROFILE_FLAG iam list-attached-role-policies --role-name "$ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null || echo "")
        INLINE_POLICIES=$(aws $AWS_PROFILE_FLAG iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames' --output text 2>/dev/null || echo "")
        
        if echo "$POLICIES $INLINE_POLICIES" | grep -qi "secrets"; then
            echo "   ✅ Role has Secrets Manager permissions"
        else
            echo "   ⚠️  Role may not have Secrets Manager permissions"
            echo "   → Stack may need redeploy to add Secrets Manager access"
        fi
    fi
else
    echo "   ⚠️  Stack does not exist - will be created on deploy"
fi
echo ""

# Check Secrets Manager secrets
echo "4️⃣  Checking Secrets Manager secrets..."
SECRETS=$(aws $AWS_PROFILE_FLAG secretsmanager list-secrets \
    --region "$REGION" \
    --query 'SecretList[?contains(Name, `near`) || contains(Name, `master`) || contains(Name, `test.near`)].{Name:Name,ARN:ARN}' \
    --output json 2>/dev/null || echo "[]")

if [ "$SECRETS" != "[]" ] && [ -n "$SECRETS" ]; then
    echo "   ✅ Found NEAR-related secrets:"
    echo "$SECRETS" | jq -r '.[] | "      - \(.Name): \(.ARN)"'
    
    # Suggest using the first one
    SUGGESTED_ARN=$(echo "$SECRETS" | jq -r '.[0].ARN // empty')
    if [ -n "$SUGGESTED_ARN" ]; then
        echo ""
        echo "   💡 Suggested MASTER_ACCOUNT_KEY_ARN:"
        echo "      export MASTER_ACCOUNT_KEY_ARN=$SUGGESTED_ARN"
        
        # Check if secret has placeholder value
        SECRET_NAME=$(echo "$SECRETS" | jq -r '.[0].Name // empty')
        if [ -n "$SECRET_NAME" ]; then
            SECRET_VALUE=$(aws $AWS_PROFILE_FLAG secretsmanager get-secret-value \
                --secret-id "$SECRET_NAME" \
                --region "$REGION" \
                --query 'SecretString' \
                --output text 2>/dev/null || echo "")
            if echo "$SECRET_VALUE" | grep -q "YOUR_KEY_HERE"; then
                echo ""
                echo "   ⚠️  Secret exists but contains placeholder value!"
                echo "   📝 Update the secret with your actual private key:"
                echo "      aws $AWS_PROFILE_FLAG secretsmanager update-secret \\"
                echo "        --secret-id $SECRET_NAME \\"
                echo "        --secret-string '{\"account\":\"test.near\",\"privateKey\":\"ed25519:ACTUAL_KEY_HERE\"}' \\"
                echo "        --region $REGION"
            fi
        fi
    fi
else
    echo "   ⚠️  No NEAR-related secrets found"
    echo ""
    echo "   📝 To create a secret for master account key:"
    echo "      aws $AWS_PROFILE_FLAG secretsmanager create-secret \\"
    echo "        --secret-id /near/localnet/master-account-key \\"
    echo "        --description \"NEAR localnet master account (test.near) private key\" \\"
    echo "        --secret-string '{\"account\":\"test.near\",\"privateKey\":\"ed25519:YOUR_KEY_HERE\"}' \\"
    echo "        --region $REGION"
    echo ""
    echo "   Then get the ARN:"
    echo "      aws $AWS_PROFILE_FLAG secretsmanager describe-secret \\"
    echo "        --secret-id /near/localnet/master-account-key \\"
    echo "        --query 'ARN' --output text"
fi
echo ""

# Check KMS keys
echo "5️⃣  Checking KMS keys..."
KMS_KEYS=$(aws $AWS_PROFILE_FLAG kms list-keys --region "$REGION" --query 'Keys[].KeyId' --output text 2>/dev/null || echo "")
if [ -n "$KMS_KEYS" ]; then
    echo "   ✅ KMS keys available"
    echo "   Note: Stack will create a new KMS key if deploying"
else
    echo "   ⚠️  No KMS keys found (stack will create one)"
fi
echo ""

# Summary and next steps
echo "📋 Summary & Next Steps"
echo "======================"
echo ""
echo "✅ Verified:"
echo "   - AWS credentials configured"
echo "   - NEAR RPC accessible: $NEAR_RPC_URL"
echo ""

if aws $AWS_PROFILE_FLAG cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
    echo "⚠️  Stack exists - verify it has Secrets Manager permissions"
    echo "   If unsure, redeploy to ensure latest permissions:"
    echo ""
    if [ -n "$AWS_PROFILE_FLAG" ]; then
        PROFILE_NAME="${AWS_PROFILE_FLAG#--profile }"
        echo "   export AWS_PROFILE=$PROFILE_NAME"
    fi
    echo "   export NEAR_RPC_URL=$NEAR_RPC_URL"
    if [ -n "$SUGGESTED_ARN" ]; then
        echo "   export MASTER_ACCOUNT_KEY_ARN=$SUGGESTED_ARN"
    else
        echo "   export MASTER_ACCOUNT_KEY_ARN=<your-secret-arn>"
    fi
    echo "   cdk deploy CrossChainSimulatorStack -c deployNearNode=false"
else
    echo "📦 Ready to deploy stack"
    echo ""
    if [ -n "$AWS_PROFILE_FLAG" ]; then
        PROFILE_NAME="${AWS_PROFILE_FLAG#--profile }"
        echo "   export AWS_PROFILE=$PROFILE_NAME"
    fi
    echo "   export NEAR_RPC_URL=$NEAR_RPC_URL"
    if [ -n "$SUGGESTED_ARN" ]; then
        echo "   export MASTER_ACCOUNT_KEY_ARN=$SUGGESTED_ARN"
    else
        echo "   export MASTER_ACCOUNT_KEY_ARN=<your-secret-arn>"
    fi
    echo "   cdk deploy CrossChainSimulatorStack -c deployNearNode=false"
fi
echo ""

