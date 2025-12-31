/**
 * CDK Stack for Cross-Chain Simulator Infrastructure
 * 
 * Deploys:
 * - KMS key for deployer account encryption
 * - SSM Parameter for master account key storage (optional)
 * - IAM roles for EC2 instances (optional)
 * 
 * Note: MPC nodes and contract deployment are managed via scripts (not Lambda)
 * since orchestration requires Docker containers.
 */

import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CrossChainSimulatorStackProps extends cdk.StackProps {
  /**
   * NEAR RPC URL for the localnet node
   * Should point to the EC2 instance deployed via AWS Node Runner
   */
  nearRpcUrl: string;

  /**
   * Network ID (default: localnet)
   */
  networkId?: string;

  /**
   * Master account ID (default: test.node0 for localnet)
   */
  masterAccountId?: string;

  /**
   * Master account key ARN from AWS Node Runner (preferred)
   * CloudFormation export: NearLocalnetMasterAccountKeyArn
   * Can be imported via: Fn.importValue('NearLocalnetMasterAccountKeyArn')
   */
  masterAccountKeyArn?: string;

  /**
   * Master account private key (fallback for local dev only)
   * WARNING: Do not use in production! Use masterAccountKeyArn instead.
   */
  masterAccountPrivateKey?: string;
}

export class CrossChainSimulatorStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly ec2Role: iam.Role;

  constructor(scope: Construct, id: string, props: CrossChainSimulatorStackProps) {
    super(scope, id, props);

    // 1. Create KMS key for deployer account
    this.kmsKey = new kms.Key(this, 'DeployerKmsKey', {
      description: 'KMS key for encrypting NEAR deployer account private key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete keys on stack deletion
      alias: `${this.stackName}/deployer-key`,
    });

    // Export KMS key ID and ARN
    new cdk.CfnOutput(this, 'DeployerKmsKeyId', {
      value: this.kmsKey.keyId,
      description: 'KMS Key ID for deployer account encryption',
      exportName: `${this.stackName}-DeployerKmsKeyId`,
    });

    new cdk.CfnOutput(this, 'DeployerKmsKeyArn', {
      value: this.kmsKey.keyArn,
      description: 'KMS Key ARN for deployer account encryption',
      exportName: `${this.stackName}-DeployerKmsKeyArn`,
    });

    // 2. Create IAM role for EC2 instances
    // Use this role for EC2 instances that run the orchestrator
    this.ec2Role = new iam.Role(this, 'EC2OrchestratorRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for EC2 instances running NEAR localnet orchestrator',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Grant KMS permissions
    this.kmsKey.grantEncryptDecrypt(this.ec2Role);

    // Grant Secrets Manager read permission for master account key
    if (props.masterAccountKeyArn) {
      // Import secret from ARN
      const masterAccountSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'MasterAccountSecret',
        props.masterAccountKeyArn
      );
      
      // Grant read access
      masterAccountSecret.grantRead(this.ec2Role);
      
      new cdk.CfnOutput(this, 'MasterAccountKeyArnUsed', {
        value: props.masterAccountKeyArn,
        description: 'Master account key ARN (from AWS Node Runner)',
        exportName: `${this.stackName}-MasterAccountKeyArnUsed`,
      });
    } else if (props.masterAccountPrivateKey) {
      // Fallback: Store in SSM Parameter Store (local dev only)
      console.warn('⚠️  Using SSM Parameter Store for master key (not recommended for production)');
      const masterKeyParam = new ssm.StringParameter(this, 'MasterAccountKey', {
        parameterName: `/${this.stackName}/master-account-key`,
        stringValue: props.masterAccountPrivateKey,
        description: 'NEAR master account private key (localnet only, fallback)',
        tier: ssm.ParameterTier.STANDARD,
      });
      
      masterKeyParam.grantRead(this.ec2Role);
      
      new cdk.CfnOutput(this, 'MasterAccountKeyParameter', {
        value: masterKeyParam.parameterName,
        description: 'SSM parameter name for master account key (fallback)',
      });
    }

    // Create instance profile for EC2
    const instanceProfile = new iam.CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [this.ec2Role.roleName],
      instanceProfileName: `${this.stackName}-EC2OrchestratorProfile`,
    });

    // Export instance profile name
    new cdk.CfnOutput(this, 'EC2InstanceProfileName', {
      value: instanceProfile.instanceProfileName!,
      description: 'Instance profile for EC2 orchestrator',
      exportName: `${this.stackName}-EC2InstanceProfileName`,
    });

    // 3. Export configuration for scripts
    new cdk.CfnOutput(this, 'NearRpcUrl', {
      value: props.nearRpcUrl,
      description: 'NEAR RPC URL for localnet',
      exportName: `${this.stackName}-NearRpcUrl`,
    });

    new cdk.CfnOutput(this, 'MpcContractId', {
      value: 'v1.signer.node0',
      description: 'MPC Contract ID on localnet',
      exportName: `${this.stackName}-MpcContractId`,
    });

    new cdk.CfnOutput(this, 'MasterAccountId', {
      value: props.masterAccountId || 'test.node0',
      description: 'NEAR master account ID',
      exportName: `${this.stackName}-MasterAccountId`,
    });
  }
}
