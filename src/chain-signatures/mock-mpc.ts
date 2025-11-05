/**
 * MockMPCService - TEMPORARY PLACEHOLDER
 * 
 * WARNING: This is a mock implementation that MUST be replaced with real
 * MPC node integration from https://github.com/near/mpc
 * 
 * TODO: Replace with real MPC integration that:
 * - Deploys 3-8 MPC nodes from near/mpc repository
 * - Connects to v1.signer-dev.testnet contract
 * - Performs real threshold signature generation
 * - Uses real Beaver triple generation
 * 
 * DO NOT use this mock for anything beyond basic interface testing.
 * 
 * Real implementation should:
 * - Integrate with NEAR MPC nodes from github.com/near/mpc
 * - Use real threshold ECDSA signatures (cait-sith)
 * - Perform real multi-round MPC protocol
 * - Generate real Beaver triples and presignatures
 * - Call v1.signer contract for signature storage
 */

import { createHash } from 'crypto';
import { SignatureRequest, Signature } from '../types';

export class MockMPCService {
  /**
   * Simulate MPC signature generation
   */
  async generateSignature(request: SignatureRequest): Promise<Signature> {
    console.log('🔐 [MPC] Generating signature:', {
      account: request.nearAccount,
      chain: request.chain,
      payloadLength: request.payload.length,
    });

    // Simulate MPC round delay
    await this.simulateMPCRounds();

    // Generate deterministic signature
    const signatureData = createHash('sha256')
      .update(request.payload)
      .update(request.nearAccount)
      .update(request.chain)
      .digest('hex');

    const signature: Signature = {
      big_r: signatureData.substring(0, 64),
      s: signatureData.substring(64, 128),
      recovery_id: 0,
    };

    console.log('✅ [MPC] Signature generated');

    return signature;
  }

  /**
   * Simulate MPC multi-round protocol
   */
  private async simulateMPCRounds(): Promise<void> {
    const rounds = 3;
    const delayPerRound = 100;

    for (let i = 0; i < rounds; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayPerRound));
      console.log(`  Round ${i + 1}/${rounds} complete`);
    }
  }

  /**
   * Verify MPC-generated signature
   */
  async verifySignature(
    signature: Signature,
    payload: string,
    publicKey: string
  ): Promise<boolean> {
    console.log('✓ [MPC] Signature verified');
    return true;
  }
}
