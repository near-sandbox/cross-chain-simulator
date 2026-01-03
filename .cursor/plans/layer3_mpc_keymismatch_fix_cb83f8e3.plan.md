---
name: Layer3_MPC_KeyMismatch_Fix
overview: Fix Layer 3 MPC runtime by restoring the MPC node NEAR account keys in AWS Secrets Manager to match the already-created on-chain access keys and contract participant configuration, then restart the MPC nodes and verify the protocol reaches Running state.
todos:
  - id: confirm-key-mismatch
    content: Confirm on-chain access keys for mpc-node-*.localnet differ from Secrets Manager mpc_account_sk-derived pubkeys, and identify the correct SKs from mpc-node-keys.json.
    status: pending
  - id: restore-secretsmanager-keys
    content: Restore Secrets Manager mpc-node-{i}-mpc_account_sk values using mpc-node-keys.json via scripts/update-secrets.sh (profile shai-sandbox-profile).
    status: pending
    dependencies:
      - confirm-key-mismatch
  - id: restart-mpc-nodes
    content: Restart MPC node containers on all MPC EC2 instances so they reload corrected secrets; verify /health from inside VPC.
    status: pending
    dependencies:
      - restore-secretsmanager-keys
  - id: verify-contract-running
    content: Verify v1.signer.localnet state transitions to Running and public_key(domain_id=0) succeeds; confirm MPC logs no longer show AccessKeyNotFound.
    status: pending
    dependencies:
      - restart-mpc-nodes
  - id: rerun-parity-view-tests
    content: Re-run test-parity.ts in view-only mode to confirm Test 1 & 2 pass (root + derived public key).
    status: pending
    dependencies:
      - verify-contract-running
---

# Fix Layer 3 MPC: Restore NEAR account keys to match on-chain keys

## Goal

Unblock Chain Signatures by fixing the **MPC node NEAR account key mismatch** so MPC nodes can submit on-chain txs (e.g., `SubmitParticipantInfo`) and the contract can transition from **Initializing → Running**.

## Scope / Guardrails

- **Only Layer 3 MPC runtime stability.**
- **No architecture changes** and no unrelated refactors.
- Minimal changes: secrets + restart + verification.

## Current Facts (root cause)

- Contract `v1.signer.localnet` is stuck in **Initializing**.
- MPC node logs show:
- `InvalidAccessKeyError(AccessKeyNotFound { account_id: mpc-node-0.localnet, public_key: ed25519:7hEV... })`
- On-chain access keys for `mpc-node-{0,1,2}.localnet` do **not** match the current Secrets Manager `mpc-node-{i}-mpc_account_sk` values.
- The on-chain keys match the expected `MPC_ACCOUNT_PK` values in:
- `cross-chain-simulator/mpc-repo/infra/aws-cdk/mpc-node-keys.json`

## Plan

### 1) Confirm mismatch (fast pre-check)

- Use port-forwarded NEAR RPC (`localhost:3030`) to fetch access keys:
- `view_access_key_list` for `mpc-node-0.localnet`, `mpc-node-1.localnet`, `mpc-node-2.localnet`
- Fetch Secrets Manager current `mpc_account_sk` and derive public keys.
- Confirm mismatch is present and identify the correct keys from `mpc-node-keys.json`.

### 2) Restore Secrets Manager account keys to the correct set

- **Source of truth**: `cross-chain-simulator/mpc-repo/infra/aws-cdk/mpc-node-keys.json`
- For each node `i in {0,1,2}`:
- Write `MPC_ACCOUNT_SK` → Secrets Manager secret `mpc-node-{i}-mpc_account_sk`
- Use the existing script:
- `cross-chain-simulator/mpc-repo/infra/aws-cdk/scripts/update-secrets.sh`
- Ensure it targets the correct AWS profile: `shai-sandbox-profile`

### 3) Restart MPC node containers so they pick up the corrected secrets

- For each MPC instance (`i-0e5ac5db9a98ed1e0`, `i-058507207689fe120`, `i-0bc5269a2e3482cf7`):
- Restart the running container/service (`docker restart mpc-node` or the systemd unit if used)
- Verify the node is healthy via `/health` **from inside VPC** (SSM on NEAR base instance is fine)

### 4) Verify the protocol moves to Running

- Query contract `state()` via NEAR RPC (`localhost:3030` over SSM port-forward):
- Expect **Initializing** → eventually **Running**
- Re-run a view call that previously failed:
- `public_key({ domain_id: 0 })`
- Check MPC node logs for successful submission of participant info and/or keygen progression.

### 5) Re-run parity smoke check (no signing yet)

- Run `test-parity.ts` in **view-only** mode (no signer key required):
- `getRootPublicKey(domain_id=0)`
- `callDerivedPublicKey(path, domain_id=0, predecessorId)`

## Rollback / Safety

- If restoring keys causes unexpected behavior, revert Secrets Manager to AWSPREVIOUS (where valid) or re-run the “known-good” key generation + update process and **reset localnet** (only if necessary).

## Definition of Done

- MPC nodes no longer log `AccessKeyNotFound` for their own account.
- Contract `state()` is **Running**.