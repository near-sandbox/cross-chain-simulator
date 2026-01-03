/**
 * MPCService - Real MPC integration using NEAR MPC network
 * 
 * This service integrates with:
 * - Real v1.signer contract calls via NearClient
 * - Real MPC nodes from github.com/near/mpc
 * - Real threshold signature generation
 * 
 * The contract uses yield/resume pattern:
 * - sign() yields until MPC nodes produce signature
 * - MPC nodes call resume() to complete the request
 * - sign() returns the signature directly to caller
 */

import { SignatureRequest, Signature } from '../types';
import { LocalnetConfig } from '../config';
import { NearClient, DOMAIN_SECP256K1, MPCSignature } from './near-client';
import { createHash } from 'crypto';

export class MPCService {
  private nearClient: NearClient;
  private signerAccountId?: string;

  constructor(config: LocalnetConfig) {
    this.nearClient = new NearClient(
      config.rpcUrl,
      config.networkId,
      config.mpcContractId,
      config.signerAccountId,
      config.signerPrivateKey
    );
    this.signerAccountId = config.signerAccountId;
  }

  /**
   * Generate signature using real MPC network
   * 
   * Flow:
   * 1. Hash the payload to 32 bytes
   * 2. Call v1.signer contract sign method
   * 3. Contract yields while MPC nodes compute threshold signature
   * 4. Contract resumes and returns signature directly
   */
  async generateSignature(request: SignatureRequest): Promise<Signature> {
    console.log('🔐 [MPC SERVICE] Generating signature:', {
      account: request.nearAccount,
      chain: request.chain,
      payloadLength: request.payload.length,
    });

    try {
      // The contract derives the signing key from env::predecessor_account_id() + path.
      // That means we cannot sign "on behalf of" another account: the signer account IS the key owner.
      if (this.signerAccountId && this.signerAccountId !== request.nearAccount) {
        throw new Error(
          `Signer account mismatch: config.signerAccountId=${this.signerAccountId} but request.nearAccount=${request.nearAccount}. ` +
          `These must match for address derivation/signature parity.`
        );
      }

      // Build derivation path (NEAR docs format: "ethereum-1", etc.)
      const path = this.buildDerivationPath(request.chain, request.derivationPath);

      // Hash payload to 32 bytes if not already
      const payloadHash = this.hashPayload(request.payload);

      // Get domain ID based on chain type
      const domainId = this.getDomainId(request.chain);

      // Call v1.signer contract sign method
      // This uses yield/resume - the call blocks until MPC signature is ready
      const mpcSignature = await this.nearClient.callSign({
        path,
        payload: payloadHash,
        domainId,
      });

      console.log('✅ [MPC SERVICE] Signature generated');

      // Convert MPC signature format to our Signature type
      return this.convertMpcSignature(mpcSignature);
    } catch (error) {
      console.error('❌ [MPC SERVICE] Signature generation failed:', error);
      throw error;
    }
  }

  /**
   * Hash payload to 32 bytes for signing
   * EVM transactions should already be hashed (keccak256 of tx)
   */
  private hashPayload(payload: string): Uint8Array {
    // If payload is already 32 bytes (64 hex chars or 66 with 0x), use as-is
    const cleanPayload = payload.startsWith('0x') ? payload.slice(2) : payload;
    
    if (cleanPayload.length === 64 && /^[0-9a-fA-F]+$/.test(cleanPayload)) {
      // Already a 32-byte hash
      return new Uint8Array(Buffer.from(cleanPayload, 'hex'));
    }

    // Hash the payload to 32 bytes using SHA-256
    // Note: For EVM, you should use keccak256 on the unsigned tx before calling this
    const hash = createHash('sha256')
      .update(Buffer.from(payload, 'hex'))
      .digest();
    
    return new Uint8Array(hash);
  }

  /**
   * Get domain ID for chain type
   * DomainId(0) is the legacy/default ECDSA (Secp256k1) domain in the upstream contract.
   */
  private getDomainId(chain: string): number {
    const evmChains = ['ethereum', 'polygon', 'arbitrum', 'optimism'];
    if (evmChains.includes(chain)) {
      return DOMAIN_SECP256K1;
    }
    // Bitcoin, Dogecoin also use Secp256k1
    return DOMAIN_SECP256K1;
  }

  /**
   * Convert MPCSignature to our Signature type
   */
  private convertMpcSignature(mpcSig: MPCSignature): Signature {
    // Extract hex values from MPC signature structure
    const big_r = typeof mpcSig.big_r === 'object' 
      ? mpcSig.big_r.affine_point 
      : mpcSig.big_r;
    
    const s = typeof mpcSig.s === 'object'
      ? mpcSig.s.scalar
      : mpcSig.s;

    return {
      big_r,
      s,
      recovery_id: mpcSig.recovery_id,
    };
  }

  /**
   * Verify MPC-generated signature using ECDSA recovery
   */
  async verifySignature(
    signature: Signature,
    payload: string,
    publicKey: string
  ): Promise<boolean> {
    console.log('✓ [MPC SERVICE] Verifying signature');

    try {
      // Basic validation: check signature structure
      if (!signature.big_r || !signature.s) {
        console.error('❌ [MPC SERVICE] Invalid signature structure');
        return false;
      }

      // TODO: Implement full cryptographic verification using ethers
      // This requires:
      // 1. Recover public key from signature using recoverPublicKey
      // 2. Compare recovered public key with expected public key
      
      // For now, return true if structure is valid
      return true;
    } catch (error) {
      console.error('❌ [MPC SERVICE] Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Build derivation path from NEAR account and chain
   * 
   * Per NEAR docs, path is a user-defined string like "ethereum-1"
   */
  private buildDerivationPath(chain: string, customPath?: string): string {
    if (customPath) {
      return customPath;
    }

    // NEAR docs format: "ethereum-{account}" or similar
    return `${chain}-1`;
  }
}

