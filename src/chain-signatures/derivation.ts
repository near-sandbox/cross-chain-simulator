/**
 * Address Derivation Logic
 * 
 * Deterministic address derivation for various chains
 * Simulates MPC-based derivation for localnet testing
 */

import { createHash } from 'crypto';
import { SupportedChain, DerivedAddress } from '../types';

export class AddressDerivation {
  /**
   * Derive address for specific chain
   */
  static deriveAddress(
    nearAccount: string,
    chain: SupportedChain,
    customPath?: string
  ): DerivedAddress {
    const path = customPath || this.getDefaultPath(nearAccount, chain);
    const publicKey = this.derivePublicKey(nearAccount, path);
    const address = this.publicKeyToAddress(publicKey, chain);

    return {
      chain,
      address,
      publicKey,
      derivationPath: path,
    };
  }

  private static getDefaultPath(nearAccount: string, chain: SupportedChain): string {
    const chainId = this.getChainId(chain);
    return `${nearAccount},${chainId}`;
  }

  private static derivePublicKey(nearAccount: string, path: string): string {
    const hash = createHash('sha256')
      .update(`${nearAccount}:${path}`)
      .digest('hex');

    return '02' + hash.substring(0, 64);
  }

  private static publicKeyToAddress(publicKey: string, chain: SupportedChain): string {
    const hash = createHash('sha256')
      .update(publicKey)
      .digest('hex');

    switch (chain) {
      case 'bitcoin':
      case 'dogecoin':
        return this.toBech32Address(hash, chain);
      case 'ethereum':
      case 'polygon':
      case 'arbitrum':
      case 'optimism':
        return this.toEthereumAddress(hash);
      case 'ripple':
        return this.toRippleAddress(hash);
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  private static toBech32Address(hash: string, chain: SupportedChain): string {
    const prefix = chain === 'bitcoin' ? 'bc1' : 'dgb1';
    const addr = hash.substring(0, 40);
    return `${prefix}${addr}`;
  }

  private static toEthereumAddress(hash: string): string {
    const addr = hash.substring(hash.length - 40);
    return `0x${addr}`;
  }

  private static toRippleAddress(hash: string): string {
    const addr = hash.substring(0, 40);
    return `r${addr}`;
  }

  private static getChainId(chain: SupportedChain): number {
    const chainIds: Record<SupportedChain, number> = {
      bitcoin: 0,
      ethereum: 1,
      dogecoin: 3,
      ripple: 144,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
    };
    return chainIds[chain];
  }
}
