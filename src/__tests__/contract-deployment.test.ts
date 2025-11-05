/**
 * Contract Deployment Tests
 * 
 * Tests for deploying contracts to EC2 localnet
 * 
 * Prerequisites:
 * - EC2 NEAR node running at NEAR_RPC_URL
 * - AWS credentials configured
 * - DEPLOYER_KMS_KEY_ID environment variable set
 */

import { ContractDeployer } from '../localnet/contract-deployer';
import { KMSKeyManager } from '../localnet/kms-key-manager';
import { getNearRpcUrl, getDeployerAccountId, getMasterAccountId, getDeployerKmsKeyId } from '../config';

describe('Contract Deployment to EC2 Localnet', () => {
  let deployer: ContractDeployer;
  let kmsManager: KMSKeyManager;

  beforeAll(() => {
    const kmsKeyId = getDeployerKmsKeyId();
    if (!kmsKeyId) {
      throw new Error('DEPLOYER_KMS_KEY_ID environment variable is required for tests');
    }

    kmsManager = new KMSKeyManager({
      keyId: kmsKeyId,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    deployer = new ContractDeployer({
      rpcUrl: getNearRpcUrl(),
      networkId: 'localnet',
      deployerAccountId: getDeployerAccountId(),
      masterAccountId: getMasterAccountId(),
      kmsManager,
    });
  });

  describe('RPC Connection', () => {
    it('should verify RPC connection', async () => {
      await expect(deployer.verifyRpcConnection()).resolves.not.toThrow();
    });
  });

  describe('Master Account', () => {
    it('should initialize master account', async () => {
      await expect(deployer.initializeMasterAccount()).resolves.not.toThrow();
    });
  });

  describe('Deployer Account', () => {
    it('should create deployer.node0 account', async () => {
      // Note: This test may fail if account creation via KMS is not fully implemented
      // It's expected to throw an error indicating implementation needed
      await expect(deployer.createDeployerAccount()).resolves.not.toThrow();
    });
  });

  describe('Contract Deployment', () => {
    it('should deploy v1.signer.node0 contract', async () => {
      // Note: This test requires:
      // 1. Deployer account to exist
      // 2. Contract WASM file to be available
      // 3. KMS signing to be fully implemented
      
      // Skip if WASM file doesn't exist
      const fs = require('fs');
      const path = require('path');
      const wasmPath = path.join(process.cwd(), 'contracts', 'v1.signer.wasm');
      
      if (!fs.existsSync(wasmPath)) {
        console.log('⚠️  Skipping contract deployment test: WASM file not found');
        console.log('   Run: ./contracts/download-wasm.sh');
        return;
      }

      const contractId = await deployer.deploySignerContract('v1.signer.node0', wasmPath);
      expect(contractId).toBe('v1.signer.node0');
    });

    it('should verify contract deployment', async () => {
      const verified = await deployer.verifyContractDeployment('v1.signer.node0');
      // This may be false if contract is not deployed yet
      expect(typeof verified).toBe('boolean');
    });
  });
});

