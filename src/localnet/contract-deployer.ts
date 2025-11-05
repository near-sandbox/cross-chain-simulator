/**
 * Contract Deployer for NEAR localnet
 * 
 * Handles deployment of v1.signer contract to localnet using AWS KMS for transaction signing.
 * Manages account creation and contract deployment lifecycle.
 */

import { connect, Near, Account, keyStores, KeyPair, utils } from 'near-api-js';
import { KMSKeyManager } from './kms-key-manager';
import * as fs from 'fs';
import * as path from 'path';

export interface ContractDeployerConfig {
  rpcUrl: string;
  networkId: string;
  deployerAccountId: string;
  masterAccountId: string;
  kmsManager: KMSKeyManager;
  // Optional: Pre-encrypted deployer private key (if account already exists)
  encryptedDeployerPrivateKey?: string;
}

export class ContractDeployer {
  private near: Near | null = null;
  private masterAccount: Account | null = null;
  private deployerAccount: Account | null = null;
  private keyStore: keyStores.InMemoryKeyStore;
  // Store encrypted deployer private key (in production, use external storage)
  private encryptedDeployerPrivateKey: string | null = null;

  constructor(private config: ContractDeployerConfig) {
    this.keyStore = new keyStores.InMemoryKeyStore();
    this.encryptedDeployerPrivateKey = config.encryptedDeployerPrivateKey || null;
  }

  /**
   * Initialize NEAR connection
   */
  private async initializeNear(): Promise<void> {
    if (this.near) {
      return;
    }

    this.near = await connect({
      networkId: this.config.networkId,
      nodeUrl: this.config.rpcUrl,
      keyStore: this.keyStore,
      headers: {},
    });
  }

