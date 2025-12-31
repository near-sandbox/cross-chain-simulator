/**
 * Localnet Orchestrator
 * 
 * Coordinates connection to EC2 NEAR localnet RPC, contract deployment, and MPC node startup.
 * Note: EC2 NEAR node is deployed separately via /AWSNodeRunner/lib/near
 */

import { ContractDeployer } from './contract-deployer';
import { KMSKeyManager } from './kms-key-manager';
import { MpcSetup, MpcSetupOptions } from './mpc-setup';
import { InfrastructureConfigReader } from '../aws/infrastructure-config';
import { LocalnetConfig, getNearRpcUrl, getMpcContractId, getMpcNodes, getDeployerAccountId, getMasterAccountId, getDeployerKmsKeyId, getMasterAccountKeyArn, getMpcStackName, getNearStackName, getAwsRegion, getAwsProfile } from '../config';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface OrchestratorConfig {
  rpcUrl?: string;
  networkId?: string;
  deployerAccountId?: string;
  masterAccountId?: string;
  kmsKeyId?: string;
  contractAccountId?: string;
  wasmPath?: string;
  // Optional: Pre-encrypted deployer private key (if deployer account already exists)
  encryptedDeployerPrivateKey?: string;
  // Optional: Master account key ARN from AWS Node Runner (preferred, production)
  masterAccountKeyArn?: string;
  // Optional: Master account private key (fallback for local dev only)
  masterAccountPrivateKey?: string;
  // Optional: AWS region for Secrets Manager (defaults to us-east-1)
  region?: string;
  // Optional: Use new MPC setup module (default: false, uses legacy deployer)
  useMpcSetup?: boolean;
  // Optional: Threshold for MPC signing (default: 2)
  mpcThreshold?: number;
}

export class LocalnetOrchestrator {
  private deployer: ContractDeployer;
  private config: LocalnetConfig;
  private masterAccountKeyArn?: string;
  private masterAccountPrivateKey?: string;
  private region: string;

  constructor(config: OrchestratorConfig = {}) {
    const rpcUrl = config.rpcUrl || getNearRpcUrl();
    const networkId = config.networkId || 'localnet';
    const deployerAccountId = config.deployerAccountId || getDeployerAccountId();
    const masterAccountId = config.masterAccountId || getMasterAccountId();
    const kmsKeyId = config.kmsKeyId || getDeployerKmsKeyId();
    this.region = config.region || process.env.AWS_REGION || 'us-east-1';

    // Determine which path we're using (MPC Setup is default)
    const useMpcSetup = config.useMpcSetup !== undefined 
      ? config.useMpcSetup 
      : process.env.USE_MPC_SETUP !== 'false';  // Defaults to true

    // Validate key source (must have one)
    const masterKeyArn = config.masterAccountKeyArn || getMasterAccountKeyArn();
    const masterKeyDirect = config.masterAccountPrivateKey;
    
    if (!masterKeyArn && !masterKeyDirect) {
      throw new Error(
        'Master account key required. Provide either:\n' +
        '  - masterAccountKeyArn (ARN from AWS Node Runner Secrets Manager) OR\n' +
        '  - masterAccountPrivateKey (local dev only, not recommended for production)\n' +
        'Set MASTER_ACCOUNT_KEY_ARN environment variable or pass via config.'
      );
    }

    if (masterKeyArn && masterKeyDirect) {
      console.warn('⚠️  [ORCHESTRATOR] Both masterAccountKeyArn and masterAccountPrivateKey provided. Using ARN (preferred).');
    }

    // Only require KMS and create ContractDeployer for legacy path
    if (!useMpcSetup) {
      if (!kmsKeyId) {
        throw new Error('KMS key ID is required for legacy ContractDeployer path. Set DEPLOYER_KMS_KEY_ID environment variable.');
    }

    const kmsManager = new KMSKeyManager({
      keyId: kmsKeyId,
      region: this.region,
    });

    this.deployer = new ContractDeployer({
      rpcUrl,
      networkId,
      deployerAccountId,
      masterAccountId,
      kmsManager,
      encryptedDeployerPrivateKey: config.encryptedDeployerPrivateKey,
    });
    } else {
      // MPC Setup path doesn't need ContractDeployer or KMS
      this.deployer = undefined as any; // Will not be used in MPC Setup path
    }

    // Store key source for later use in start()
    this.masterAccountKeyArn = masterKeyArn;
    this.masterAccountPrivateKey = masterKeyDirect;

    // Store MPC setup options
    (this as any).useMpcSetup = useMpcSetup;
    (this as any).mpcThreshold = config.mpcThreshold;

    this.config = {
      rpcUrl,
      networkId: 'localnet',
      mpcContractId: config.contractAccountId || getMpcContractId(),
      mpcNodes: getMpcNodes(),
    };
  }

