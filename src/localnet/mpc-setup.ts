/**
 * MPC Setup Module
 *
 * Handles MPC network setup on top of deployed infrastructure:
 * - Creates account hierarchy: localnet -> signer.localnet -> v1.signer.localnet
 * - Creates MPC node accounts under .localnet (e.g. mpc-node-0.localnet)
 * - Deploys v1.signer contract
 * - Initializes contract with MPC participants
 * - Votes to add domains (Secp256k1) to trigger distributed key generation
 */

import { Account, connect, KeyPair, Near, utils } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores/in_memory_key_store";
import * as fs from "fs";
import * as path from "path";

import type { InfrastructureConfig } from "../aws/infrastructure-config";
import { InfrastructureConfigReader } from "../aws/infrastructure-config";
import { getMasterAccountId, getMpcContractId } from "../config";

export interface ParticipantInfo {
  accountId: string;
  index: number;
  signPk: string;
  url: string;
}

export interface MpcSetupOptions {
  infrastructureConfig?: InfrastructureConfig;
  masterAccountPrivateKey: string;
  wasmPath?: string;
  threshold?: number;
  region?: string;
  profile?: string;
}

export class MpcSetup {
  private near: Near | null = null;
  private masterAccount: Account | null = null;
  private signerAccount: Account | null = null;
  private contractAccount: Account | null = null;
  private keyStore: InMemoryKeyStore = new InMemoryKeyStore();

  private masterAccountId: string;
  private networkId!: string;
  private rpcUrl!: string;
  private wasmPath: string;

  constructor(private options: MpcSetupOptions) {
    this.masterAccountId = getMasterAccountId();
    this.wasmPath =
      options.wasmPath || path.join(process.cwd(), "contracts", "v1.signer.wasm");
  }

  /**
   * Setup MPC network: create accounts, deploy contract, initialize
   */
  async setupMpcNetwork(): Promise<{
    contractId: string;
    participants: ParticipantInfo[];
  }> {
    console.log("🚀 [MPC-SETUP] Starting MPC network setup...");

    // 1. Get infrastructure config
    let config: InfrastructureConfig;
    if (this.options.infrastructureConfig) {
      config = this.options.infrastructureConfig;
    } else {
      const reader = new InfrastructureConfigReader({
        region: this.options.region,
        profile: this.options.profile,
      });
      config = await reader.getInfrastructureConfig();
    }

    this.networkId = config.near.networkId;

    // Allow environment variable override for port forwarding scenarios
    this.rpcUrl = process.env.NEAR_RPC_URL || config.near.rpcUrl;
    if (process.env.NEAR_RPC_URL) {
      console.log("📌 [MPC-SETUP] Using NEAR_RPC_URL override:", this.rpcUrl);
    }

    const contractId = process.env.MPC_CONTRACT_ID || config.mpc.contractId || getMpcContractId();

    // 2. Initialize NEAR connection
    await this.initializeNear();

    // 3. Initialize master account (localnet)
    await this.initializeMasterAccount();

    // 4. Create account hierarchy: localnet -> signer.localnet -> v1.signer.localnet
    await this.createAccountHierarchy(contractId);

    // 5. Create MPC node accounts
    const participants = await this.createMpcNodeAccounts(config);

    // 6. Deploy contract to v1.signer.localnet
    const deployedContractId = await this.deployContract(contractId);

    // 7. Initialize contract with participants
    await this.initializeContract(
      deployedContractId,
      participants,
      this.options.threshold || 2
    );

    // 8. Add domains to contract (ECDSA for chain signatures)
    await this.addDomains(deployedContractId, participants);

    console.log("✅ [MPC-SETUP] MPC network setup complete!");

    return {
      contractId: deployedContractId,
      participants,
    };
  }

  /**
   * Initialize NEAR connection
   */
  private async initializeNear(): Promise<void> {
    if (this.near) {
      return;
    }

    this.near = await connect({
      networkId: this.networkId,
      nodeUrl: this.rpcUrl,
      // near-api-js expects the keystore under `deps`, otherwise the connection has no signer
      // and transaction signing fails with: "Please set a signer".
      deps: { keyStore: this.keyStore },
      headers: {},
    } as any);
  }

