/**
 * NearClient - NEAR RPC client for v1.signer contract calls
 * 
 * This client connects to NEAR localnet and calls the v1.signer contract
 * for address derivation and signature requests.
 * 
 * Contract API (per NEAR docs and near/mpc):
 * - `public_key(domain_id: u32)` - returns the root MPC public key for a domain
 * - `derived_public_key(path: string, domain_id: u32)` - derives a child key for path
 * - `sign(request: SignRequest)` - yields, MPC signs, resumes with signature
 * 
 * @see https://docs.near.org/chain-abstraction/chain-signatures/getting-started
 */

import { connect, Near, Account, keyStores, KeyPair } from 'near-api-js';
import { SignatureRequest } from '../types';

// Domain IDs per NEAR Chain Signatures spec
export const DOMAIN_SECP256K1 = 0; // EVM chains (Ethereum, Polygon, Arbitrum, etc.)
export const DOMAIN_ED25519 = 1;   // Ed25519 chains (future)

export interface SignRequestParams {
  path: string;
  payload: Uint8Array | number[]; // 32-byte hash as array
  domainId?: number;
}

/**
 * Response from derived_public_key view call
 */
export interface DerivedPublicKeyResponse {
  public_key: string;
}

/**
 * Response from public_key view call (root key)
 */
export interface RootPublicKeyResponse {
  public_key: string;
}

/**
 * MPC Signature returned from sign function call
 * The contract yields/resumes and returns this in the transaction result
 */
export interface MPCSignature {
  big_r: {
    affine_point: string; // Hex encoded
  };
  s: {
    scalar: string; // Hex encoded
  };
  recovery_id: number;
}

export class NearClient {
  private near: Near | null = null;
  private viewAccount: Account | null = null;
  private signerAccount: Account | null = null;
  private signerKeyPair: KeyPair | null = null;

  constructor(
    private rpcUrl: string,
    private networkId: string,
    private mpcContractId: string,
    private signerAccountId?: string,
    private signerPrivateKey?: string
  ) {}