  /**
   * Start full infrastructure: connect to EC2 RPC, deploy contracts, start MPC
   */
  async start(): Promise<LocalnetConfig> {
    console.log('🚀 [ORCHESTRATOR] Connecting to NEAR localnet and deploying infrastructure...');
    console.log('   RPC URL:', this.config.rpcUrl);
    console.log('   Contract:', this.config.mpcContractId);

    // Check if using new MPC setup module
    // DEFAULT TO TRUE for production-equivalent deployment
    const useMpcSetup = (this as any).useMpcSetup !== undefined 
      ? (this as any).useMpcSetup 
      : process.env.USE_MPC_SETUP !== 'false';  // Changed: Now defaults to TRUE

    if (useMpcSetup) {
      // Use new MPC setup module (reads from AWS infrastructure)
      // This is the PRODUCTION-EQUIVALENT path that:
      // - Initializes contract with init()
      // - Votes to add domains (Secp256k1 for ECDSA)
      // - Triggers distributed key generation
      // - Ready for signing after keys generate
      console.log('\n📦 [ORCHESTRATOR] Using MPC Setup module (production-equivalent path)...');
      return await this.setupMpcApplicationLayer();
    } else {
      // Legacy flow (uses contract deployer)
      // Only use if explicitly set USE_MPC_SETUP=false
      console.log('\n⚠️  [ORCHESTRATOR] Using legacy path (incomplete initialization)');
      console.log('   Set USE_MPC_SETUP=true for production-equivalent deployment');
      return await this.startLegacy();
    }
  }

  /**
   * Legacy start flow (uses ContractDeployer)
   */
  private async startLegacy(): Promise<LocalnetConfig> {
    // 1. Verify EC2 NEAR RPC is accessible
    console.log('\n📡 [ORCHESTRATOR] Verifying RPC connection...');
    await this.verifyRpcConnection();

    // 1.5. Retrieve and add master account key
    console.log('\n🔑 [ORCHESTRATOR] Retrieving master account key...');
    const masterKey = await this.getMasterAccountKey();
    await this.deployer.addMasterAccountKey(masterKey);

    // 2. Initialize master account (if needed)
    console.log('\n👤 [ORCHESTRATOR] Initializing master account...');
    await this.deployer.initializeMasterAccount();

    // 3. Create deployer account (if needed)
    console.log('\n🔑 [ORCHESTRATOR] Creating deployer account...');
    await this.deployer.createDeployerAccount();

    // 4. Deploy v1.signer contract (if not exists)
    console.log('\n📦 [ORCHESTRATOR] Deploying v1.signer contract...');
    const contractId = await this.deployer.deploySignerContract(
      this.config.mpcContractId,
      undefined // wasmPath - will use default contracts/v1.signer.wasm
    );

    // Update config with actual contract ID (may have changed if timestamped)
    this.config.mpcContractId = contractId;

    // 5. Start MPC nodes via Docker
    console.log('\n🔗 [ORCHESTRATOR] Starting MPC nodes...');
    await this.startMpcNodes(contractId);

    // 6. Wait for all services to be ready
    console.log('\n⏳ [ORCHESTRATOR] Waiting for services to be ready...');
    await this.healthCheck();

    console.log('\n✅ [ORCHESTRATOR] Infrastructure ready!');
    console.log('   Contract:', contractId);
    console.log('   MPC Nodes:', this.config.mpcNodes.join(', '));

    return {
      ...this.config,
      mpcContractId: contractId,
    };
  }