  /**
   * Initialize master account (localnet)
   */
  private async initializeMasterAccount(): Promise<void> {
    if (!this.near) {
      await this.initializeNear();
    }
    if (!this.near) {
      throw new Error("NEAR not initialized");
    }

    // Add master account key to keystore
    const masterKeyPair = KeyPair.fromString(this.options.masterAccountPrivateKey as any);
    await this.keyStore.setKey(this.networkId, this.masterAccountId, masterKeyPair);

    this.masterAccount = await this.near.account(this.masterAccountId);
    console.log("✅ [MPC-SETUP] Master account initialized:", this.masterAccountId);
  }

  private getSignerAccountIdFromContractId(contractId: string): string {
    const parts = contractId.split(".");
    if (parts.length < 2 || parts[0] !== "v1") {
      throw new Error(
        `Invalid contract ID format: ${contractId}. Expected format: v1.{parent_account}`
      );
    }
    return parts.slice(1).join(".");
  }

  /**
   * Create account hierarchy: localnet -> signer.localnet -> v1.signer.localnet
   */
  private async createAccountHierarchy(contractId: string): Promise<void> {
    if (!this.masterAccount || !this.near) {
      throw new Error("Master account not initialized");
    }

    const signerAccountId = this.getSignerAccountIdFromContractId(contractId);
    const masterKeyPair = KeyPair.fromString(this.options.masterAccountPrivateKey as any);
    const masterPublicKey = masterKeyPair.getPublicKey().toString();

    // 1. Create signer.localnet from localnet
    const signerExists = await this.accountExists(signerAccountId);
    if (!signerExists) {
      console.log(`📝 [MPC-SETUP] Creating ${signerAccountId}...`);
      await this.masterAccount.createAccount(
        signerAccountId,
        masterKeyPair.getPublicKey(),
        utils.format.parseNearAmount("100")! // enough for contract creation + fees
      );
      // IMPORTANT: Use the master key for signer.localnet so we never lose access on retries.
      await this.keyStore.setKey(this.networkId, signerAccountId, masterKeyPair);
      console.log(`✅ [MPC-SETUP] Created ${signerAccountId}`);
    } else {
      console.log(`✅ [MPC-SETUP] ${signerAccountId} already exists`);
      // Ensure we can sign as signer.localnet. If the account was created previously with a random key,
      // we cannot recover without resetting localnet state.
      const accessKeyList: any = await this.near.connection.provider.query({
        request_type: "view_access_key_list",
        finality: "final",
        account_id: signerAccountId,
      } as any);
      const chainKeys = (accessKeyList?.keys || []).map((k: any) => k.public_key);
      if (!chainKeys.includes(masterPublicKey)) {
        throw new Error(
          `Signer account '${signerAccountId}' exists but is not controlled by the localnet master key.\n` +
            `This usually happens if a previous run created the account with a random key and then crashed.\n` +
            `Fix: reset localnet state (wipe node data) and rerun Layer 3 deploy.`
        );
      }
      await this.keyStore.setKey(this.networkId, signerAccountId, masterKeyPair);
    }

    this.signerAccount = await this.near.account(signerAccountId);

    // 2. Create v1.signer.localnet from signer.localnet
    const contractAccountId = contractId;
    const contractExists = await this.accountExists(contractAccountId);
    if (!contractExists) {
      console.log(`📝 [MPC-SETUP] Creating ${contractAccountId}...`);
      await this.signerAccount.createAccount(
        contractAccountId,
        masterKeyPair.getPublicKey(),
        utils.format.parseNearAmount("50")! // contract deployment balance
      );
      // IMPORTANT: Use the master key for the contract account so deploy/init is always repeatable.
      await this.keyStore.setKey(this.networkId, contractAccountId, masterKeyPair);
      console.log(`✅ [MPC-SETUP] Created ${contractAccountId}`);
    } else {
      console.log(`✅ [MPC-SETUP] ${contractAccountId} already exists`);
      // Ensure we can sign as the contract account. If not, we cannot deploy the WASM.
      const accessKeyList: any = await this.near.connection.provider.query({
        request_type: "view_access_key_list",
        finality: "final",
        account_id: contractAccountId,
      } as any);
      const chainKeys = (accessKeyList?.keys || []).map((k: any) => k.public_key);
      if (!chainKeys.includes(masterPublicKey)) {
        throw new Error(
          `Contract account '${contractAccountId}' exists but is not controlled by the localnet master key.\n` +
            `Fix: reset localnet state and rerun Layer 3 deploy.`
        );
      }
      await this.keyStore.setKey(this.networkId, contractAccountId, masterKeyPair);
    }

    this.contractAccount = await this.near.account(contractAccountId);
  }

