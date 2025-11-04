/**
 * Cross-Chain Simulator - Main exports
 */

// Types
export * from './types';

// Simulators
export { ChainSignaturesSimulator } from './chain-signatures/simulator';
export { ProductionMPCClient, createChainSignaturesClient } from './factory';

// Config
export { getConfig } from './config';
