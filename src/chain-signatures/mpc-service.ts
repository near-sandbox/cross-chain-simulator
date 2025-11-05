/**
 * MPCService - Real MPC integration using NEAR MPC network
 * 
 * This service replaces MockMPCService and integrates with:
 * - Real v1.signer contract calls via NearClient
 * - Real MPC nodes from github.com/near/mpc
 * - Real threshold signature generation
 */

import { SignatureRequest, Signature } from '../types';
import { LocalnetConfig } from '../config';
import { NearClient } from './near-client';
import { createHash } from 'crypto';

export class MPCService {
  private nearClient: NearClient;

  constructor(config: LocalnetConfig) {
    this.nearClient = new NearClient(
      config.rpcUrl,
      config.networkId,
      config.mpcContractId
    );
  }

  /**
   * Generate signature using real MPC network
   * 1. Calls v1.signer contract sign method
   * 2. Waits for MPC network to process
   * 3. Retrieves completed signature
   */
  async generateSignature(request: SignatureRequest): Promise<Signature> {
    console.log('🔐 [MPC SERVICE] Generating signature:', {
      account: request.nearAccount,
      chain: request.chain,
      payloadLength: request.payload.length,
    });

    try {
      // Build derivation path
      const path = this.buildDerivationPath(
        request.nearAccount,
        request.chain,
        request.derivationPath
      );

      // Call v1.signer contract to request signature
      const signatureId = await this.nearClient.callSign({
        path,
        payload: request.payload,
      });

      // Wait for MPC network to complete signature
      // MPC nodes watch the contract and generate threshold signature
      const signResponse = await this.nearClient.waitForSignature(signatureId);

      if (!signResponse.signature) {
        throw new Error('Signature generation failed: no signature returned');
      }

      console.log('✅ [MPC SERVICE] Signature generated');

      return signResponse.signature;
    } catch (error) {
      console.error('❌ [MPC SERVICE] Signature generation failed:', error);
      throw error;
    }
  }

  /**
   * Verify MPC-generated signature
   * Note: Full verification requires the public key and payload
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

      // TODO: Implement full cryptographic verification
      // This requires:
      // 1. Recover public key from signature
      // 2. Verify signature against payload
      // 3. Compare recovered public key with expected public key
      
      // For now, return true if structure is valid
      // Real implementation should use crypto libraries to verify ECDSA signature
      return true;
    } catch (error) {
      console.error('❌ [MPC SERVICE] Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Build derivation path from NEAR account and chain
   */
  private buildDerivationPath(
    nearAccount: string,
    chain: string,
    customPath?: string
  ): string {
    if (customPath) {
      return customPath;
    }

    // Default path format: "{nearAccount},{chainId}"
    const chainId = this.getChainId(chain);
    return `${nearAccount},${chainId}`;
  }

  /**
   * Get chain ID for derivation path
   */
  private getChainId(chain: string): number {
    const chainIds: Record<string, number> = {
      bitcoin: 0,
      ethereum: 1,
      dogecoin: 3,
      ripple: 144,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
    };
    return chainIds[chain] || 0;
  }
}