  /**
   * Create MPC node accounts (expected under .localnet)
   */
  private async createMpcNodeAccounts(config: InfrastructureConfig): Promise<ParticipantInfo[]> {
    if (!this.masterAccount || !this.near) {
      throw new Error("Master account not initialized");
    }

    const reader = new InfrastructureConfigReader({
      region: this.options.region,
      profile: this.options.profile,
    });

    const nodeCount = config.mpc.nodes.length;
    const accountKeys = await reader.getMpcNodeKeys(nodeCount);
    const p2pKeys = await reader.getMpcNodeP2pPrivateKeys(nodeCount);

    const participants: ParticipantInfo[] = [];

    for (let i = 0; i < config.mpc.nodes.length; i++) {
      const nodeInfo = config.mpc.nodes[i];

      // Normalize localnet account naming:
      // Convert "mpc-node-{i}.mpc-localnet" -> "mpc-node-{i}.localnet"
      let accountId = nodeInfo.accountId;
      if (accountId.endsWith(".mpc-localnet")) {
        accountId = accountId.replace(".mpc-localnet", ".localnet");
        console.log(`📌 [MPC-SETUP] Remapped ${nodeInfo.accountId} -> ${accountId}`);
      }

      // Hard guard: if the MPC CDK stack still emits .node0 accounts, localnet master cannot create them.
      if (accountId.endsWith(".node0") && this.masterAccountId !== "node0") {
        throw new Error(
          `MPC node account '${accountId}' is under '.node0', but master account is '${this.masterAccountId}'.\n` +
            `Update MPC CDK to emit 'mpc-node-*.localnet' (or provide node0 key).`
        );
      }

      const exists = await this.accountExists(accountId);
      if (!exists) {
        console.log(`📝 [MPC-SETUP] Creating MPC node account ${accountId}...`);

        const privateKey = accountKeys.get(accountId);
        if (!privateKey) {
          throw new Error(
            `Missing Secrets Manager key for ${accountId}. Expected secret: mpc-node-${i}-mpc_account_sk`
          );
        }

        // Create the on-chain account using the SAME key that the MPC node will use to sign txs.
        const keyPair = KeyPair.fromString(privateKey as any);
        const publicKey = keyPair.getPublicKey();

        await this.masterAccount.createAccount(
          accountId,
          publicKey,
          utils.format.parseNearAmount("10")! // 10 NEAR
        );

        await this.keyStore.setKey(this.networkId, accountId, keyPair);
        console.log(`✅ [MPC-SETUP] Created ${accountId}`);
      } else {
        console.log(`✅ [MPC-SETUP] ${accountId} already exists`);

        // Ensure we can sign as the participant account by loading its key from Secrets Manager.
        const privateKey = accountKeys.get(accountId);
        if (!privateKey) {
          throw new Error(
            `Missing Secrets Manager key for existing account ${accountId}. Expected secret: mpc-node-${i}-mpc_account_sk`
          );
        }

        const keyPair = KeyPair.fromString(privateKey as any);
        const expectedPk = keyPair.getPublicKey().toString();

        // Validate that the Secrets Manager key exists on-chain. If not, votes/txs will fail.
        const accessKeyList: any = await this.near.connection.provider.query({
          request_type: "view_access_key_list",
          finality: "final",
          account_id: accountId,
        } as any);
        const chainKeys = (accessKeyList?.keys || []).map((k: any) => k.public_key);
        if (!chainKeys.includes(expectedPk)) {
          throw new Error(
            `MPC account key mismatch for ${accountId}.\n` +
              `- Secrets Manager public key: ${expectedPk}\n` +
              `- On-chain access keys: ${JSON.stringify(chainKeys)}\n\n` +
              `This usually means MPC keys were regenerated after the accounts were created.\n` +
              `Fix by restoring the original keys OR resetting localnet and recreating the MPC accounts with the current Secrets Manager keys.`
          );
        }

        await this.keyStore.setKey(this.networkId, accountId, keyPair);
      }

      // ParticipantInfo.sign_pk MUST be the node's P2P/TLS public key (NOT the NEAR account key).
      const p2pPrivateKey = p2pKeys.get(accountId);
      if (!p2pPrivateKey) {
        throw new Error(
          `Missing Secrets Manager P2P key for ${accountId}. Expected secret: mpc-node-${i}-mpc_p2p_private_key`
        );
      }

      const p2pKeyPair = KeyPair.fromString(p2pPrivateKey as any);
      const signPk = p2pKeyPair.getPublicKey().toString();

      // Build MPC node URL (use private IP from infrastructure config)
      const nodeUrl = `http://${nodeInfo.privateIp}:8080`;

      participants.push({
        accountId,
        index: i,
        signPk,
        url: nodeUrl,
      });
    }

    return participants;
  }

