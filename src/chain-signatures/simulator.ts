/**
 * ChainSignaturesSimulator - Real MPC Integration
 * 
 * This implementation uses:
 * - Real MPC nodes from github.com/near/mpc
 * - Real v1.signer contract calls via NearClient
 * - Real threshold signature generation via MPCService
 */

import {
  IChainSignatures,
  ICrossChainExec,
  SupportedChain,
  DerivedAddress,
  SignatureRequest,
  SignatureResponse,
} from '../types';
import { LocalnetConfig } from '../config';
import { NearClient } from './near-client';
import { MPCService } from './mpc-service';
import { createHash } from 'crypto';
import { keccak256, getAddress, computeAddress } from 'ethers';

export class ChainSignaturesSimulator implements IChainSignatures, ICrossChainExec {
  private mpc: MPCService;
  private nearClient: NearClient;
  private addressCache: Map<string, DerivedAddress> = new Map();

  constructor(config: LocalnetConfig) {
    this.nearClient = new NearClient(
      config.rpcUrl,
      config.networkId,
      config.mpcContractId
    );
    this.mpc = new MPCService(config);
  }

  /**
   * Derive address on target chain for NEAR account
   * Uses real v1.signer contract to get MPC-derived public key
   */
  async deriveAddress(
    nearAccount: string,
    chain: SupportedChain,
    path?: string
  ): Promise<DerivedAddress> {
    const derivationPath = path || this.buildDefaultPath(nearAccount, chain);
    const cacheKey = `${nearAccount}:${chain}:${derivationPath}`;

    if (this.addressCache.has(cacheKey)) {
      return this.addressCache.get(cacheKey)!;
    }

    console.log('🔗 [CHAIN SIG] Deriving address:', {
      nearAccount,
      chain,
      path: derivationPath,
    });

    try {
      // Call v1.signer contract to get MPC-derived public key
      const publicKey = await this.nearClient.callPublicKey(derivationPath);

      // Convert MPC public key to chain-specific address
      const address = this.publicKeyToAddress(publicKey, chain);

      const derived: DerivedAddress = {
        chain,
        address,
        publicKey,
        derivationPath,
      };

      this.addressCache.set(cacheKey, derived);

      console.log('✅ [CHAIN SIG] Address derived:', {
        chain,
        address,
      });

      return derived;
    } catch (error) {
      console.error('❌ [CHAIN SIG] Address derivation failed:', error);
      throw error;
    }
  }

  /**
   * Build default derivation path
   * 
   * Per NEAR docs, the path is a user-defined string like "ethereum-1", "bitcoin-main".
   * The contract uses: root_key + path + predecessor to derive the address.
   * 
   * @see https://docs.near.org/chain-abstraction/chain-signatures/getting-started
   */
  private buildDefaultPath(nearAccount: string, chain: SupportedChain): string {
    // NEAR docs example format: "ethereum-1", "bitcoin-main"
    // We use a deterministic format based on account + chain for uniqueness
    return `${chain}-${nearAccount}`;
  }

