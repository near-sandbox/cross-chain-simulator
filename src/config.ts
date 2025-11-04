/**
 * Environment-based configuration
 */

export interface ChainSignaturesConfig {
  useSimulators: boolean;
  mpcServiceUrl?: string;
}

export function getConfig(): ChainSignaturesConfig {
  const useSimulators = process.env.USE_PRODUCTION_SIMULATORS !== 'true';

  return {
    useSimulators,
    mpcServiceUrl: process.env.MPC_SERVICE_URL,
  };
}
