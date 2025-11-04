/**
 * Factory for creating Chain Signatures client (simulator or production)
 */

import { getConfig } from './config';
import { ChainSignaturesSimulator } from './chain-signatures/simulator';
import { IChainSignatures, ICrossChainExec, SupportedChain, DerivedAddress, SignatureRequest, SignatureResponse } from './types';

export class ProductionMPCClient implements IChainSignatures, ICrossChainExec {
  async deriveAddress(nearAccount: string, chain: SupportedChain, path?: string): Promise<DerivedAddress> {
    throw new Error('Production client not yet implemented');
  }
  async requestSignature(request: SignatureRequest): Promise<SignatureResponse> {
    throw new Error('Production client not yet implemented');
  }
  async verifySignature(response: SignatureResponse, payload: string): Promise<boolean> {
    throw new Error('Production client not yet implemented');
  }
  async simulateDestinationTx(params: { chain: SupportedChain; correlateTo: string }): Promise<string> {
    throw new Error('Production client not yet implemented');
  }
  async estimateFees(params: { origin: string; dest: string; amount: string }): Promise<{ fee: string; slippage: number }> {
    throw new Error('Production client not yet implemented');
  }
}

export function createChainSignaturesClient(): IChainSignatures & ICrossChainExec {
  const config = getConfig();

  if (config.useSimulators) {
    return new ChainSignaturesSimulator();
  } else {
    return new ProductionMPCClient();
  }
}
