# Migration to Official NEAR CLI Tools

## Current State

We're currently using `near-api-js` (v2.1.4) directly for:
- Account creation (`masterAccount.createAccount()`)
- Contract deployment (`account.deployContract()`)
- Key management (`KeyPair`, `keyStores`)

## Official NEAR CLI Tools Available

### 1. `near-cli-rs` (Recommended - Latest)
- **Version**: 0.22.2 (published 2025-08-31)
- **Type**: Rust-based CLI (more performant, actively maintained)
- **Package**: `npm install -g near-cli-rs`
- **Binary**: `near` command
- **Repository**: https://github.com/near/near-cli-rs

### 2. `near-cli` (Legacy)
- **Version**: 4.0.13 (published 2024-03-20)
- **Type**: JavaScript-based CLI
- **Package**: `npm install -g near-cli`
- **Binary**: `near` command
- **Repository**: https://github.com/near/near-cli

## Recommended Approach

Use `near-cli-rs` for command-line operations, but keep `near-api-js` for programmatic access in TypeScript.

### Why Keep `near-api-js`?

1. **Programmatic Access**: Our orchestrator needs to programmatically create accounts and deploy contracts
2. **Integration**: We need to integrate with AWS KMS for key management
3. **TypeScript Support**: Better type safety and IDE support
4. **Error Handling**: Programmatic error handling in our codebase

### When to Use `near-cli-rs`

Use CLI tools for:
- **One-off operations**: Manual account creation, contract deployment
- **Scripts**: Shell scripts that can call CLI commands
- **Development**: Quick testing and verification
- **Documentation**: Providing examples to developers

## Migration Strategy

### Phase 1: Update Dependencies
- ✅ Keep `near-api-js` (v2.1.4) - latest stable
- ✅ Add `near-cli-rs` as dev dependency for scripts
- ✅ Document CLI usage alongside programmatic API

### Phase 2: Replace Custom Scripts with CLI

**Current Custom Code:**
```typescript
// Custom account creation
await masterAccount.createAccount(accountId, publicKey, amount);
```

**CLI Alternative (for scripts):**
```bash
near account create-account \
  --account-id deployer.node0 \
  --master-account node0 \
  --public-key ed25519:... \
  --initial-balance 15NEAR \
  --network-id localnet \
  --node-url http://localhost:3030
```

### Phase 3: Hybrid Approach

**For Programmatic Use (Keep):**
- Use `near-api-js` in TypeScript code
- Better error handling and integration

**For Scripts (Migrate):**
- Use `near-cli-rs` in shell scripts
- Simpler, more maintainable

## Commands to Replace

### Account Creation
**Current**: `masterAccount.createAccount()`
**CLI**: `near account create-account`

### Contract Deployment
**Current**: `account.deployContract(wasmCode)`
**CLI**: `near contract deploy`

### Key Management
**Current**: `KeyPair.fromRandom()`, `keyStore.setKey()`
**CLI**: `near account add-key`, `near account delete-key`

## Implementation Plan

1. **Keep programmatic code** - Our TypeScript orchestrator should continue using `near-api-js`
2. **Add CLI as alternative** - Provide CLI commands in documentation for manual operations
3. **Update scripts** - Replace shell script logic with CLI calls where appropriate
4. **Document both approaches** - Show both programmatic and CLI methods

## Benefits

- ✅ Use official, maintained tools
- ✅ Better documentation and community support
- ✅ Keep programmatic flexibility for our use case
- ✅ Provide CLI alternatives for developers
- ✅ Reduce custom code maintenance

## Next Steps

1. Install `near-cli-rs`: `npm install -D near-cli-rs`
2. Update scripts to use CLI where appropriate
3. Document CLI usage in README
4. Keep `near-api-js` for programmatic access

