
import { MpcSetup } from '../src/localnet/mpc-setup';
import { getNearRpcUrl } from '../src/config';

async function main() {
  const rpcUrl = process.env.NEAR_RPC_URL || 'http://10.0.55.70:3030';
  const masterAccountPrivateKey = process.env.MASTER_ACCOUNT_SK;
  const masterAccountId = process.env.MASTER_ACCOUNT_ID || 'node0';

  if (!masterAccountPrivateKey) {
    throw new Error('MASTER_ACCOUNT_SK env var is required');
  }

  console.log(`Using RPC: ${rpcUrl}`);
  console.log(`Master Account: ${masterAccountId}`);

  // Override infrastructure config to avoid AWS lookup if possible, or just let it look up MPC nodes
  // But we need to force masterAccountId in MpcSetup (it uses getMasterAccountId from config)
  // We can monkey-patch or just rely on env var MASTER_ACCOUNT_ID which getMasterAccountId uses.

  const mpcSetup = new MpcSetup({
    masterAccountPrivateKey,
    region: 'us-east-1',
    profile: 'shai-sandbox-profile'
  });

  // We need to ensure getMasterAccountId returns 'node0'
  // It reads MASTER_ACCOUNT_ID env var.

  try {
    const result = await mpcSetup.setupMpcNetwork();
    console.log('Setup complete:', result);
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  }
}

main();

