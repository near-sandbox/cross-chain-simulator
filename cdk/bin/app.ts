#!/usr/bin/env node
/**
 * CDK App for Cross-Chain Simulator
 * 
 * Deploys infrastructure for NEAR Chain Signatures with real MPC integration
 * 
 * Deployment Modes:
 * 
 * Mode 1: Existing Infrastructure
 *   - User provides NEAR_RPC_URL and MASTER_ACCOUNT_KEY_ARN
 *   - Deploys only CrossChainSimulatorStack
 *   - Uses existing NEAR localnet node
 * 
 * Mode 2: Integrated Deployment
 *   - Deploys both NearLocalnetStack (from AWS Node Runner) and CrossChainSimulatorStack
 *   - Set deployNearNode=false to disable (default: true)
 *   - Auto-imports RPC URL and master key ARN from NearLocalnetStack
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CrossChainSimulatorStack } from '../cross-chain-simulator-stack';

const app = new cdk.App();

// Determine deployment mode
// Mode 1: deployNearNode=false or NEAR_RPC_URL explicitly provided
// Mode 2: deployNearNode=true (default) and no explicit NEAR_RPC_URL
const deployNearNode = app.node.tryGetContext('deployNearNode') !== false;
const explicitRpcUrl = app.node.tryGetContext('nearRpcUrl') || process.env.NEAR_RPC_URL;
const explicitMasterKeyArn = app.node.tryGetContext('masterAccountKeyArn') || process.env.MASTER_ACCOUNT_KEY_ARN;

// If user provides RPC URL and master key ARN, assume Mode 1 (existing infrastructure)
const useExistingInfrastructure = !!(explicitRpcUrl && explicitMasterKeyArn);

const masterAccountId = app.node.tryGetContext('masterAccountId') || process.env.MASTER_ACCOUNT_ID || 'test.near';

if (useExistingInfrastructure || !deployNearNode) {
  // Mode 1: Existing Infrastructure
  // User provides their own NEAR node and master account key ARN
  
  if (!explicitRpcUrl) {
    throw new Error('Mode 1 requires NEAR_RPC_URL. Set via -c nearRpcUrl=... or NEAR_RPC_URL env var');
  }
  
  if (!explicitMasterKeyArn) {
    throw new Error('Mode 1 requires MASTER_ACCOUNT_KEY_ARN. Set via -c masterAccountKeyArn=... or MASTER_ACCOUNT_KEY_ARN env var');
  }
  
  console.log('📦 Mode 1: Deploying CrossChainSimulatorStack with existing infrastructure');
  console.log(`   RPC URL: ${explicitRpcUrl}`);
  console.log(`   Master Key ARN: ${explicitMasterKeyArn}`);
  
  new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    nearRpcUrl: explicitRpcUrl,
    masterAccountId,
    masterAccountKeyArn: explicitMasterKeyArn,
  });
  
} else {
  // Mode 2: Integrated Deployment
  // Deploy both NearLocalnetStack (from AWS Node Runner) and CrossChainSimulatorStack
  
  console.log('📦 Mode 2: Deploying NearLocalnetStack + CrossChainSimulatorStack');
  console.log('   Importing NearLocalnetStack from AWS Node Runner...');
  
  // Import NearLocalnetStack from AWS Node Runner
  // Source: https://github.com/shaiss/aws-blockchain-node-runners/tree/near (dev)
  // Future: https://github.com/aws-samples/aws-blockchain-node-runners (official)
  // 
  // When AWS Node Runner is published to npm:
  //   import { NearLocalnetStack } from '@aws-samples/aws-blockchain-node-runners/lib/near';
  //
  // For now, use CloudFormation imports (assumes NearLocalnetStack deployed separately)
  // TODO: Once AWS Node Runner is importable, replace with direct stack import
  
  try {
    // Import values from CloudFormation exports
    // These exports come from NearLocalnetStack (deployed via AWS Node Runner)
    const nearRpcUrl = explicitRpcUrl || cdk.Fn.importValue('NearLocalnetRpcUrl');
    const masterAccountKeyArn = explicitMasterKeyArn || cdk.Fn.importValue('NearLocalnetMasterAccountKeyArn');
    
    console.log('   Using CloudFormation exports from NearLocalnetStack');
    console.log('   Note: Ensure NearLocalnetStack is deployed first');
    
    const simulatorStack = new CrossChainSimulatorStack(app, 'CrossChainSimulatorStack', {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
      },
      nearRpcUrl: nearRpcUrl as string,
      masterAccountId,
      masterAccountKeyArn: masterAccountKeyArn as string,
    });
    
    console.log('   ✅ CrossChainSimulatorStack configured to use NearLocalnetStack exports');
    console.log('   Future: Will import NearLocalnetStack directly when AWS Node Runner is published');
    
  } catch (error) {
    console.error('❌ Failed to configure Mode 2:', error);
    console.error('');
    console.error('   Options:');
    console.error('   1. Deploy NearLocalnetStack first:');
    console.error('      cd /AWSNodeRunner/lib/near && cdk deploy --all');
    console.error('   2. Use Mode 1 with existing infrastructure:');
    console.error('      export NEAR_RPC_URL=... && export MASTER_ACCOUNT_KEY_ARN=...');
    console.error('      cdk deploy CrossChainSimulatorStack -c deployNearNode=false');
    throw error;
  }
}

app.synth();