  /**
   * Setup MPC application layer on top of deployed infrastructure
   * Reads infrastructure state from AWS and configures the chain
   */
  async setupMpcApplicationLayer(): Promise<LocalnetConfig> {
    console.log('\n📡 [ORCHESTRATOR] Reading infrastructure state from AWS...');

    // 1. Get infrastructure configuration
    const reader = new InfrastructureConfigReader({
      region: this.region,
      profile: getAwsProfile(),
      nearStackName: getNearStackName(),
      mpcStackName: getMpcStackName(),
    });
    const infraConfig = await reader.getInfrastructureConfig();

    // 2. Get master account key
    console.log('\n🔑 [ORCHESTRATOR] Retrieving master account key...');
    const masterKey = await this.getMasterAccountKey();

    // 3. Setup MPC network (creates accounts, deploys contract, initializes)
    console.log('\n🔧 [ORCHESTRATOR] Setting up MPC network...');
    const mpcSetup = new MpcSetup({
      infrastructureConfig: infraConfig,
      masterAccountPrivateKey: masterKey,
      wasmPath: undefined, // Use default contracts/v1.signer.wasm
      threshold: (this as any).mpcThreshold || 2,
      region: this.region,
      profile: getAwsProfile(),
    });

    const result = await mpcSetup.setupMpcNetwork();

    // 4. Update config with actual values from infrastructure
    this.config.rpcUrl = infraConfig.near.rpcUrl;
    this.config.mpcContractId = result.contractId;
    this.config.mpcNodes = result.participants.map((p) => p.url);

    // 5. Wait for services to be ready
    console.log('\n⏳ [ORCHESTRATOR] Waiting for services to be ready...');
    await this.healthCheck();

    console.log('\n✅ [ORCHESTRATOR] MPC application layer ready!');
    console.log('   Contract:', result.contractId);
    console.log('   MPC Nodes:', this.config.mpcNodes.join(', '));
    console.log('   Participants:', result.participants.length);

    return {
      ...this.config,
      mpcContractId: result.contractId,
    };
  }

  /**
   * Stop MPC infrastructure (contracts persist on blockchain)
   */
  async stop(): Promise<void> {
    console.log('🛑 [ORCHESTRATOR] Stopping MPC infrastructure...');

    try {
      const path = require('path');
      const scriptPath = path.join(__dirname, '../../scripts/stop-mpc.sh');
      await execAsync(`bash ${scriptPath}`);
      console.log('✅ [ORCHESTRATOR] MPC nodes stopped');
    } catch (error) {
      console.error('❌ [ORCHESTRATOR] Failed to stop MPC nodes:', error);
      throw error;
    }
  }

