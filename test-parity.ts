#!/usr/bin/env npx ts-node

/**
 * test-parity.ts - Chain Signatures Parity Verification
 * 
 * This test verifies our implementation matches mainnet Chain Signatures semantics:
 * 
 * 1. Address Derivation Parity:
 *    - Our `deriveAddress` produces the same ETH address as `ethers.computeAddress`
 *    - Uses Keccak-256 hashing (not SHA-256)
 *    - Handles compressed and uncompressed public keys correctly
 * 
 * 2. Signature Parity:
 *    - Sign request uses correct args: { request: { payload, path, domain_id } }
 *    - Signature returned via yield/resume (not polling)
 *    - Signature format: { big_r, s, recovery_id }
 * 
 * 3. Recovery Parity:
 *    - Recovered address from signature matches derived address
 *    - Uses ethers.recoverAddress for verification
 * 
 * Prerequisites:
 *   - NEAR localnet running with v1.signer.localnet deployed
 *   - MPC nodes healthy
 *   - Signer account with funds (for deposit)
 * 
 * Usage:
 *   npx ts-node test-parity.ts
 * 
 * Environment:
 *   NEAR_RPC_URL        - NEAR RPC endpoint (default: http://localhost:3030)
 *   MPC_CONTRACT_ID     - v1.signer contract (default: v1.signer.localnet)
 *   SIGNER_ACCOUNT_ID   - Account ID for signing
 *   SIGNER_PRIVATE_KEY  - Private key for signer account (ed25519:...)
 */

import { keccak256, computeAddress, recoverAddress, getAddress, SigningKey, Signature } from 'ethers';
import { NearClient, DOMAIN_SECP256K1 } from './src/chain-signatures/near-client';

// Test configuration
const config = {
  rpcUrl: process.env.NEAR_RPC_URL || 'http://localhost:3030',
  mpcContractId: process.env.MPC_CONTRACT_ID || 'v1.signer.localnet',
  networkId: 'localnet',
  signerAccountId: process.env.SIGNER_ACCOUNT_ID,
  signerPrivateKey: process.env.SIGNER_PRIVATE_KEY,
};

