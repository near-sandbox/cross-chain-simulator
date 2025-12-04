#!/bin/bash
# Generate NEAR keypair and optionally update Secrets Manager
#
# Usage:
#   ./scripts/generate-near-key.sh                    # Just generate and display
#   ./scripts/generate-near-key.sh --update-secret    # Generate and update Secrets Manager

set -e

UPDATE_SECRET=false
PROFILE_FLAG=""
SECRET_NAME="/near/localnet/master-account-key"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --update-secret|-u)
            UPDATE_SECRET=true
            shift
            ;;
        --profile|-p)
            PROFILE_FLAG="--profile $2"
            shift 2
            ;;
        --secret-name)
            SECRET_NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--update-secret|-u] [--profile PROFILE] [--secret-name NAME]"
            exit 1
            ;;
    esac
done

# Generate keypair
echo "🔑 Generating NEAR ed25519 keypair..."
SECRET_JSON=$(node -e "
const { KeyPair } = require('near-api-js');
const keyPair = KeyPair.fromRandom('ed25519');
const accountId = 'test.near';
const privateKey = keyPair.toString();
const publicKey = keyPair.getPublicKey().toString();

const secretJson = JSON.stringify({
  account: accountId,
  privateKey: privateKey
}, null, 2);

console.log(JSON.stringify({
  json: secretJson,
  publicKey: publicKey
}));
")

# Extract values
SECRET_VALUE=$(echo "$SECRET_JSON" | jq -r '.json')
PUBLIC_KEY=$(echo "$SECRET_JSON" | jq -r '.publicKey')

echo "✅ Generated keypair:"
echo "   Account: test.near"
echo "   Public Key: $PUBLIC_KEY"
echo ""
echo "📋 Secret JSON:"
echo "$SECRET_VALUE"
echo ""

if [ "$UPDATE_SECRET" = true ]; then
    echo "📤 Updating Secrets Manager..."
    if [ -z "$PROFILE_FLAG" ]; then
        echo "   Using default AWS profile"
        aws secretsmanager update-secret \
            --secret-id "$SECRET_NAME" \
            --secret-string "$SECRET_VALUE" \
            --region us-east-1 \
            --query 'ARN' \
            --output text > /dev/null
    else
        echo "   Using profile: ${PROFILE_FLAG#--profile }"
        aws $PROFILE_FLAG secretsmanager update-secret \
            --secret-id "$SECRET_NAME" \
            --secret-string "$SECRET_VALUE" \
            --region us-east-1 \
            --query 'ARN' \
            --output text > /dev/null
    fi
    
    echo "✅ Secret updated in Secrets Manager: $SECRET_NAME"
    
    # Get ARN
    if [ -z "$PROFILE_FLAG" ]; then
        ARN=$(aws secretsmanager describe-secret \
            --secret-id "$SECRET_NAME" \
            --region us-east-1 \
            --query 'ARN' \
            --output text)
    else
        ARN=$(aws $PROFILE_FLAG secretsmanager describe-secret \
            --secret-id "$SECRET_NAME" \
            --region us-east-1 \
            --query 'ARN' \
            --output text)
    fi
    
    echo ""
    echo "💡 Export this ARN:"
    echo "   export MASTER_ACCOUNT_KEY_ARN=$ARN"
else
    echo "💡 To update Secrets Manager, run:"
    echo "   $0 --update-secret${PROFILE_FLAG:+ $PROFILE_FLAG}"
fi