  /**
   * Deploy v1.signer contract
   */
  private async deployContract(contractAccountId: string): Promise<string> {
    if (!this.contractAccount) {
      throw new Error("Contract account not initialized");
    }

    // Check if contract is already deployed
    try {
      const state: any = await this.contractAccount.state();
      if (state.code_hash !== "11111111111111111111111111111111") {
        console.log(`✅ [MPC-SETUP] Contract already deployed to ${contractAccountId}`);
        return contractAccountId;
      }
    } catch {
      // Account may not exist, continue with deployment
    }

    if (!fs.existsSync(this.wasmPath)) {
      throw new Error(
        `Contract WASM file not found: ${this.wasmPath}. Run contracts/download-wasm.sh first.`
      );
    }

    const wasmCode = fs.readFileSync(this.wasmPath);
    console.log(`📦 [MPC-SETUP] Deploying contract to ${contractAccountId}...`);
    console.log(`   WASM size: ${wasmCode.length} bytes`);

    const contractKey = await this.keyStore.getKey(this.networkId, contractAccountId);
    if (!contractKey) {
      throw new Error(
        `Contract account key not in keystore. Cannot deploy contract to ${contractAccountId}.`
      );
    }

    await this.contractAccount.deployContract(wasmCode);
    console.log(`✅ [MPC-SETUP] Contract deployed to ${contractAccountId}`);
    return contractAccountId;
  }

