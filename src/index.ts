/**
 * Cross-Chain Simulator - Main exports
 * 
 * Layer 3: Chain Signatures implementation for NEAR localnet
 * 
 * @see https://docs.near.org/chain-abstraction/chain-signatures
 */

// Types
export * from './types';

// Chain Signatures Client
export { ChainSignaturesSimulator } from './chain-signatures/simulator';
export { ProductionMPCClient, createChainSignaturesClient } from './factory';

// NEAR Client (for direct contract interaction)
export { 
  NearClient,
  DOMAIN_SECP256K1,
  DOMAIN_ED25519,
  type DerivedPublicKeyResponse,
  type RootPublicKeyResponse,
  type MPCSignature,
  type SignRequestParams,
} from './chain-signatures/near-client';

// MPC Service
export { MPCService } from './chain-signatures/mpc-service';

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
