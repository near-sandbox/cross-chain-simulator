/**
 * Environment-based configuration
 */

export interface ChainSignaturesConfig {
  useSimulators: boolean;
  mpcServiceUrl?: string;
}

/**
 * LocalnetConfig - Configuration for localnet NEAR + MPC infrastructure
 * Used by near-intents-simulator and other consumers
 */
export interface LocalnetConfig {
  rpcUrl: string;
  networkId: 'localnet';
  mpcContractId: string;
  mpcNodes: string[];
  headers?: Record<string, string>;
}

export function getConfig(): ChainSignaturesConfig {
  const useSimulators = process.env.USE_PRODUCTION_SIMULATORS !== 'true';

  return {
    useSimulators,
    mpcServiceUrl: process.env.MPC_SERVICE_URL,
  };
}

/**
 * NEAR RPC URL Configuration
 * 
 * Single source of truth for NEAR RPC endpoint.
 * 
 * Options:
 * 1. Localhost (default): http://localhost:3030
 * 2. EC2 Instance: http://54.90.246.254:3030
 *    - Instance ID: i-05fce3d18e6b1ba8b
 *    - Public IP: 54.90.246.254
 *    - Port 3030 open from 0.0.0.0
 * 
 * Configuration Methods (priority order):
 * 1. Environment variable (highest priority):
 *    export NEAR_RPC_URL=http://54.90.246.254:3030
 * 
 * 2. Change default constant below (affects all code using getNearRpcUrl()):
 *    const DEFAULT_NEAR_RPC_URL = 'http://54.90.246.254:3030';
 * 
 * All TypeScript code uses getNearRpcUrl() which respects this configuration.
 * Shell scripts use NEAR_RPC_URL environment variable.
 */
const DEFAULT_NEAR_RPC_URL = 'http://localhost:3030';
// Alternative: Use EC2 instance (uncomment to change default)
// const DEFAULT_NEAR_RPC_URL = 'http://54.90.246.254:3030';

/**
 * Get NEAR RPC URL from environment or default
 * 
 * Priority:
 * 1. NEAR_RPC_URL environment variable (if set)
 * 2. DEFAULT_NEAR_RPC_URL constant (see above)
 */
export function getNearRpcUrl(): string {
  return process.env.NEAR_RPC_URL || DEFAULT_NEAR_RPC_URL;
}

/**
 * Get MPC contract ID from environment or default
 * Uses .node0 suffix for localnet accounts (v1.signer.node0)
 */
export function getMpcContractId(): string {
  return process.env.MPC_CONTRACT_ID || 'v1.signer.node0';
}

/**
 * Get MPC node endpoints from environment or default to 3-node configuration
 */
export function getMpcNodes(): string[] {
  const envNodes = process.env.MPC_NODES;
  if (envNodes) {
    try {
      return JSON.parse(envNodes);
    } catch (e) {
      console.warn('Failed to parse MPC_NODES env var, using defaults');
    }
  }
  // Default 3-node configuration
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
  ];
}

/**
 * Get deployer account ID from environment or default
 * Used for contract deployment operations
 */
export function getDeployerAccountId(): string {
  return process.env.DEPLOYER_ACCOUNT_ID || 'deployer.node0';
}

/**
 * Get master account ID from environment or default
 * Master account used to create deployer account
 */
export function getMasterAccountId(): string {
  return process.env.MASTER_ACCOUNT_ID || 'test.near';
}

/**
 * Get master account key ARN from environment
 * ARN from AWS Node Runner Secrets Manager secret
 * Exported as CloudFormation output: NearLocalnetMasterAccountKeyArn
 */
export function getMasterAccountKeyArn(): string | undefined {
  return process.env.MASTER_ACCOUNT_KEY_ARN;
}

/**
 * Get AWS KMS key ID for deployer account from environment
 * Returns undefined if not set (deployment will fail if KMS key is required)
 */
export function getDeployerKmsKeyId(): string | undefined {
  return process.env.DEPLOYER_KMS_KEY_ID;
}