  /**
   * Initialize NEAR connection
   * Creates a view-only account for queries and optionally a signer account for transactions
   */
  async initialize(): Promise<void> {
    if (this.near) {
      return; // Already initialized
    }

    try {
      const keyStore = new keyStores.InMemoryKeyStore();
      
      // If signer credentials provided, add them to keystore
      if (this.signerAccountId && this.signerPrivateKey) {
        this.signerKeyPair = KeyPair.fromString(this.signerPrivateKey as `ed25519:${string}`);
        await keyStore.setKey(this.networkId, this.signerAccountId, this.signerKeyPair);
      }

      const config = {
        networkId: this.networkId,
        nodeUrl: this.rpcUrl,
        keyStore,
        headers: {},
      };

      this.near = await connect(config);
      
      // View account for read-only calls (uses contract ID as placeholder)
      this.viewAccount = await this.near.account(this.mpcContractId);
      
      // Signer account for function calls (if credentials provided)
      if (this.signerAccountId) {
        this.signerAccount = await this.near.account(this.signerAccountId);
      }
      
      console.log('✅ [NEAR CLIENT] Connected to NEAR:', {
        rpcUrl: this.rpcUrl,
        networkId: this.networkId,
        contractId: this.mpcContractId,
        signerAccount: this.signerAccountId || 'none (view-only)',
      });
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to connect:', error);
      throw new Error(`Failed to connect to NEAR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get root MPC public key for a domain
   * 
   * @param domainId - 0 for Secp256k1 (EVM), 1 for Ed25519
   */
  async getRootPublicKey(domainId: number = DOMAIN_SECP256K1): Promise<string> {
    await this.initialize();

    if (!this.viewAccount) {
      throw new Error('NEAR client not initialized');
    }

    try {
      console.log('🔑 [NEAR CLIENT] Calling public_key:', { domainId });

      const result = await this.viewAccount.viewFunction({
        contractId: this.mpcContractId,
        methodName: 'public_key',
        args: { domain_id: domainId },
      }) as RootPublicKeyResponse;

      console.log('✅ [NEAR CLIENT] Root public key:', {
        domainId,
        publicKey: result.public_key.substring(0, 30) + '...',
      });

      return result.public_key;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to call public_key:', error);
      throw new Error(`Failed to get root public key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Derive MPC public key for a given path and domain
   * 
   * Per NEAR docs, the derived key is computed from:
   * root_key + path + predecessor_account_id
   * 
   * @param path - User-defined derivation path (e.g., "ethereum-1")
   * @param domainId - 0 for Secp256k1 (EVM), 1 for Ed25519
   * @param predecessorId - Account ID of the caller (for derivation)
   */
  async callDerivedPublicKey(
    path: string,
    domainId: number = DOMAIN_SECP256K1,
    predecessorId?: string
  ): Promise<string> {
    await this.initialize();

    if (!this.viewAccount) {
      throw new Error('NEAR client not initialized');
    }

    try {
      console.log('🔑 [NEAR CLIENT] Calling derived_public_key:', { path, domainId, predecessorId });

      const args: Record<string, unknown> = {
        path,
        domain_id: domainId,
      };
      
      // predecessor_id is optional - if not provided, contract uses tx predecessor
      if (predecessorId) {
        args.predecessor_id = predecessorId;
      }

      const result = await this.viewAccount.viewFunction({
        contractId: this.mpcContractId,
        methodName: 'derived_public_key',
        args,
      }) as DerivedPublicKeyResponse;

      console.log('✅ [NEAR CLIENT] Derived public key:', {
        path,
        publicKey: result.public_key.substring(0, 30) + '...',
      });

      return result.public_key;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to call derived_public_key:', error);
      throw new Error(`Failed to derive public key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Legacy method for backwards compatibility
   * Calls derived_public_key with Secp256k1 domain
   */
  async callPublicKey(path: string): Promise<string> {
    return this.callDerivedPublicKey(path, DOMAIN_SECP256K1);
  }

  /**
   * Call v1.signer contract's sign method
   * 
   * The contract uses yield/resume pattern:
   * 1. sign() is called with payload + path + domain_id
   * 2. Contract yields execution
   * 3. MPC nodes observe and compute threshold signature
   * 4. MPC nodes call resume() with the signature
   * 5. Original sign() call completes and returns signature
   * 
   * @param params - Sign request parameters
   * @returns MPCSignature - The signature (r, s, recovery_id)
   */
  async callSign(params: SignRequestParams): Promise<MPCSignature> {
    await this.initialize();

    if (!this.signerAccount) {
      throw new Error('NEAR client not initialized with signer credentials');
    }

    try {
      // Convert payload to array format if needed
      const payloadArray = Array.isArray(params.payload) 
        ? params.payload 
        : Array.from(params.payload);

      console.log('📝 [NEAR CLIENT] Calling sign:', {
        path: params.path,
        payloadLength: payloadArray.length,
        domainId: params.domainId ?? DOMAIN_SECP256K1,
      });

      // Build the sign request args per contract API
      const signArgs = {
        request: {
          payload: payloadArray,
          path: params.path,
          domain_id: params.domainId ?? DOMAIN_SECP256K1,
        },
      };

      // Required deposit for sign request (per NEAR docs)
      // The exact amount may vary - 1 NEAR should be sufficient for most cases
      const SIGN_DEPOSIT = BigInt('1000000000000000000000000'); // 1 NEAR in yocto

      // Call the sign method - this will yield until MPC completes
      const result = await this.signerAccount.functionCall({
        contractId: this.mpcContractId,
        methodName: 'sign',
        args: signArgs,
        gas: BigInt('300000000000000'), // 300 TGas
        attachedDeposit: SIGN_DEPOSIT,
      });

      // Parse signature from transaction result
      // The contract returns the signature in the function call result
      const signature = this.parseSignatureFromResult(result);
      
      console.log('✅ [NEAR CLIENT] Sign completed:', {
        recovery_id: signature.recovery_id,
      });

      return signature;
    } catch (error) {
      console.error('❌ [NEAR CLIENT] Failed to call sign:', error);
      throw new Error(`Failed to request signature: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse MPCSignature from transaction result
   * The contract returns the signature as the return value of the function call
   */
  private parseSignatureFromResult(result: unknown): MPCSignature {
    // The result structure from functionCall contains receipts_outcome
    // with the return value in the last successful receipt
    const txResult = result as {
      receipts_outcome: Array<{
        outcome: {
          status: {
            SuccessValue?: string;
            Failure?: unknown;
          };
        };
      }>;
    };

    for (const receipt of txResult.receipts_outcome) {
      if (receipt.outcome.status.SuccessValue) {
        // Decode base64 return value
        const decoded = Buffer.from(receipt.outcome.status.SuccessValue, 'base64').toString('utf8');
        try {
          const parsed = JSON.parse(decoded);
          
          // Handle different response formats
          if (parsed.big_r && parsed.s) {
            return {
              big_r: parsed.big_r,
              s: parsed.s,
              recovery_id: parsed.recovery_id ?? 0,
            };
          }
          
          // Some versions return nested structure
          if (parsed.Ok) {
            return {
              big_r: parsed.Ok.big_r,
              s: parsed.Ok.s,
              recovery_id: parsed.Ok.recovery_id ?? 0,
            };
          }
        } catch {
          // Not JSON, continue
        }
      }
    }

    throw new Error('Failed to parse signature from transaction result');
  }
}