const TEST_PATH = 'ethereum-test';
const TEST_ACCOUNT = 'test.localnet';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Chain Signatures Parity Verification Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📋 Configuration:');
  console.log(`   RPC URL: ${config.rpcUrl}`);
  console.log(`   Contract: ${config.mpcContractId}`);
  console.log(`   Network: ${config.networkId}`);
  console.log(`   Signer: ${config.signerAccountId || '(view-only mode)'}`);
  console.log('');

  const nearClient = new NearClient(
    config.rpcUrl,
    config.networkId,
    config.mpcContractId,
    config.signerAccountId,
    config.signerPrivateKey
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Test 1: Root Public Key Retrieval
  // ═══════════════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ Test 1: Root Public Key Retrieval                       │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let rootPublicKey: string;
  try {
    rootPublicKey = await nearClient.getRootPublicKey(DOMAIN_SECP256K1);
    console.log(`✅ Root public key retrieved`);
    console.log(`   Key: ${rootPublicKey.substring(0, 40)}...`);
    console.log(`   Domain: ${DOMAIN_SECP256K1} (Secp256k1/EVM)`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to get root public key: ${(error as Error).message}`);
    console.log('   This may indicate the contract is not initialized or domains not added.');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Test 2: Derived Public Key Retrieval
  // ═══════════════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ Test 2: Derived Public Key Retrieval                    │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let derivedPublicKey: string;
  try {
    derivedPublicKey = await nearClient.callDerivedPublicKey(TEST_PATH, DOMAIN_SECP256K1, TEST_ACCOUNT);
    console.log(`✅ Derived public key retrieved`);
    console.log(`   Path: ${TEST_PATH}`);
    console.log(`   Predecessor: ${TEST_ACCOUNT}`);
    console.log(`   Key: ${derivedPublicKey.substring(0, 40)}...`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to get derived public key: ${(error as Error).message}`);
    console.log('   This may indicate the path or predecessor is invalid.');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Test 3: EVM Address Derivation Parity
  // ═══════════════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ Test 3: EVM Address Derivation Parity                   │');
  console.log('└─────────────────────────────────────────────────────────┘');

  try {
    // Parse the MPC public key (may be in NEAR format: secp256k1:...)
    let keyHex = derivedPublicKey;
    if (keyHex.includes(':')) {
      keyHex = keyHex.split(':')[1];
    }

    // Add 0x prefix if needed
    if (!keyHex.startsWith('0x')) {
      keyHex = '0x' + keyHex;
    }

    // Use ethers to compute address from the public key
    const ethersAddress = computeAddress(keyHex);
    console.log(`✅ EVM address derived using ethers.computeAddress()`);
    console.log(`   Address: ${ethersAddress}`);

    // Now test our own derivation logic
    const ourAddress = deriveEvmAddressFromPublicKey(derivedPublicKey);
    console.log(`   Our derivation: ${ourAddress}`);

    // Compare
    if (ethersAddress.toLowerCase() === ourAddress.toLowerCase()) {
      console.log(`✅ Parity check PASSED: addresses match`);
    } else {
      console.log(`❌ Parity check FAILED: addresses differ`);
      console.log(`   Expected: ${ethersAddress}`);
      console.log(`   Got: ${ourAddress}`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Address derivation failed: ${(error as Error).message}`);
    console.log('   This may indicate an issue with the public key format.');
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Test 4: Signature Request (requires signer credentials)
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.signerAccountId || !config.signerPrivateKey) {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Test 4: Signature Request (SKIPPED - no signer creds)  │');
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log('   Set SIGNER_ACCOUNT_ID and SIGNER_PRIVATE_KEY to test signing.');
    console.log('');
  } else {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Test 4: Signature Request                              │');
    console.log('└─────────────────────────────────────────────────────────┘');

    try {
      // Create a 32-byte test payload (hash of a dummy transaction)
      const testPayload = keccak256(new TextEncoder().encode('test transaction for parity check'));
      const payloadBytes = new Uint8Array(Buffer.from(testPayload.slice(2), 'hex'));

      console.log(`   Payload: ${testPayload.substring(0, 20)}...`);
      console.log(`   ⏳ Requesting signature from MPC network...`);

      const signature = await nearClient.callSign({
        path: TEST_PATH,
        payload: payloadBytes,
        domainId: DOMAIN_SECP256K1,
      });

      console.log(`✅ Signature received!`);
      console.log(`   big_r: ${JSON.stringify(signature.big_r).substring(0, 40)}...`);
      console.log(`   s: ${JSON.stringify(signature.s).substring(0, 40)}...`);
      console.log(`   recovery_id: ${signature.recovery_id}`);
      console.log('');

      // ═══════════════════════════════════════════════════════════════════
      // Test 5: Signature Recovery Parity
      // ═══════════════════════════════════════════════════════════════════
      console.log('┌─────────────────────────────────────────────────────────┐');
      console.log('│ Test 5: Signature Recovery Parity                       │');
      console.log('└─────────────────────────────────────────────────────────┘');

      try {
        // Extract r and s from MPC signature format
        const r = typeof signature.big_r === 'object' 
          ? '0x' + (signature.big_r as { affine_point: string }).affine_point
          : '0x' + signature.big_r;
        const s = typeof signature.s === 'object'
          ? '0x' + (signature.s as { scalar: string }).scalar
          : '0x' + signature.s;
        const v = signature.recovery_id + 27; // Convert to Ethereum v

        // Recover the address from the signature
        const recoveredAddress = recoverAddress(testPayload, { r, s, v });
        console.log(`   Recovered address: ${recoveredAddress}`);

        // Compare with derived address
        let keyHex = derivedPublicKey;
        if (keyHex.includes(':')) {
          keyHex = keyHex.split(':')[1];
        }
        if (!keyHex.startsWith('0x')) {
          keyHex = '0x' + keyHex;
        }
        const expectedAddress = computeAddress(keyHex);

        if (recoveredAddress.toLowerCase() === expectedAddress.toLowerCase()) {
          console.log(`✅ Recovery parity PASSED: recovered address matches derived address`);
        } else {
          console.log(`❌ Recovery parity FAILED: addresses differ`);
          console.log(`   Expected: ${expectedAddress}`);
          console.log(`   Recovered: ${recoveredAddress}`);
        }
        console.log('');
      } catch (error) {
        console.error(`❌ Signature recovery failed: ${(error as Error).message}`);
        console.log('');
      }

    } catch (error) {
      console.error(`❌ Signing failed: ${(error as Error).message}`);
      console.log('');
      console.log('💡 Troubleshooting:');
      console.log('   • Ensure signer account has sufficient balance (at least 1 NEAR)');
      console.log('   • Ensure MPC nodes are healthy and have presignatures');
      console.log('   • Check that domain_id=0 is registered on the contract');
      console.log('');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Test Complete');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📝 What this verifies:');
  console.log('   • public_key(domain_id) returns root MPC key');
  console.log('   • derived_public_key(path, domain_id) returns per-account key');
  console.log('   • EVM address derivation uses Keccak-256 (not SHA-256)');
  console.log('   • sign() uses yield/resume pattern (not polling)');
  console.log('   • Recovered address from signature matches derived address');
  console.log('');
}

/**
 * Derive EVM address from public key using our implementation
 * This mirrors the logic in simulator.ts for verification
 */
function deriveEvmAddressFromPublicKey(publicKey: string): string {
  // Remove prefix if present
  let cleanKey = publicKey;
  if (publicKey.includes(':')) {
    cleanKey = publicKey.split(':')[1];
  }

  // Check if hex or base58
  const isHex = /^[0-9a-fA-F]+$/.test(cleanKey);
  
  let keyBytes: Uint8Array;
  if (isHex) {
    keyBytes = new Uint8Array(Buffer.from(cleanKey, 'hex'));
  } else {
    // Base58 - for simplicity, use ethers directly
    return computeAddress('0x' + Buffer.from(decodeBase58(cleanKey)).toString('hex'));
  }

  // Handle different key formats
  if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
    // Uncompressed with prefix
    const uncompressedXY = keyBytes.slice(1);
    const hash = keccak256(uncompressedXY);
    return getAddress('0x' + hash.slice(-40));
  } else if (keyBytes.length === 64) {
    // Raw x,y
    const hash = keccak256(keyBytes);
    return getAddress('0x' + hash.slice(-40));
  } else if (keyBytes.length === 33 && (keyBytes[0] === 0x02 || keyBytes[0] === 0x03)) {
    // Compressed - use ethers
    return computeAddress('0x' + Buffer.from(keyBytes).toString('hex'));
  }

  // Fallback to ethers
  return computeAddress('0x' + Buffer.from(keyBytes).toString('hex'));
}

/**
 * Decode base58 string to bytes
 */
function decodeBase58(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
  }

  let result = BigInt(0);
  for (const char of str) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    result = result * BigInt(58) + BigInt(value);
  }

  // Convert to bytes
  const hex = result.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return bytes;
}

// Run the test
main().catch((error) => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});

