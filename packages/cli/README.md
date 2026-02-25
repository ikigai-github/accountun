## CLI

The CLI package consists of commands for interacting with the tournament accounting contract.   The commands are executed through the `bun cli` script.  Any command can have a `-h` flag passed to it to view details on the parameters and purpose of the command.  

```sh
bun cli -h
│ Usage: accountun [options] [command]
│ 
│ Tournament accounting CLI
│ 
│ Options:
│   -V, --version       output the version number
│   -h, --help          display help for command
│ 
│ Commands:
│   deploy              Deploy the tournament-accounting contract and print the
│                       contract address
│   wallet              Construct the wallet from seed hex and print its address
│                       and balance
│   dust [options]      Registers Night for dust generation at a set of target addresses
│   register [options]  Register a tournament
│   fund [options]      Record funding for a tournament
│   cancel [options]    Cancel a registered tournament
│   results [options]   Post the results of a tournament
│   state [options]     Read a tournament state and placements from chain
│   plan [options]      Plan the payouts for a tournament
│   receipts [options]  Record the receipts for a tournament 
│   complete [options]  Complete a registered tournament
│   help [command]      display help for command
```

### Setting up environment

Environment variables can be set via normal means or via a dotenv file in this directory.

```
AUTH_SECRET_HEX='NO-DEFAULT'
AUTH_REPLACEMENT_KEY_HEX='NO-DEFAULT'
SERVICE_WALLET_SEED_HEX='NO-DEFAULT'
NETWORK='preprod' # Supported remote defaults: preprod, preview
NETWORK_MODE='remote' # Can be set to 'local' for local service URI defaults 
STATE_PATH='.state' # Directory where state data is saved

# Below are defaults if NETWORK_MODE is set to remote
SUBSTRATE_NODE_URI='https://rpc.preprod.midnight.network'
INDEXER_HTTP_URI='https://indexer.preprod.midnight.network/api/v3/graphql' 
INDEXER_WS_URI='wss://indexer.preprod.midnight.network/api/v3/graphql/ws'
PROOF_SERVER_URI='http://127.0.0.1:6300'

# Below are defaults if NETWORK_MODE is set to local
SUBSTRATE_NODE_URI='http://127.0.0.1:9944'
INDEXER_HTTP_URI='http://127.0.0.1:8088/api/v3/graphql' 
INDEXER_WS_URI='ws://127.0.0.1:8088/api/v3/graphql/ws'
PROOF_SERVER_URI='http://127.0.0.1:6300'

```

The AUTH_SECRET_HEX, AUTH_REPLACEMENT_KEY_HEX, and SERVICE_WALLET_SEED_HEX need to be 32-byte hex strings.  The replacement key isn't required unless you specifically are rotating the secret key.

### Creating a wallet

The command `bun cli wallet` can help to setup. The command will try and restore a wallet from a state file if one is found. Otherwise it will use the afformentioned SERVICE_WALLET_SEED_HEX environment variable. Once the wallet is restored or built it will print the wallet address and current balance.

By default this checks account index `0` (main wallet). Use `--index` to inspect a sub-wallet derived from the same seed:

```sh
bun cli wallet --index 1
```

To validate which DUST receiver address a Cardano reward address is currently registered to, pass `--reward-address`:

```sh
bun cli wallet --index 1 --reward-address stake_test1...
```

Note: the indexer status query is keyed by Cardano reward address (`stake...`), not by unshielded public key.

### Reading tournament state

Use `bun cli state --id <uuid>` to read the tournament state directly from on-chain ledger data.

If the state is `ResultPosted`, `PayoutReady`, or `PayoutComplete`, the command also prints the result placements in order.

```sh
bun cli state --id 11111111-2222-3333-4444-555555555555
```

### Planning and executing dust allocations

Use `bun cli dust` to plan dust targets in Specks and immediately execute the resulting actions.

If `--csv` is omitted, the command plans with no requested allocations, then executes no-op/sweep actions if present.

Use `--refresh-balances` to force a chain read of all relevant wallet balances and refresh the local balance cache before planning.

Use `--target-window-ms` to control how quickly each allocation should reach its `targetSpecks` estimate (default: 1 day).

Example (allocate everything back to service dust address):

```sh
bun cli dust
```

Example with allocation targets:

```sh
bun cli dust \
	--csv ./dust-allocations.csv \
	--main-reserve-percent 50 \
	--request-id payout-cycle-2026-02-19
```

`dust-allocations.csv` should include columns:

- `dustAddress` (required)
- `targetSpecks` (required)

Example CSV:

```sh
dustAddress,targetSpecks
<bech32m-dust-address-1>,1000000
<bech32m-dust-address-2>,500000
```


### Contract Deployment

Below are the detailed steps for deploying the contract.  You can run package specific commands from their corresponding package directory but to avoid having to change directories often the commands can all be run from the root directory.  The example below is an example of running the commands from the project root.

1. Compile the contract

```sh
❯ bun compile
│ Compiling 9 circuits:
└─ Done in xx.xx s
```

2. Start proof server if it has not already been started

```sh
❯ bun proof-server
$ docker compose up -d proof-server
[+] Running 1/0
 ✔ Container accountun-proof-server-1  Running    
```

3. Check wallet is connected and has funds

```sh
❯ bun cli wallet
│ Restoring wallet from state file: /home/cgarvis/projects/genun/accountun/.state/preprod-wallet-state.json
│ ℹ Fetching wallet state from network
│ ℹ Saving wallet to disk
│ 🌐 Network: preprod
│ 🔑 Wallet address: mn_shield-addr_test16wp...(snipped)...d5d
│ ✨ Dust balance: XXXXXXXXXn
└─ Done in xx.xx s
```

If your wallet doesn't yet have dust you can request funds from the Midnight faucet for your selected network using the wallet address printed above.

4. Deploy the contract

```sh
❯ bun cli deploy
│ Restoring wallet from state file: /your/project/dir/accountun/.state/preprod-wallet-state.json
│ ℹ Deploying contract for network: preprod
│ ✅ Deployed contract address: 020...(snipped)...4e5
└─ Done in XX.XX s
```

The contract address will be saved in a rolling `${STATE_PATH}/${NETWORK}-contract-address.json` so that you don't need to include it when interacting with the contract via the other CLI commands, though there is an override if needed.

### Interacting wth the contract

Most of the other CLI commands only function with a deployed contract and usually also a registered tournament.   The general command strcture for the commands are `bun cli [command] --id <tournament-id> --other-params`  
