/**
 * Orchestrator Tests
 * 
 * Tests for LocalnetOrchestrator connecting to EC2 localnet
 * 
 * Prerequisites:
 * - EC2 NEAR node running at NEAR_RPC_URL
 * - AWS credentials configured
 * - DEPLOYER_KMS_KEY_ID environment variable set
 */

import { LocalnetOrchestrator } from '../localnet/orchestrator';
import { getNearRpcUrl, getDeployerKmsKeyId } from '../config';

describe('Localnet Orchestrator', () => {
  let orchestrator: LocalnetOrchestrator;

  beforeAll(() => {
    const kmsKeyId = getDeployerKmsKeyId();
    if (!kmsKeyId) {
      throw new Error('DEPLOYER_KMS_KEY_ID environment variable is required for tests');
    }

    orchestrator = new LocalnetOrchestrator({
      rpcUrl: getNearRpcUrl(),
      networkId: 'localnet',
      kmsKeyId,
    });
  });

  describe('Infrastructure Startup', () => {
    it('should connect and deploy to EC2 localnet', async () => {
      // Note: This is an integration test that requires:
      // 1. EC2 NEAR node running
      // 2. AWS KMS access
      // 3. Contract WASM file
      // 4. Docker for MPC nodes
      
      // This test may take a while and should be run manually
      // Skip in CI/CD unless all prerequisites are met
      
      if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
        console.log('⚠️  Skipping integration test (SKIP_INTEGRATION_TESTS=true)');
        return;
      }

      const config = await orchestrator.start();
      
      expect(config.rpcUrl).toBe(getNearRpcUrl());
      expect(config.mpcContractId).toBe('v1.signer.node0');
      expect(config.mpcNodes.length).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout for full deployment

    it('should stop infrastructure', async () => {
      if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
        return;
      }

      await expect(orchestrator.stop()).resolves.not.toThrow();
    });
  });
});

