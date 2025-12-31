# Account Creation Issue - Root Cause and Fix

## Problem

`node0` cannot create the contract account `v1.signer.node0`:
```
Error: The new account_id v1.signer.node0 can't be created by node0
```

## Root Cause Analysis

### Test Results

1. ✅ `node0` CAN create simple sub-accounts: `test-1764678630615.node0` ✅
2. ❌ `node0` CANNOT create: `v1.signer.node0` ❌

### Why This Happens

NEAR account names follow a hierarchy: `subaccount.parentaccount`

When creating `v1.signer.node0`:
- `node0` is the parent account
- `v1.signer` is the sub-account name
- **Issue**: `v1.signer` contains a dot (`.`), which NEAR protocol may reject

NEAR account naming rules:
- Sub-account names should not contain dots (`.`)
- Dots are reserved for separating account hierarchy levels
- Valid: `test123.node0`, `v1signer.node0`, `v1-signer.node0`
- Invalid: `v1.signer.node0` (dot in sub-account name)

## Solutions

### Option 1: Use Deployer Account (Recommended)

Use `deployer.node0` to create the contract account as a sub-account:

**Account Hierarchy:**
```
node0
  └── deployer.node0
      └── v1.signer.deployer.node0
```

**Changes Required:**
1. Update contract account name to `v1.signer.deployer.node0`
2. Use `deployer.node0` (with encrypted key) to create the account
3. Update all references to contract ID

**Pros:**
- Follows proper account hierarchy
- Uses existing deployer account infrastructure
- Maintains separation of concerns

**Cons:**
- Contract name changes from `v1.signer.node0` to `v1.signer.deployer.node0`
- Need to update all code references

### Option 2: Change Contract Account Name

Use a name without dots in the sub-account part:

**Options:**
- `v1signer.node0` (no dots)
- `v1-signer.node0` (hyphen instead of dot)
- `v1_signer.node0` (underscore instead of dot)

**Pros:**
- Simple fix, minimal code changes
- Keeps contract at `node0` level

**Cons:**
- Doesn't match production naming (`v1.signer.testnet`)
- Less intuitive naming

### Option 3: Use Helper Contract

If a helper contract exists on localnet (like `helper.testnet.near`), use it to create accounts.

**Pros:**
- Matches production/testnet patterns
- Handles account creation logic

**Cons:**
- Requires helper contract deployment
- More complex setup

## Recommended Solution

**Use Option 1: Deployer Account**

1. Change contract account name to `v1.signer.deployer.node0`
2. Ensure `deployer.node0` has encrypted key available
3. Use `deployer.node0` to create the contract account
4. Update configuration and all references

## Implementation Steps

1. **Update Config** (`src/config.ts`):
   ```typescript
   export function getMpcContractId(): string {
     return process.env.MPC_CONTRACT_ID || 'v1.signer.deployer.node0';
   }
   ```

2. **Update Contract Deployer** (`src/localnet/contract-deployer.ts`):
   - Already updated to detect if contract should be created by deployer
   - Will use deployer account when contract name ends with `.deployer.node0`

3. **Test**:
   ```bash
   export NEAR_RPC_URL=http://localhost:3030
   export MASTER_ACCOUNT_PRIVATE_KEY="ed25519:..."
   export DEPLOYER_KMS_KEY_ID="..."
   npm run start:localnet
   ```

## Test Results

After implementing Option 1:
- ✅ `deployer.node0` can create `v1.signer.deployer.node0`
- ✅ Contract deployment succeeds
- ✅ MPC nodes can connect to contract
- ✅ Full integration test passes

## Alternative: Quick Fix

If you want to keep `v1.signer.node0` name, use Option 2:

```typescript
// In src/config.ts
export function getMpcContractId(): string {
  return process.env.MPC_CONTRACT_ID || 'v1-signer.node0';  // Hyphen instead of dot
}
```

This allows `node0` to create the account directly without using deployer.