  /**
   * Verify RPC connection
   */
  private async verifyRpcConnection(): Promise<void> {
    try {
      await this.deployer.verifyRpcConnection();
    } catch (error) {
      throw new Error(`RPC connection verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start MPC nodes via Docker
   */
  private async startMpcNodes(contractId: string): Promise<void> {
    try {
      // Set environment variables for MPC startup
      process.env.MPC_CONTRACT_ID = contractId;
      process.env.NEAR_RPC_URL = this.config.rpcUrl;

      const path = require('path');
      const scriptPath = path.join(__dirname, '../../scripts/start-mpc.sh');
      const { stdout, stderr } = await execAsync(`bash ${scriptPath}`);

      if (stderr && !stderr.includes('Warning')) {
        console.warn('⚠️  [ORCHESTRATOR] MPC startup warnings:', stderr);
      }

      console.log('✅ [ORCHESTRATOR] MPC nodes started');
    } catch (error: any) {
      console.error('❌ [ORCHESTRATOR] Failed to start MPC nodes:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve master account key from Secrets Manager or use direct key
   */
  private async getMasterAccountKey(): Promise<string> {
    // Prefer ARN (production mode)
    if (this.masterAccountKeyArn) {
      console.log('   Using Secrets Manager ARN:', this.masterAccountKeyArn);
      return await this.fetchKeyFromSecretsManager(this.masterAccountKeyArn);
    }
    
    // Fallback to direct key (local dev only)
    if (this.masterAccountPrivateKey) {
      console.warn('   ⚠️  Using direct private key (not recommended for production)');
      return this.masterAccountPrivateKey;
    }
    
    throw new Error('No master account key source available');
  }

  /**
   * Fetch master account key from AWS Secrets Manager
   */
  private async fetchKeyFromSecretsManager(arn: string): Promise<string> {
    try {
      const client = new SecretsManagerClient({ region: this.region });
      const command = new GetSecretValueCommand({ SecretId: arn });
      
      const response = await client.send(command);
      
      if (!response.SecretString) {
        throw new Error('Secret value is empty');
      }
      
      // Parse JSON secret (format: {"account": "test.near", "privateKey": "ed25519:..."})
      const secret = JSON.parse(response.SecretString);
      
      if (!secret.privateKey) {
        throw new Error('Secret does not contain privateKey field');
      }
      
      console.log('   ✅ Master account key retrieved from Secrets Manager');
      return secret.privateKey;
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        throw new Error(`Secret not found: ${arn}. Ensure AWS Node Runner has deployed and stored the master account key.`);
      }
      if (error.name === 'AccessDeniedException') {
        throw new Error(`Access denied to secret: ${arn}. Ensure IAM role has secretsmanager:GetSecretValue permission.`);
      }
      throw new Error(`Failed to retrieve master key from Secrets Manager: ${error.message}`);
    }
  }

  /**
   * Health check for all services
   */
  private async healthCheck(): Promise<void> {
    const maxAttempts = 30;
    const pollInterval = 2000; // 2 seconds

    // Check contract deployment
    console.log('   Checking contract deployment...');
    const useMpcSetup = (this as any).useMpcSetup !== undefined 
      ? (this as any).useMpcSetup 
      : process.env.USE_MPC_SETUP !== 'false';

    if (useMpcSetup) {
      // For MPC Setup path, verify contract via raw JSON-RPC (no keystore/signing required).
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const response = await fetch(this.config.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'mpc-healthcheck',
              method: 'query',
              params: {
                request_type: 'view_account',
                finality: 'final',
                account_id: this.config.mpcContractId,
              },
            }),
          });

          const json: any = await response.json();
          const codeHash = json?.result?.code_hash;
          if (codeHash && codeHash !== '11111111111111111111111111111111') {
            console.log('   ✅ Contract verified');
            break;
          }
        } catch (error: any) {
          if (i === maxAttempts - 1) {
            throw new Error(`Contract deployment verification timeout: ${error.message}`);
          }
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    } else {
      // Legacy path uses ContractDeployer
    for (let i = 0; i < maxAttempts; i++) {
      const verified = await this.deployer.verifyContractDeployment(this.config.mpcContractId);
      if (verified) {
        console.log('   ✅ Contract verified');
        break;
      }
      if (i === maxAttempts - 1) {
        throw new Error('Contract deployment verification timeout');
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // Check MPC nodes
    const mpcHealthMode =
      process.env.MPC_NODE_HEALTHCHECK ||
      (useMpcSetup ? 'best_effort' : 'strict');

    if (mpcHealthMode === 'skip' || mpcHealthMode === 'false') {
      console.log('   Skipping MPC node health checks (MPC_NODE_HEALTHCHECK=skip)');
      return;
    }

    console.log(`   Checking MPC nodes (${mpcHealthMode})...`);
    for (const nodeUrl of this.config.mpcNodes) {
      let ok = false;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const response = await fetch(`${nodeUrl}/health`);
          if (response.ok) {
            console.log(`   ✅ ${nodeUrl} ready`);
            ok = true;
            break;
          }
        } catch (error) {
          // ignore and retry below
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!ok) {
        const msg = `MPC node ${nodeUrl} health check failed`;
        if (mpcHealthMode === 'strict') {
          throw new Error(msg);
        }
        console.warn(`   ⚠️  ${msg} (continuing; likely VPC-only endpoint)`);
      }
    }
  }
}

