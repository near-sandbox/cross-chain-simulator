/**
 * Localnet Orchestrator
 * 
 * Coordinates connection to EC2 NEAR localnet RPC, contract deployment, and MPC network setup.
 * 
 * MPC is REQUIRED for Layer 3 Chain Signatures - there is no non-MPC path.
 * 
 * Note: EC2 NEAR node is deployed separately via /AWSNodeRunner/lib/near
 */

import { MpcSetup } from './mpc-setup';
import { InfrastructureConfigReader } from '../aws/infrastructure-config';
import { LocalnetConfig, getNearRpcUrl, getMpcContractId, getMpcNodes, getMasterAccountKeyArn, getMpcStackName, getNearStackName, getAwsProfile } from '../config';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface OrchestratorConfig {
  rpcUrl?: string;
  networkId?: string;
  contractAccountId?: string;
  wasmPath?: string;
  // Master account key ARN from AWS Node Runner (preferred, production)
  masterAccountKeyArn?: string;
  // Master account private key (fallback for local dev only)
  masterAccountPrivateKey?: string;
  // AWS region for Secrets Manager (defaults to us-east-1)
  region?: string;
  // Threshold for MPC signing (default: 2)
  mpcThreshold?: number;
}

export class LocalnetOrchestrator {
  private config: LocalnetConfig;
  private masterAccountKeyArn?: string;
  private masterAccountPrivateKey?: string;
  private region: string;
  private mpcThreshold: number;

  constructor(config: OrchestratorConfig = {}) {
    const rpcUrl = config.rpcUrl || getNearRpcUrl();
    this.region = config.region || process.env.AWS_REGION || 'us-east-1';
    this.mpcThreshold = config.mpcThreshold || 2;

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

    // Store key source for later use in start()
    this.masterAccountKeyArn = masterKeyArn;
    this.masterAccountPrivateKey = masterKeyDirect;

    this.config = {
      rpcUrl,
      networkId: 'localnet',
      mpcContractId: config.contractAccountId || getMpcContractId(),
      mpcNodes: getMpcNodes(),
    };
  }

  /**
   * Start full infrastructure: connect to EC2 RPC, deploy contracts, setup MPC network.
   * 
   * MPC is REQUIRED for Layer 3 Chain Signatures - this method always uses the MPC setup path.
   */
  async start(): Promise<LocalnetConfig> {
    console.log('🚀 [ORCHESTRATOR] Connecting to NEAR localnet and deploying infrastructure...');
    console.log('   RPC URL:', this.config.rpcUrl);
    console.log('   Contract:', this.config.mpcContractId);

    // MPC setup is the only supported path for Layer 3.
    // This path:
    // - Initializes contract with init()
    // - Votes to add domains (Secp256k1 for ECDSA)
    // - Triggers distributed key generation
    // - Ready for signing after keys generate
    console.log('\n📦 [ORCHESTRATOR] Setting up MPC network...');
    return await this.setupMpcApplicationLayer();
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
      threshold: this.mpcThreshold,
      region: this.region,
      profile: getAwsProfile(),
    });

    const result = await mpcSetup.setupMpcNetwork();

    // 4. Update config with actual values from infrastructure
    // IMPORTANT: Preserve an explicit local override (e.g., SSM port-forward to localhost)
    // so subsequent health checks keep using the reachable RPC URL from this process.
    const rpcOverride = (process.env.NEAR_RPC_URL || '').trim();
    if (!rpcOverride) {
      this.config.rpcUrl = infraConfig.near.rpcUrl;
    }
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

    // Check contract deployment via raw JSON-RPC (no keystore/signing required)
    console.log('   Checking contract deployment...');
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

    // Check MPC nodes (best_effort by default - VPC-only endpoints may not be reachable)
    const mpcHealthMode = process.env.MPC_NODE_HEALTHCHECK || 'best_effort';

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
        } catch {
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

