/**
 * Infrastructure Config Reader
 * 
 * Reads deployment state from AWS CloudFormation stacks and Secrets Manager
 * to build a complete infrastructure configuration for MPC setup.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import {
  EC2Client,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export interface MpcNodeInfo {
  accountId: string;
  privateIp: string;
  instanceId: string;
  publicKey?: string; // MPC account public key (from Secrets Manager)
}

export interface InfrastructureConfig {
  near: {
    rpcUrl: string;
    networkId: string;
    instanceId?: string;
    privateIp?: string;
  };
  mpc: {
    nodes: MpcNodeInfo[];
    contractId: string;
    stackName: string;
  };
  region: string;
}

export interface InfrastructureConfigReaderOptions {
  /** AWS region (default: us-east-1) */
  region?: string;
  /** AWS profile for credentials */
  profile?: string;
  /** NEAR stack name (default: near-localnet-sync) */
  nearStackName?: string;
  /** MPC stack name (default: MpcStandaloneStack) */
  mpcStackName?: string;
}

/**
 * Infrastructure Config Reader
 * 
 * Fetches deployment state from AWS to build infrastructure configuration
 */
export class InfrastructureConfigReader {
  private cloudFormationClient: CloudFormationClient;
  private ec2Client: EC2Client;
  private secretsManagerClient: SecretsManagerClient;
  private nearStackName: string;
  private mpcStackName: string;

  constructor(options: InfrastructureConfigReaderOptions = {}) {
    const region = options.region || process.env.AWS_REGION || 'us-east-1';
    const profile = options.profile || process.env.AWS_PROFILE;

    const clientConfig: any = { region };
    if (profile) {
      // Note: AWS SDK v3 uses credential providers, profile should be set via AWS_PROFILE env var
      // or AWS credentials file. SDK will automatically pick it up.
      console.log(`Using AWS profile: ${profile}`);
    }

    this.cloudFormationClient = new CloudFormationClient(clientConfig);
    this.ec2Client = new EC2Client(clientConfig);
    this.secretsManagerClient = new SecretsManagerClient(clientConfig);
    
    this.nearStackName = options.nearStackName || 'near-localnet-sync';
    this.mpcStackName = options.mpcStackName || 'MpcStandaloneStack';
    
    // Store region for later use
    (this as any).region = region;
  }

  /**
   * Get infrastructure configuration from AWS
   */
  async getInfrastructureConfig(): Promise<InfrastructureConfig> {
    console.log('📡 [INFRA-CONFIG] Reading infrastructure state from AWS...');
    console.log(`   NEAR Stack: ${this.nearStackName}`);
    console.log(`   MPC Stack: ${this.mpcStackName}`);

    // 1. Read NEAR stack outputs
    const nearConfig = await this.getNearConfig();
    console.log('✅ [INFRA-CONFIG] NEAR config loaded:', {
      rpcUrl: nearConfig.rpcUrl,
      networkId: nearConfig.networkId,
    });

    // 2. Read MPC stack outputs
    const mpcConfig = await this.getMpcConfig();
    console.log('✅ [INFRA-CONFIG] MPC config loaded:', {
      nodeCount: mpcConfig.nodes.length,
      contractId: mpcConfig.contractId,
    });

    return {
      near: nearConfig,
      mpc: mpcConfig,
      region: (this as any).region || 'us-east-1',
    };
  }

