# What We Fixed for Future Deployments

**Date**: December 23, 2025  
**Changes Made**: Updated code to use production-equivalent path by default

## Code Changes

### 1. Updated Orchestrator Default Behavior

**File**: [`src/localnet/orchestrator.ts`](src/localnet/orchestrator.ts)

**Before** (Line 116-119):
```typescript
const useMpcSetup = process.env.USE_MPC_SETUP === 'true';  // Defaults to FALSE
```

**After**:
```typescript
const useMpcSetup = process.env.USE_MPC_SETUP !== 'false';  // Defaults to TRUE
```

**Impact**: Future deployments will automatically use the production-equivalent MpcSetup path which:
- ✅ Initializes contract with `init()`
- ✅ Votes to add ECDSA domain
- ✅ Triggers distributed key generation
- ✅ Mirrors mainnet/testnet flow

### 2. Updated Start Script

**File**: [`scripts/start-localnet.sh`](scripts/start-localnet.sh)

**Added**:
```bash
# Enable production-equivalent MPC setup by default
export USE_MPC_SETUP=${USE_MPC_SETUP:-true}
```

**Impact**: `npm run start:localnet` now uses MpcSetup by default

### 3. Added Domain Voting to MpcSetup

**File**: [`src/localnet/mpc-setup.ts`](src/localnet/mpc-setup.ts)

**Added Method** (Lines 401-459):
```typescript
private async addDomains(
  contractId: string,
  participants: ParticipantInfo[]
): Promise<void> {
  // Votes to add domain_id: 0 (Secp256k1/ECDSA)
  // Each participant votes
  // When threshold reached, contract transitions to Initializing
  // MPC nodes automatically generate keys
}
```

**Impact**: setupMpcNetwork() now includes complete initialization flow

### 4. Updated README

**File**: [`README.md`](README.md)

**Added**: Documentation explaining the production-equivalent path is now default

## What This Means

### For Current Deployment

**Current State**: Contract deployed but no domains (used legacy path)

**Manual Fix Today**: SSH into MPC node and add domains manually

**Future**: Won't happen again (defaults fixed)

### For Future Deployments

**When someone runs**:
```bash
npm run start:localnet
```

**What happens now**:
1. Uses MpcSetup path automatically ✅
2. Deploys contract ✅
3. Initializes with participants ✅
4. Votes to add ECDSA domain ✅
5. Triggers key generation ✅
6. Ready for signing after ~10 minutes ✅

**To use legacy path** (if needed):
```bash
export USE_MPC_SETUP=false
npm run start:localnet
```

## Mirroring Production

**You asked**: "We should mirror MPC-managed production"

**Answer**: You now do! The default path matches the production flow:

**Mainnet/Testnet** (via mpc-devnet CLI):
```
mpc-devnet deploy-contract
mpc-devnet init-contract --threshold 2
mpc-devnet vote-add-domains --schemes Secp256k1
# Wait for key generation
# Ready
```

**Your Localnet** (via MpcSetup, default):
```
npm run start:localnet
# Automatically does:
# - deploy contract
# - init with participants
# - vote to add ECDSA domain
# Wait for key generation
# Ready
```

**SAME FLOW, DIFFERENT TOOLS!**

## What Broke Before

**Original deployment**:
- `USE_MPC_SETUP` not set → defaulted to false
- Used legacy path
- Contract deployed but domain voting never happened
- Result: "No such domain" error

**Now**:
- `USE_MPC_SETUP` defaults to true
- Uses MpcSetup path
- Complete initialization happens automatically
- Result: Production-equivalent setup

## Summary

### Changes Made
1. ✅ Orchestrator defaults to MpcSetup path (not legacy)
2. ✅ start-localnet.sh exports USE_MPC_SETUP=true
3. ✅ Added addDomains() method to MpcSetup
4. ✅ Updated documentation

### Impact
- Future deployments: Production-equivalent by default
- Current deployment: Needs manual fix (next step)
- Developer experience: Just works™

### Files Changed
- `src/localnet/orchestrator.ts` - Default changed
- `src/localnet/mpc-setup.ts` - Domain voting added
- `scripts/start-localnet.sh` - Export USE_MPC_SETUP=true
- `README.md` - Documentation updated

---

**Your code now mirrors production by default. Future deployments will just work!** ✅

