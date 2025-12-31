import json
import os

GENESIS_PATHS = [
    '/home/ubuntu/.near/localnet/node0/genesis.json',
    '/home/ubuntu/.near/localnet/node1/genesis.json',
    '/home/ubuntu/.near/localnet/node2/genesis.json',
    '/home/ubuntu/.near/localnet/node3/genesis.json'
]

NEW_ACCOUNTS = [
    {
        "id": "mpc-node-0.node0",
        "pk": "ed25519:69CETJnEyCTaQ7B3PxEWrsMWpoufayKFhHWN15HQ8smR"
    },
    {
        "id": "mpc-node-1.node0",
        "pk": "ed25519:93pcUSau23m7imF94gny2R9c8UDvGHGmiVFKr7j4pkjP"
    },
    {
        "id": "mpc-node-2.node0",
        "pk": "ed25519:5CJ4d6byRNacX5QNaASHGXmURtWE48xARnNGWAwKRiWg"
    }
]

AMOUNT = "10000000000000000000000000" # 10 NEAR

def update_genesis(path):
    if not os.path.exists(path):
        print(f"Skipping {path} (not found)")
        return

    print(f"Updating {path}...")
    with open(path, 'r') as f:
        data = json.load(f)

    records = data['records']
    
    # Check if accounts already exist (to avoid duplicates if run twice)
    existing_ids = set()
    for r in records:
        if 'Account' in r:
            existing_ids.add(r['Account']['account_id'])
    
    added_balance = 0
    
    for acc in NEW_ACCOUNTS:
        if acc['id'] in existing_ids:
            print(f"  Account {acc['id']} already exists, skipping")
            continue
            
        print(f"  Adding {acc['id']}")
        
        # Add Account
        records.append({
            "Account": {
                "account_id": acc['id'],
                "account": {
                    "amount": AMOUNT,
                    "locked": "0",
                    "code_hash": "11111111111111111111111111111111",
                    "storage_usage": 0,
                    "version": "V1"
                }
            }
        })
        
        # Add AccessKey
        records.append({
            "AccessKey": {
                "account_id": acc['id'],
                "public_key": acc['pk'],
                "access_key": {
                    "nonce": 0,
                    "permission": "FullAccess"
                }
            }
        })
        
        added_balance += int(AMOUNT)

    # Deduct from treasury 'near'
    for r in records:
        if 'Account' in r and r['Account']['account_id'] == 'near':
            current = int(r['Account']['account']['amount'])
            new_amount = current - added_balance
            r['Account']['account']['amount'] = str(new_amount)
            print(f"  Deducted {added_balance} from 'near' account")
            break
            
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print("  Done.")

for p in GENESIS_PATHS:
    update_genesis(p)

