#!/usr/bin/env ts-node
/**
 * Standalone MPC Application Setup Script
 * 
 * Sets up the MPC application layer on top of deployed AWS infrastructure:
 * - Creates account hierarchy: node0 -> signer.node0 -> v1.signer.node0
 * - Creates MPC node accounts
 * - Deploys v1.signer contract
 * - Initializes contract with participants
 * 
 * Usage:
 *   ts-node scripts/setup-mpc-app.ts --profile shai-sandbox-profile
 *   ts-node scripts/setup-mpc-app.ts --profile shai-sandbox-profile --threshold 2
 */

import 'source-map-support/register';
import { MpcSetup } from '../src/localnet/mpc-setup';
import { InfrastructureConfigReader } from '../src/aws/infrastructure-config';
import { getMasterAccountKeyArn, getMasterAccountId, getAwsRegion, getAwsProfile, getMpcStackName, getNearStackName } from '../src/config';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as fs from 'fs';
import * as path from 'path';

interface CliOptions {
  profile?: string;
  region?: string;
  threshold?: number;
  masterKeyArn?: string;
  masterKeyFile?: string;
  wasmPath?: string;
  nearStackName?: string;
  mpcStackName?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--profile':
        options.profile = args[++i];
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--threshold':
        options.threshold = parseInt(args[++i], 10);
        break;
      case '--master-key-arn':
        options.masterKeyArn = args[++i];
        break;
      case '--master-key-file':
        options.masterKeyFile = args[++i];
        break;
      case '--wasm-path':
        options.wasmPath = args[++i];
        break;
      case '--near-stack':
        options.nearStackName = args[++i];
        break;
      case '--mpc-stack':
        options.mpcStackName = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: ts-node scripts/setup-mpc-app.ts [options]

Options:
  --profile <profile>          AWS profile to use (default: from AWS_PROFILE env)
  --region <region>           AWS region (default: us-east-1)
  --threshold <n>             MPC signing threshold (default: 2)
  --master-key-arn <arn>      ARN of master account key in Secrets Manager
  --master-key-file <path>    Path to file containing master account private key
  --wasm-path <path>          Path to v1.signer.wasm (default: contracts/v1.signer.wasm)
  --near-stack <name>         NEAR CloudFormation stack name (default: near-localnet-sync)
  --mpc-stack <name>          MPC CloudFormation stack name (default: MpcStandaloneStack)
  --help, -h                  Show this help message

Environment Variables:
  AWS_PROFILE                 AWS profile name
  AWS_REGION                  AWS region
  MASTER_ACCOUNT_KEY_ARN      ARN of master account key in Secrets Manager
  NEAR_STACK_NAME             NEAR CloudFormation stack name
  MPC_STACK_NAME              MPC CloudFormation stack name

Examples:
  # Use default configuration
  ts-node scripts/setup-mpc-app.ts --profile shai-sandbox-profile

  # Custom threshold and stack names
  ts-node scripts/setup-mpc-app.ts \\
    --profile shai-sandbox-profile \\
    --threshold 2 \\
    --near-stack near-localnet-sync \\
    --mpc-stack MpcStandaloneStack

  # Use master key from file
  ts-node scripts/setup-mpc-app.ts \\
    --profile shai-sandbox-profile \\
    --master-key-file ~/.near/localnet/node0/validator_key.json
`);
}

async function getMasterAccountKey(options: CliOptions): Promise<string> {
  // Priority: 1. File, 2. ARN (from options or env), 3. Error
  if (options.masterKeyFile) {
    console.log(`📄 Reading master key from file: ${options.masterKeyFile}`);
    const keyData = JSON.parse(fs.readFileSync(options.masterKeyFile, 'utf-8'));
    return keyData.secret_key || keyData.private_key || keyData;
  }

  const arn = options.masterKeyArn || getMasterAccountKeyArn();
  if (arn) {
    console.log(`🔑 Fetching master key from Secrets Manager: ${arn}`);
    const region = options.region || getAwsRegion();
    const client = new SecretsManagerClient({ region });
    const command = new GetSecretValueCommand({ SecretId: arn });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error('Secret value is empty');
    }

    const secret = JSON.parse(response.SecretString);
    if (!secret.privateKey) {
      throw new Error('Secret does not contain privateKey field');
    }

    return secret.privateKey;
  }

  throw new Error(
    'Master account key required. Provide either:\n' +
    '  - --master-key-arn <arn> OR\n' +
    '  - --master-key-file <path> OR\n' +
    '  - Set MASTER_ACCOUNT_KEY_ARN environment variable'
  );
}

async function main() {
  try {
    const options = parseArgs();

    console.log('🚀 [SETUP-MPC-APP] Starting MPC application setup...\n');

    // Set AWS profile if provided
    if (options.profile) {
      process.env.AWS_PROFILE = options.profile;
    }

    // Get configuration
    const region = options.region || getAwsRegion();
    const profile = options.profile || getAwsProfile();
    const nearStackName = options.nearStackName || getNearStackName();
    const mpcStackName = options.mpcStackName || getMpcStackName();
    const threshold = options.threshold || 2;

    console.log('Configuration:');
    console.log(`  Region: ${region}`);
    console.log(`  Profile: ${profile || '(default)'}`);
    console.log(`  NEAR Stack: ${nearStackName}`);
    console.log(`  MPC Stack: ${mpcStackName}`);
    console.log(`  Threshold: ${threshold}\n`);

    // 1. Read infrastructure configuration
    console.log('📡 Reading infrastructure state from AWS...');
    const reader = new InfrastructureConfigReader({
      region,
      profile,
      nearStackName,
      mpcStackName,
    });
    const infraConfig = await reader.getInfrastructureConfig();
    console.log(`✅ Infrastructure config loaded:`);
    console.log(`   NEAR RPC: ${infraConfig.near.rpcUrl}`);
    console.log(`   MPC Nodes: ${infraConfig.mpc.nodes.length}`);
    console.log(`   Contract ID: ${infraConfig.mpc.contractId}\n`);

    // 2. Get master account key
    console.log('🔑 Getting master account key...');
    const masterKey = await getMasterAccountKey(options);
    console.log('✅ Master account key retrieved\n');

    // 3. Setup MPC network
    const wasmPath = options.wasmPath || path.join(process.cwd(), 'contracts', 'v1.signer.wasm');
    if (!fs.existsSync(wasmPath)) {
      throw new Error(
        `Contract WASM file not found: ${wasmPath}\n` +
        `Run: contracts/download-wasm.sh`
      );
    }

    const mpcSetup = new MpcSetup({
      infrastructureConfig: infraConfig,
      masterAccountPrivateKey: masterKey,
      wasmPath,
      threshold,
      region,
      profile,
    });

    const result = await mpcSetup.setupMpcNetwork();

    console.log('\n✅ [SETUP-MPC-APP] MPC application setup complete!');
    console.log(`   Contract: ${result.contractId}`);
    console.log(`   Participants: ${result.participants.length}`);
    console.log(`   Threshold: ${threshold}`);
    console.log('\nMPC Network is ready to use!');
  } catch (error: any) {
    console.error('\n❌ [SETUP-MPC-APP] Setup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

