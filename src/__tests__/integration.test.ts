/**
 * Integration tests for real MPC functionality
 * 
 * These tests require:
 * - NEAR localnet running at http://localhost:3030
 * - MPC nodes running (via npm run start:mpc)
 * - v1.signer.node0 contract deployed
 * 
 * To run integration tests:
 * 1. Start NEAR localnet
 * 2. Deploy v1.signer contract
 * 3. Start MPC nodes: npm run start:mpc
 * 4. Run tests: npm test
 */

import { ChainSignaturesSimulator } from '../chain-signatures/simulator';
import { LocalnetConfig, getNearRpcUrl, getMpcContractId, getMpcNodes } from '../config';
import { SupportedChain } from '../types';

describe('MPC Integration Tests', () => {
  let config: LocalnetConfig;
  let simulator: ChainSignaturesSimulator;

  beforeAll(() => {
    // Use environment defaults or provided config
    config = {
      rpcUrl: getNearRpcUrl(),
      networkId: 'localnet',
      mpcContractId: getMpcContractId(),
      mpcNodes: getMpcNodes(),
    };

    simulator = new ChainSignaturesSimulator(config);
  });

  describe('NEAR RPC Connection', () => {
    it('should connect to NEAR localnet', async () => {
      // Test that we can initialize the NEAR client
      // This will fail if NEAR RPC is not accessible
      const nearClient = (simulator as any).nearClient;
      await expect(nearClient.initialize()).resolves.not.toThrow();
    });

    it('should verify MPC contract is accessible', async () => {
      const nearClient = (simulator as any).nearClient;
      await nearClient.initialize();
      
      // Try to call a view function to verify contract exists
      // This will fail if contract is not deployed
      await expect(
        nearClient.callPublicKey('test.account.near,1')
      ).resolves.toBeDefined();
    });
  });

  describe('MPC Node Connectivity', () => {
    it('should verify MPC nodes are accessible', async () => {
      for (const nodeUrl of config.mpcNodes) {
        const response = await fetch(`${nodeUrl}/health`);
        expect(response.ok).toBe(true);
      }
    });
  });

  describe('Address Derivation', () => {
    const testAccount = 'alice.near';
    const testChains: SupportedChain[] = ['ethereum', 'bitcoin', 'polygon'];

    test.each(testChains)('should derive address for %s', async (chain) => {
      const result = await simulator.deriveAddress(testAccount, chain);
      
      expect(result).toBeDefined();
      expect(result.chain).toBe(chain);
      expect(result.address).toBeDefined();
      expect(result.publicKey).toBeDefined();
      expect(result.derivationPath).toBeDefined();
      
      // Verify address format
      if (chain === 'ethereum' || chain === 'polygon') {
        expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      } else if (chain === 'bitcoin') {
        expect(result.address).toMatch(/^bc1[a-z0-9]+$/);
      }
    });

    it('should cache derived addresses', async () => {
      const result1 = await simulator.deriveAddress(testAccount, 'ethereum');
      const result2 = await simulator.deriveAddress(testAccount, 'ethereum');
      
      expect(result1).toEqual(result2);
    });

    it('should use custom derivation path when provided', async () => {
      const customPath = 'custom.path.test';
      const result = await simulator.deriveAddress(
        testAccount,
        'ethereum',
        customPath
      );
      
      expect(result.derivationPath).toBe(customPath);
    });
  });

  describe('Signature Generation', () => {
    const testAccount = 'alice.near';
    const testPayload = '0x1234567890abcdef';

    it('should generate signature for ethereum', async () => {
      const request = {
        nearAccount: testAccount,
        chain: 'ethereum' as SupportedChain,
        payload: testPayload,
      };

      const response = await simulator.requestSignature(request);
      
      expect(response).toBeDefined();
      expect(response.signature).toBeDefined();
      expect(response.signature.big_r).toBeDefined();
      expect(response.signature.s).toBeDefined();
      expect(response.publicKey).toBeDefined();
      expect(response.signedPayload).toBe(testPayload);
    });

    it('should verify generated signature', async () => {
      const request = {
        nearAccount: testAccount,
        chain: 'ethereum' as SupportedChain,
        payload: testPayload,
      };

      const response = await simulator.requestSignature(request);
      const isValid = await simulator.verifySignature(response, testPayload);
      
      expect(isValid).toBe(true);
    });
  });

  describe('Cross-Chain Execution', () => {
    it('should simulate destination transaction', async () => {
      const result = await simulator.simulateDestinationTx({
        chain: 'ethereum',
        correlateTo: 'test-tx-hash',
      });
      
      expect(result).toBeDefined();
      expect(result).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    it('should estimate fees', async () => {
      const result = await simulator.estimateFees({
        origin: 'near',
        dest: 'ethereum',
        amount: '1000000000000000000', // 1 ETH
      });
      
      expect(result).toBeDefined();
      expect(result.fee).toBeDefined();
      expect(result.slippage).toBeDefined();
      expect(typeof result.slippage).toBe('number');
    });
  });
});