  /**
   * Convert MPC public key to chain-specific address
   * 
   * For EVM chains: Uses Keccak-256 of the uncompressed public key (64 bytes),
   * then takes the last 20 bytes as the address. This matches ethers.computeAddress().
   */
  private publicKeyToAddress(publicKey: string, chain: SupportedChain): string {
    switch (chain) {
      case 'ethereum':
      case 'polygon':
      case 'arbitrum':
      case 'optimism':
        return this.toEvmAddress(publicKey);
      case 'bitcoin':
      case 'dogecoin':
        return this.toBech32Address(publicKey, chain);
      case 'ripple':
        return this.toRippleAddress(publicKey);
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  /**
   * Convert MPC public key to EVM address (Ethereum, Polygon, Arbitrum, Optimism)
   * 
   * EVM standard:
   * 1. Take uncompressed public key (65 bytes with 04 prefix, or 64 bytes raw x,y)
   * 2. Keccak-256 hash of the 64-byte x,y coordinates
   * 3. Take the last 20 bytes (40 hex chars) as the address
   * 4. Apply EIP-55 checksum casing
   */
  private toEvmAddress(publicKey: string): string {
    // Remove 'secp256k1:' or 'ed25519:' prefix if present (NEAR key format)
    let cleanKey = publicKey;
    if (publicKey.includes(':')) {
      cleanKey = publicKey.split(':')[1];
    }

    // Check if hex or base58
    const isHex = /^[0-9a-fA-F]+$/.test(cleanKey);
    
    let keyBytes: Uint8Array;
    if (isHex) {
      keyBytes = Buffer.from(cleanKey, 'hex');
    } else {
      // Base58 encoded - decode it
      keyBytes = this.decodeBase58(cleanKey);
    }

    // Handle different key formats:
    // - 65 bytes: 04 prefix + 64 bytes (x,y) - use 64 bytes
    // - 64 bytes: raw x,y coordinates - use as-is
    // - 33 bytes: compressed (02/03 prefix + 32 bytes x) - need to decompress
    let uncompressedXY: Uint8Array;
    
    if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
      // Uncompressed with prefix: skip the 04 prefix
      uncompressedXY = keyBytes.slice(1);
    } else if (keyBytes.length === 64) {
      // Already raw x,y
      uncompressedXY = keyBytes;
    } else if (keyBytes.length === 33 && (keyBytes[0] === 0x02 || keyBytes[0] === 0x03)) {
      // Compressed key - use ethers computeAddress which handles this
      const hexKey = '0x' + Buffer.from(keyBytes).toString('hex');
      return computeAddress(hexKey);
    } else {
      // Fallback: try to use ethers directly with whatever we have
      const hexKey = '0x' + Buffer.from(keyBytes).toString('hex');
      try {
        return computeAddress(hexKey);
      } catch {
        throw new Error(`Unsupported public key format: length=${keyBytes.length}`);
      }
    }

    // Keccak-256 hash of the 64-byte x,y coordinates
    const hash = keccak256(uncompressedXY);
    
    // Take last 20 bytes (40 hex chars) and apply checksum
    const addressLower = '0x' + hash.slice(-40);
    
    // Apply EIP-55 checksum casing
    return getAddress(addressLower);
  }

  /**
   * Decode base58 string to bytes (for NEAR public key format)
   */
  private decodeBase58(str: string): Uint8Array {
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

  private toBech32Address(publicKey: string, chain: SupportedChain): string {
    // For Bitcoin/Dogecoin, use SHA-256 + RIPEMD-160 (placeholder)
    // Full BIP-0173 bech32 implementation needed for production
    const hash = createHash('sha256')
      .update(Buffer.from(publicKey, 'hex'))
      .digest('hex');
    const prefix = chain === 'bitcoin' ? 'bc1q' : 'dgb1q';
    const addr = hash.substring(0, 38);
    return `${prefix}${addr}`;
  }

  private toRippleAddress(publicKey: string): string {
    // Ripple uses similar to Bitcoin but with different alphabet
    const hash = createHash('sha256')
      .update(Buffer.from(publicKey, 'hex'))
      .digest('hex');
    return `r${hash.substring(0, 33)}`;
  }

  /**
   * Request signature for cross-chain transaction
   */
  async requestSignature(request: SignatureRequest): Promise<SignatureResponse> {
    console.log('📝 [CHAIN SIG] Signature request:', {
      account: request.nearAccount,
      chain: request.chain,
    });

    const derived = await this.deriveAddress(
      request.nearAccount,
      request.chain,
      request.derivationPath
    );

    const signature = await this.mpc.generateSignature(request);

    return {
      signature,
      publicKey: derived.publicKey,
      signedPayload: request.payload,
    };
  }

  /**
   * Verify signature validity
   */
  async verifySignature(response: SignatureResponse, payload: string): Promise<boolean> {
    return this.mpc.verifySignature(response.signature, payload, response.publicKey);
  }

  /**
   * Simulate destination chain transaction
   */
  async simulateDestinationTx(params: {
    chain: SupportedChain;
    correlateTo: string;
  }): Promise<string> {
    const prefix = {
      ethereum: '0x',
      polygon: '0x',
      arbitrum: '0x',
      optimism: '0x',
      bitcoin: '',
      dogecoin: '',
      ripple: 'r',
    }[params.chain] || '';

    const hash = createHash('sha256')
      .update(`${params.chain}:${params.correlateTo}`)
      .digest('hex');

    return prefix + hash.substring(0, 64);
  }

  /**
   * Estimate fees for cross-chain operation
   */
  async estimateFees(params: {
    origin: string;
    dest: string;
    amount: string;
  }): Promise<{ fee: string; slippage: number }> {
    // Simplified fee model
    const amountNum = parseFloat(params.amount);
    const fee = (amountNum * 0.003).toString(); // 0.3% fee
    const slippage = 0.01; // 1% slippage

    return { fee, slippage };
  }
}