  /**
   * Initialize contract with MPC participants
   */
  private async initializeContract(
    contractId: string,
    participants: ParticipantInfo[],
    threshold: number
  ): Promise<void> {
    if (!this.contractAccount) {
      throw new Error("Contract account not initialized");
    }
    if (!this.masterAccount) {
      throw new Error("Master account not initialized");
    }

    // Check if contract is already initialized
    try {
      await (this.contractAccount as any).viewFunction({
        contractId,
        methodName: "state",
        args: {},
      });
      console.log(`✅ [MPC-SETUP] Contract already initialized`);
      return;
    } catch (error: any) {
      if (
        !error?.message?.includes("not initialized") &&
        !error?.message?.includes("does not exist")
      ) {
        console.warn(
          `⚠️  [MPC-SETUP] Unexpected error checking initialization: ${error?.message || String(error)}`
        );
      }
    }

    const initArgs = {
      parameters: {
        participants: {
          next_id: participants.length,
          participants: participants.map((p) => [
            p.accountId,
            p.index,
            {
              sign_pk: p.signPk,
              url: p.url,
            },
          ]),
        },
        threshold,
      },
    };

    console.log(`🔧 [MPC-SETUP] Initializing contract with ${participants.length} participants...`);
    console.log(`   Threshold: ${threshold}`);

    try {
      // Sign init() using the master account; contract account key is not required for init.
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await (this.masterAccount as any).functionCall({
            contractId,
            methodName: "init",
            args: initArgs,
            gas: BigInt("300000000000000"), // 300 Tgas
          });
          break;
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (
            msg.includes("Transaction parent block hash doesn't belong to the current chain") &&
            attempt < maxAttempts
          ) {
            const delayMs = 1500 * attempt;
            console.warn(
              `⚠️  [MPC-SETUP] Init failed due to block hash mismatch (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`
            );
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          throw e;
        }
      }
      console.log(`✅ [MPC-SETUP] Contract initialized successfully`);
    } catch (error: any) {
      if (error?.message?.includes("already been initialized")) {
        console.log(`✅ [MPC-SETUP] Contract already initialized`);
      } else {
        throw new Error(`Failed to initialize contract: ${error?.message || String(error)}`);
      }
    }
  }

  /**
   * Add domains to contract (vote_add_domains)
   */
  private async addDomains(contractId: string, participants: ParticipantInfo[]): Promise<void> {
    if (!this.near) {
      throw new Error("NEAR not initialized");
    }

    console.log("🔑 [MPC-SETUP] Adding ECDSA domain to contract...");

    const domains = [
      {
        id: 0,
        scheme: "Secp256k1",
      },
    ];

    console.log(`   Voting to add domains with ${participants.length} participants...`);

    try {
      for (const participant of participants) {
        const participantAccount = await this.near.account(participant.accountId);
        const key = await this.keyStore.getKey(this.networkId, participant.accountId);
        if (!key) {
          console.warn(`⚠️  [MPC-SETUP] Skipping ${participant.accountId} - no key in keystore`);
          continue;
        }

        console.log(`   📮 Voting from ${participant.accountId}...`);

        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            await (participantAccount as any).functionCall({
              contractId,
              methodName: "vote_add_domains",
              args: { domains },
              gas: BigInt("300000000000000"), // 300 Tgas
            });
            break;
          } catch (e: any) {
            const msg = e?.message || String(e);
            if (
              msg.includes("Transaction parent block hash doesn't belong to the current chain") &&
              attempt < maxAttempts
            ) {
              const delayMs = 1500 * attempt;
              console.warn(
                `⚠️  [MPC-SETUP] vote_add_domains block hash mismatch for ${participant.accountId} (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`
              );
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
            throw e;
          }
        }

        console.log(`   ✅ Vote submitted from ${participant.accountId}`);
      }

      console.log(`✅ [MPC-SETUP] Domains added, contract transitioning to key generation...`);
      console.log(`   Note: Key generation may take 5-10 minutes`);
    } catch (error: any) {
      if (error?.message?.includes("already") || error?.message?.includes("Initializing")) {
        console.log(`✅ [MPC-SETUP] Domains already added or key generation in progress`);
      } else {
        throw new Error(`Failed to add domains: ${error?.message || String(error)}`);
      }
    }
  }

  /**
   * Check if account exists
   */
  private async accountExists(accountId: string): Promise<boolean> {
    if (!this.near) {
      throw new Error("NEAR not initialized");
    }

    try {
      const account = await this.near.account(accountId);
      await account.state();
      return true;
    } catch (error: any) {
      if (
        error?.message?.includes("does not exist") ||
        error?.message?.includes("doesn't exist") ||
        error?.type === "AccountDoesNotExist"
      ) {
        return false;
      }
      throw error;
    }
  }
}
