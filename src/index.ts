/**
 * Cross-Chain Simulator - Main exports
 */

// Types
export * from './types';

// Simulators
export { ChainSignaturesSimulator } from './chain-signatures/simulator';
export { ProductionMPCClient, createChainSignaturesClient } from './factory';

// Config
export { 
  getConfig,
  LocalnetConfig,
  getNearRpcUrl,
  getMpcContractId,
  getMpcNodes,
  getDeployerAccountId,
  getMasterAccountId,
  getMasterAccountKeyArn,
  getDeployerKmsKeyId
} from './config';

// Localnet deployment and orchestration
export {
  KMSKeyManager,
  ContractDeployer,
  LocalnetOrchestrator
} from './localnet';
