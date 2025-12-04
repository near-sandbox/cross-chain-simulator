# NEAR Tools Analysis - Official vs Custom Code

## Current State Analysis

### What We're Using

1. **`near-api-js` v2.1.4** ✅ Official SDK
   - Used for: Programmatic account creation, contract deployment
   - Location: `src/localnet/contract-deployer.ts`
   - Status: **This IS the official NEAR JavaScript SDK** - we're using it correctly

2. **Custom Code** ⚠️ 
   - Account creation logic in `ContractDeployer.createDeployerAccount()`
   - Contract deployment logic in `ContractDeployer.deploySignerContract()`
   - Key management with AWS KMS integration

### Official NEAR Tools Available

1. **`near-api-js`** ✅ (Already Using)
   - Official JavaScript SDK for NEAR Protocol
   - Provides programmatic access to NEAR blockchain
   - **This is the correct tool for our use case**

2. **`near-cli-rs`** v0.22.2 (CLI Tool)
   - Official Rust-based CLI
   - Designed for interactive/manual operations
   - Can be used in scripts but requires configuration

## Key Insight

**`near-api-js` IS the official tool** for programmatic NEAR operations. The CLI tools (`near-cli-rs`) are designed for:
- Interactive use by developers
- Manual operations
- Scripts that can handle interactive prompts

Our orchestrator needs **programmatic control** because:
1. We integrate with AWS KMS for key management
2. We need error handling and retry logic
3. We coordinate multiple operations (account creation → contract deployment → MPC startup)
4. We need to pass configuration programmatically

## Recommendation

### Keep Using `near-api-js` ✅

**Why:**
- It's the official programmatic SDK
- Provides the flexibility we need
- Better integration with our TypeScript codebase
- Proper error handling and type safety

### Use CLI Tools for Documentation/Examples

**When:**
- Documenting manual operations for developers
- Providing CLI examples in README
- One-off scripts that don't need programmatic control

### What to Change

1. **Update `near-api-js` to latest version** (if newer available)
2. **Add CLI examples** to documentation
3. **Keep programmatic code** - it's using official tools correctly
4. **Remove any truly custom NEAR protocol logic** (if any exists)

## Verification

Let's verify we're using `near-api-js` correctly and update to latest version if needed.