  /**
   * Verify RPC connection is accessible
   */
  async verifyRpcConnection(): Promise<void> {
    try {
      await this.initializeNear();
      if (!this.near) {
        throw new Error('Failed to initialize NEAR connection');
      }
      
      // Try to get network status
      const status = await this.near.connection.provider.status();
      console.log('✅ [DEPLOYER] RPC connection verified:', {
        chainId: status.chain_id,
        latestBlockHeight: status.sync_info.latest_block_height,
      });
    } catch (error) {
      throw new Error(`RPC connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if account exists
   */
  private async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.initializeNear();
      if (!this.near) {
        throw new Error('NEAR not initialized');
      }
      
      const account = await this.near.account(accountId);
      await account.state();
      return true;
    } catch (error: any) {
      // Account doesn't exist if error contains "does not exist"
      if (error.message?.includes('does not exist')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Initialize master account (test.near)
   * Note: On localnet, master account should already exist and be funded
   * The master account key should be available (either in keystore or via environment)
   */
  async initializeMasterAccount(): Promise<void> {
    await this.initializeNear();
    
    if (!this.near) {
      throw new Error('NEAR not initialized');
    }

    const exists = await this.accountExists(this.config.masterAccountId);
    if (!exists) {
      throw new Error(`Master account ${this.config.masterAccountId} does not exist. Ensure localnet is properly initialized.`);
    }

    try {
      this.masterAccount = await this.near.account(this.config.masterAccountId);
      
      // Check if master account key is in keystore
      // If not, master account operations will fail
      // On localnet, master account key may need to be added manually
      const masterKey = await this.keyStore.getKey(this.config.networkId, this.config.masterAccountId);
      
      if (!masterKey) {
        console.log('⚠️  [DEPLOYER] Master account key not in keystore');
        console.log('   Note: For localnet, master account key may need to be added manually');
        console.log('   Master account operations may fail without the key');
      }
      
      const accessKeys = await this.masterAccount.getAccessKeys();
      console.log('✅ [DEPLOYER] Master account initialized:', {
        accountId: this.config.masterAccountId,
        accessKeys: accessKeys.length,
        hasKeyInKeystore: !!masterKey,
      });
    } catch (error) {
      throw new Error(`Failed to initialize master account: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create deployer account (deployer.node0)
   * Uses KMS pattern: Generate ED25519 key → Encrypt with KMS → Create account with master account
   */
  async createDeployerAccount(): Promise<void> {
    await this.initializeNear();
    
    if (!this.near || !this.masterAccount) {
      await this.initializeMasterAccount();
      if (!this.near || !this.masterAccount) {
        throw new Error('Failed to initialize NEAR and master account');
      }
    }

    const deployerId = this.config.deployerAccountId;
    const exists = await this.accountExists(deployerId);

    if (exists) {
      console.log('✅ [DEPLOYER] Deployer account already exists:', deployerId);
      this.deployerAccount = await this.near.account(deployerId);
      
      // If we have encrypted private key, add it to keystore for future use
      if (this.encryptedDeployerPrivateKey) {
        const privateKeyString = await this.config.kmsManager.decryptPrivateKey(this.encryptedDeployerPrivateKey);
        const keyPair = KeyPair.fromString(privateKeyString);
        await this.keyStore.setKey(this.config.networkId, deployerId, keyPair);
      }
      return;
    }

    try {
      console.log('🔑 [DEPLOYER] Generating deployer key pair...');
      
      // Generate ED25519 key pair (NEAR native format)
      const keyPair = KeyPair.fromRandom('ed25519');
      const publicKey = keyPair.getPublicKey();
      const privateKey = keyPair.toString(); // Format: "ed25519:base58EncodedKey..."

      // Encrypt private key with KMS
      console.log('🔐 [DEPLOYER] Encrypting private key with KMS...');
      const encryptedPrivateKey = await this.config.kmsManager.encryptPrivateKey(privateKey);
      this.encryptedDeployerPrivateKey = encryptedPrivateKey;

      console.log('📝 [DEPLOYER] Creating deployer account:', deployerId);
      console.log('   Public key:', publicKey.toString());
      
      // Add master account key to keystore if not already there
      // Master account key should be available for createAccount to work
      const masterKey = await this.keyStore.getKey(this.config.networkId, this.config.masterAccountId);
      if (!masterKey) {
        throw new Error(`Master account key not in keystore. Add master account key before creating deployer account.`);
      }

      // Create account via master account
      // Initial balance: 5 NEAR (enough for contract deployment)
      const initialBalance = utils.format.parseNearAmount('5')!;
      
      await this.masterAccount.createAccount(
        deployerId,
        publicKey,
        initialBalance
      );

      console.log('✅ [DEPLOYER] Deployer account created:', deployerId);
      
      // Add deployer key to keystore for future transactions
      await this.keyStore.setKey(this.config.networkId, deployerId, keyPair);
      this.deployerAccount = await this.near.account(deployerId);
      
      console.log('💾 [DEPLOYER] Encrypted private key stored (save this for future use):');
      console.log('   DEPLOYER_ENCRYPTED_KEY=' + encryptedPrivateKey.substring(0, 50) + '...');
    } catch (error) {
      throw new Error(`Failed to create deployer account: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy v1.signer contract
   * 
   * @param contractAccountId - Account ID to deploy contract to (default: v1.signer.node0)
   * @param wasmPath - Path to contract WASM file
   */
  async deploySignerContract(
    contractAccountId: string = 'v1.signer.node0',
    wasmPath?: string
  ): Promise<string> {
    await this.initializeNear();
    
    if (!this.near) {
      throw new Error('NEAR not initialized');
    }

    // Ensure deployer account exists
    if (!this.deployerAccount) {
      await this.createDeployerAccount();
    }

    if (!this.deployerAccount) {
      throw new Error('Deployer account not available');
    }

    // Ensure deployer account has key in keystore (for signing deployment transaction)
    if (!this.encryptedDeployerPrivateKey) {
      throw new Error('Deployer account encrypted private key not available. Cannot deploy contract.');
    }

    // Decrypt deployer private key with KMS
    console.log('🔓 [DEPLOYER] Decrypting deployer private key...');
    const privateKeyString = await this.config.kmsManager.decryptPrivateKey(this.encryptedDeployerPrivateKey);
    const deployerKeyPair = KeyPair.fromString(privateKeyString);
    
    // Ensure deployer key is in keystore
    await this.keyStore.setKey(this.config.networkId, this.config.deployerAccountId, deployerKeyPair);

    // Check if contract account exists
    const contractExists = await this.accountExists(contractAccountId);
    
    if (!contractExists) {
      // Create contract account from deployer account
      console.log('📝 [DEPLOYER] Creating contract account:', contractAccountId);
      
      // Generate key pair for contract account (contracts need full access keys)
      const contractKeyPair = KeyPair.fromRandom('ed25519');
      const contractPublicKey = contractKeyPair.getPublicKey();
      
      // Initial balance: 10 NEAR (enough for contract storage and operations)
      const initialBalance = utils.format.parseNearAmount('10')!;
      
      await this.deployerAccount.createAccount(
        contractAccountId,
        contractPublicKey,
        initialBalance
      );
      
      console.log('✅ [DEPLOYER] Contract account created:', contractAccountId);
      
      // Add contract account key to keystore
      await this.keyStore.setKey(this.config.networkId, contractAccountId, contractKeyPair);
    } else {
      // Check if contract is already deployed
      try {
        const contractAccount = await this.near.account(contractAccountId);
        const state = await contractAccount.state();
        
        if (state.code_hash !== '11111111111111111111111111111111') {
          console.log('✅ [DEPLOYER] Contract already deployed:', contractAccountId);
          return contractAccountId;
        }
      } catch (error) {
        // Continue with deployment
      }
    }

    // Load WASM file
    const wasmFilePath = wasmPath || path.join(process.cwd(), 'contracts', 'v1.signer.wasm');
    
    if (!fs.existsSync(wasmFilePath)) {
      throw new Error(`Contract WASM file not found: ${wasmFilePath}. Run contracts/download-wasm.sh first.`);
    }

    const wasmCode = fs.readFileSync(wasmFilePath);

    try {
      console.log('📦 [DEPLOYER] Deploying contract:', {
        contractId: contractAccountId,
        wasmSize: wasmCode.length,
      });

      // Get contract account (must have key in keystore for deployment)
      const contractAccount = await this.near.account(contractAccountId);
      const contractKey = await this.keyStore.getKey(this.config.networkId, contractAccountId);
      
      if (!contractKey) {
        throw new Error(`Contract account key not in keystore. Cannot deploy contract.`);
      }

      // Deploy contract using NEAR SDK
      const result = await contractAccount.deployContract(wasmCode);
      
      console.log('✅ [DEPLOYER] Contract deployed:', {
        contractId: contractAccountId,
        txHash: result.transaction.hash,
      });

      return contractAccountId;
    } catch (error) {
      throw new Error(`Failed to deploy contract: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get encrypted deployer private key (for external storage)
   * Returns the encrypted key if available, null otherwise
   */
  getEncryptedDeployerKey(): string | null {
    return this.encryptedDeployerPrivateKey;
  }

  /**
   * Add master account key to keystore
   * Useful for localnet where master account key may need to be added manually
   */
  async addMasterAccountKey(privateKeyString: string): Promise<void> {
    await this.initializeNear();
    const keyPair = KeyPair.fromString(privateKeyString);
    await this.keyStore.setKey(this.config.networkId, this.config.masterAccountId, keyPair);
    console.log('✅ [DEPLOYER] Master account key added to keystore');
  }

  /**
   * Verify contract deployment
   */
  async verifyContractDeployment(contractId: string): Promise<boolean> {
    try {
      await this.initializeNear();
      if (!this.near) {
        return false;
      }

      const account = await this.near.account(contractId);
      const state = await account.state();
      
      // Check if account has code deployed
      const hasCode = state.code_hash !== '11111111111111111111111111111111';
      
      if (hasCode) {
        console.log('✅ [DEPLOYER] Contract verified:', contractId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ [DEPLOYER] Contract verification failed:', error);
      return false;
    }
  }
}

