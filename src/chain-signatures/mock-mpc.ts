/**
 * Mock MPC Service
 * 
 * Simulates NEAR's 8-node MPC network for threshold signatures
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
