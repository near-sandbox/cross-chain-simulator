/**
 * NearClient - NEAR RPC client for v1.signer contract calls
 * 
 * This client connects to NEAR localnet and calls the v1.signer contract
 * for address derivation and signature requests.
 */

import { connect, Near, Account, keyStores } from 'near-api-js';
import { SignatureRequest } from '../types';

export interface SignRequestParams {
  path: string;
  payload: string;
  recipient?: string;
}

export interface PublicKeyResponse {
  public_key: string;
}

export interface SignResponse {
  signature_id: string;
  status: 'pending' | 'completed' | 'failed';
  signature?: {
    big_r: string;
    s: string;
    recovery_id?: number;
  };
}

export class NearClient {
  private near: Near | null = null;
  private account: Account | null = null;

  constructor(
    private rpcUrl: string,
    private networkId: string,
    private mpcContractId: string
  ) {}

  /**
   * Initialize NEAR connection
   */
  async initialize(): Promise<void> {
    if (this.near) {
      return; // Already initialized
    }

    try {
      const keyStore = new keyStores.InMemoryKeyStore();
      const config = {
        networkId: this.networkId,
        nodeUrl: this.rpcUrl,
        keyStore,
        headers: {},
      };

      this.near = await connect(config);
      this.account = await this.near.account(this.mpcContractId);
      
      console.log('✅ [NEAR CLIENT] Connected to NEAR:', {
        rpcUrl: this.rpcUrl,
        networkId: this.networkId,
        contractId: this.mpcContractId,
      });
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to connect:', error);
      throw new Error(`Failed to connect to NEAR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Call v1.signer contract's public_key method
   * Derives MPC public key for a given derivation path
   */
  async callPublicKey(path: string): Promise<string> {
    await this.initialize();

    if (!this.account) {
      throw new Error('NEAR client not initialized');
    }

    try {
      console.log('🔑 [NEAR CLIENT] Calling public_key:', { path });

      const result = await this.account.viewFunction({
        contractId: this.mpcContractId,
        methodName: 'public_key',
        args: { path },
      }) as PublicKeyResponse;

      console.log('✅ [NEAR CLIENT] Public key derived:', {
        path,
        publicKey: result.public_key.substring(0, 20) + '...',
      });

      return result.public_key;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to call public_key:', error);
      throw new Error(`Failed to derive public key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Call v1.signer contract's sign method
   * Requests MPC signature for a given payload
   */
  async callSign(params: SignRequestParams): Promise<string> {
    await this.initialize();

    if (!this.account) {
      throw new Error('NEAR client not initialized');
    }

    try {
      console.log('📝 [NEAR CLIENT] Calling sign:', {
        path: params.path,
        payloadLength: params.payload.length,
      });

      // Call the sign method on v1.signer contract
      // The contract will emit an event that the MPC indexer watches
      const result = await this.account.functionCall({
        contractId: this.mpcContractId,
        methodName: 'sign',
        args: {
          path: params.path,
          payload: params.payload,
          recipient: params.recipient,
        },
        gas: BigInt('300000000000000'), // 300 TGas
        attachedDeposit: BigInt('0'),
      });

      // Extract signature_id from transaction result
      // The transaction hash can be used to track the signature request
      const signatureId = result.transaction_outcome.id;
      
      console.log('✅ [NEAR CLIENT] Sign request submitted:', {
        signatureId: signatureId.substring(0, 20) + '...',
      });

      return signatureId;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to call sign:', error);
      throw new Error(`Failed to request signature: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Poll for signature completion
   * Checks if MPC network has completed the signature
   */
  async getSignatureStatus(signatureId: string): Promise<SignResponse> {
    await this.initialize();

    if (!this.account) {
      throw new Error('NEAR client not initialized');
    }

    try {
      const result = await this.account.viewFunction({
        contractId: this.mpcContractId,
        methodName: 'get_signature',
        args: { signature_id: signatureId },
      }) as SignResponse;

      return result;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to get signature status:', error);
      throw new Error(`Failed to get signature status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Wait for signature to complete
   * Polls until signature is ready or timeout
   */
  async waitForSignature(
    signatureId: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<SignResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getSignatureStatus(signatureId);

      if (status.status === 'completed' && status.signature) {
        console.log('✅ [NEAR CLIENT] Signature completed');
        return status;
      }

      if (status.status === 'failed') {
        throw new Error('Signature request failed');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Signature timeout after ${timeoutMs}ms`);
  }
}