  /**
   * Get NEAR node configuration from CloudFormation stack
   */
  private async getNearConfig(): Promise<InfrastructureConfig['near']> {
    try {
      const command = new DescribeStacksCommand({
        StackName: this.nearStackName,
      });
      const response = await this.cloudFormationClient.send(command);

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(`Stack ${this.nearStackName} not found`);
      }

      const stack = response.Stacks[0];
      const outputs = stack.Outputs || [];

      // Extract outputs (case-insensitive matching for flexibility)
      const rpcUrlOutput = outputs.find(
        (o: any) => o.OutputKey?.toLowerCase().includes('rpcurl') || 
                    o.OutputKey === 'NearLocalnetRpcUrl' || 
                    o.OutputKey === 'RpcUrl'
      );
      const networkIdOutput = outputs.find(
        (o: any) => o.OutputKey?.toLowerCase().includes('networkid') ||
                    o.OutputKey === 'NearLocalnetNetworkId' || 
                    o.OutputKey === 'NetworkId'
      );
      const instanceIdOutput = outputs.find(
        (o: any) => o.OutputKey?.toLowerCase().includes('instanceid') ||
                    o.OutputKey === 'NearLocalnetInstanceId' || 
                    o.OutputKey === 'InstanceId'
      );
      const privateIpOutput = outputs.find(
        (o: any) => o.OutputKey?.toLowerCase().includes('privateip') ||
                    o.OutputKey === 'NearLocalnetInstancePrivateIp' || 
                    o.OutputKey === 'PrivateIp'
      );

      const rpcUrl = rpcUrlOutput?.OutputValue || 'http://localhost:3030';
      const networkId = networkIdOutput?.OutputValue || 'localnet';
      const instanceId = instanceIdOutput?.OutputValue;
      const privateIp = privateIpOutput?.OutputValue;

      return {
        rpcUrl,
        networkId,
        instanceId,
        privateIp,
      };
    } catch (error: any) {
      if (error.name === 'ValidationException' || error.message?.includes('not found')) {
        console.warn(`⚠️  [INFRA-CONFIG] NEAR stack ${this.nearStackName} not found, using defaults`);
        return {
          rpcUrl: process.env.NEAR_RPC_URL || 'http://localhost:3030',
          networkId: 'localnet',
        };
      }
      throw new Error(`Failed to read NEAR config: ${error.message}`);
    }
  }

  /**
   * Get MPC node configuration from CloudFormation stack
   */
  private async getMpcConfig(): Promise<InfrastructureConfig['mpc']> {
    try {
      const command = new DescribeStacksCommand({
        StackName: this.mpcStackName,
      });
      const response = await this.cloudFormationClient.send(command);

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(`Stack ${this.mpcStackName} not found`);
      }

      const stack = response.Stacks[0];
      const outputs = stack.Outputs || [];

      // Extract contract ID (may be in outputs or props)
      const contractIdOutput = outputs.find(
        (o: any) => o.OutputKey === 'MpcContractId' || o.OutputKey === 'ContractId'
      );
      const contractId = contractIdOutput?.OutputValue || 'v1.signer.node0';

      // Extract node instance IDs and account IDs
      // Output keys may have CDK hash suffixes, so we use pattern matching
      const nodeInfos: Array<{ instanceId: string; accountId: string }> = [];
      for (let i = 0; i < 10; i++) { // Check up to 10 nodes
        // Match patterns like: MpcNetworkNode0InstanceId6287DE88 or Node0InstanceId
        const instanceIdOutput = outputs.find(
          (o: any) => o.OutputKey?.includes(`Node${i}InstanceId`) || 
                      o.OutputKey === `Node${i}InstanceId`
        );
        const accountIdOutput = outputs.find(
          (o: any) => o.OutputKey?.includes(`Node${i}AccountId`) ||
                      o.OutputKey === `Node${i}AccountId`
        );

        if (instanceIdOutput?.OutputValue) {
          nodeInfos.push({
            instanceId: instanceIdOutput.OutputValue,
            accountId: accountIdOutput?.OutputValue || `mpc-node-${i}.node0`,
          });
        } else {
          break; // No more nodes
        }
      }

      if (nodeInfos.length === 0) {
        throw new Error('No MPC nodes found in stack outputs');
      }

      // Fetch private IPs from EC2
      const instanceIds = nodeInfos.map((n) => n.instanceId);
      const privateIps = await this.getInstancePrivateIps(instanceIds);

      // Build node info array
      const nodes: MpcNodeInfo[] = nodeInfos.map((nodeInfo, index) => ({
        accountId: nodeInfo.accountId,
        instanceId: nodeInfo.instanceId,
        privateIp: privateIps[index] || '',
      }));

      // Optionally fetch public keys from Secrets Manager
      // (This is optional - keys may be fetched later during setup)
      await this.enrichNodesWithKeys(nodes);

      return {
        nodes,
        contractId,
        stackName: this.mpcStackName,
      };
    } catch (error: any) {
      if (error.name === 'ValidationException' || error.message?.includes('not found')) {
        throw new Error(
          `MPC stack ${this.mpcStackName} not found. ` +
          `Ensure the stack is deployed before running MPC setup.`
        );
      }
      throw new Error(`Failed to read MPC config: ${error.message}`);
    }
  }

  /**
   * Get private IPs for EC2 instances
   */
  private async getInstancePrivateIps(instanceIds: string[]): Promise<string[]> {
    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      });
      const response = await this.ec2Client.send(command);

      const privateIps: string[] = [];
      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (instance.InstanceId && instance.PrivateIpAddress) {
            const index = instanceIds.indexOf(instance.InstanceId);
            if (index >= 0) {
              privateIps[index] = instance.PrivateIpAddress;
            }
          }
        }
      }

      return privateIps;
    } catch (error: any) {
      console.warn(`⚠️  [INFRA-CONFIG] Failed to fetch instance IPs: ${error.message}`);
      return instanceIds.map(() => ''); // Return empty strings if fetch fails
    }
  }

  /**
   * Enrich node info with public keys from Secrets Manager
   * This is optional - keys may be fetched later during contract initialization
   */
  private async enrichNodesWithKeys(nodes: MpcNodeInfo[]): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      try {
        // Try to fetch MPC account public key from Secrets Manager
        // Secret name format: mpc-node-{i}-mpc_account_sk
        const secretName = `mpc-node-${i}-mpc_account_sk`;
        const command = new GetSecretValueCommand({
          SecretId: secretName,
        });
        const response = await this.secretsManagerClient.send(command);

        if (response.SecretString) {
          // Parse the secret (may be JSON or plain text)
          try {
            const secret = JSON.parse(response.SecretString);
            // Extract public key if available
            if (secret.publicKey) {
              nodes[i].publicKey = secret.publicKey;
            } else if (secret.MPC_ACCOUNT_PK) {
              nodes[i].publicKey = secret.MPC_ACCOUNT_PK;
            }
          } catch {
            // Secret is plain text, skip public key extraction
          }
        }
      } catch (error: any) {
        // Secret may not exist yet, or we don't have access
        // This is OK - we'll fetch keys during setup if needed
        if (error.name !== 'ResourceNotFoundException') {
          console.warn(`⚠️  [INFRA-CONFIG] Failed to fetch key for node ${i}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get MPC node account keys from Secrets Manager
   * Returns map of account ID -> private key
   */
  async getMpcNodeKeys(nodeCount: number = 3): Promise<Map<string, string>> {
    const keys = new Map<string, string>();

    for (let i = 0; i < nodeCount; i++) {
      try {
        const secretName = `mpc-node-${i}-mpc_account_sk`;
        const command = new GetSecretValueCommand({
          SecretId: secretName,
        });
        const response = await this.secretsManagerClient.send(command);

        if (response.SecretString) {
          // Parse the secret
          let privateKey: string;
          try {
            const secret = JSON.parse(response.SecretString);
            privateKey = secret.privateKey || secret.MPC_ACCOUNT_SK || secret;
          } catch {
            // Plain text secret
            privateKey = response.SecretString;
          }

          const accountId = `mpc-node-${i}.node0`;
          keys.set(accountId, privateKey);
        }
      } catch (error: any) {
        if (error.name === 'ResourceNotFoundException') {
          console.warn(`⚠️  [INFRA-CONFIG] Secret mpc-node-${i}-mpc_account_sk not found`);
        } else {
          throw new Error(`Failed to fetch key for node ${i}: ${error.message}`);
        }
      }
    }

    return keys;
  }

  /**
   * Get MPC node P2P private keys from Secrets Manager
   * Returns map of account ID -> P2P private key
   */
  async getMpcNodeP2pPrivateKeys(nodeCount: number = 3): Promise<Map<string, string>> {
    const keys = new Map<string, string>();

    for (let i = 0; i < nodeCount; i++) {
      try {
        const secretName = `mpc-node-${i}-mpc_p2p_private_key`;
        const command = new GetSecretValueCommand({
          SecretId: secretName,
        });
        const response = await this.secretsManagerClient.send(command);

        if (response.SecretString) {
          // Parse the secret
          let privateKey: string;
          try {
            const secret = JSON.parse(response.SecretString);
            privateKey = secret.privateKey || secret.MPC_P2P_PRIVATE_KEY || secret;
          } catch {
            // Plain text secret
            privateKey = response.SecretString;
          }

          const accountId = `mpc-node-${i}.node0`;
          keys.set(accountId, privateKey);
        }
      } catch (error: any) {
        if (error.name === "ResourceNotFoundException") {
          console.warn(`⚠️  [INFRA-CONFIG] Secret mpc-node-${i}-mpc_p2p_private_key not found`);
        } else {
          throw new Error(`Failed to fetch P2P key for node ${i}: ${error.message}`);
        }
      }
    }

    return keys;
  }
}

