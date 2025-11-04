/**
 * Cross-chain and Chain Signatures types
 * Matches production Chain Signatures surface
 */

export type SupportedChain =
  | 'bitcoin'
  | 'ethereum'
  | 'dogecoin'
  | 'ripple'
  | 'polygon'
  | 'arbitrum'
  | 'optimism';

export interface DerivedAddress {
  chain: SupportedChain;
  address: string;
  publicKey: string;
  derivationPath: string;
}

export interface SignatureRequest {
  nearAccount: string;
  chain: SupportedChain;
  payload: string;
  derivationPath?: string;
}

export interface Signature {
  big_r: string;
  s: string;
  recovery_id?: number;
}

export interface SignatureResponse {
  signature: Signature;
  publicKey: string;
  signedPayload: string;
}

export interface IChainSignatures {
  deriveAddress(
    nearAccount: string,
    chain: SupportedChain,
    path?: string
  ): Promise<DerivedAddress>;
  requestSignature(request: SignatureRequest): Promise<SignatureResponse>;
  verifySignature(response: SignatureResponse, payload: string): Promise<boolean>;
}

/**
 * Cross-chain execution adapter for simulating destination chain transactions
 */
export interface ICrossChainExec {
  simulateDestinationTx(params: {
    chain: SupportedChain;
    correlateTo: string;
  }): Promise<string>;
  estimateFees(params: {
    origin: string;
    dest: string;
    amount: string;
  }): Promise<{ fee: string; slippage: number }>;
}
