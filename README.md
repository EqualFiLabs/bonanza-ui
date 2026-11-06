# Bonanza

The web app for Bonanza, onchain rounds on Robinhood Chain. Every ticket is a pixel of static until
a drand beacon, fixed before its value existed, picks the winner. Playing earns BONA, and staking
BONA earns a share of every ticket sold.

Built with Next.js 16, React 19, Privy, Wagmi and Viem. The contracts live in
[EqualFiLabs/bonanza](https://github.com/EqualFiLabs/bonanza).

## Status

No network has a current deployment yet, so a public build shows "Not live yet". Real contract
behavior is exercised on a local Robinhood Mainnet fork, described below. The contract source still
uses the FIDDY name; the app calls the token BONA and takes its ABI from a pinned contract commit.

## Architecture

- **Wallets.** Privy with the shared EqualFi App ID, matching `statics-app`, so a user keeps the same
  embedded wallet across apps. External wallets work too.
- **Reads** go through a same-origin RPC proxy so upstream credentials stay on the server. The proxy
  accepts read methods only. Embedded-wallet writes use a separate proxy that accepts one signed
  transaction at a time.
- **Addresses** come from reviewed manifests in `deployments/manifests.ts`. A network with no entry
  shows that Bonanza isn't live there, and local manifests are ignored outside development.
- **Data** comes straight from the chain: contract views for rounds and accounts, and
  `TicketsPurchased` logs for a wallet's tickets. There is no backend or indexer.
- **Draws** need no server. The app fetches the committed Quicknet beacon from a public drand relay
  and passes it to `settleRound`, which verifies it through the registry onchain.
- **Time** follows block timestamps, the clock the contracts enforce, rather than the browser's.

## Develop

Requires Node 22.13 or newer.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Without a Privy App ID the app runs with sign-in disabled. To copy only the public Privy identifiers
from another app's environment file:

```sh
PRIVY_ENV_PATH=<path to env file> npm run config:privy:local
```

## Local fork

The fork runs the app against real contracts. It pins Robinhood Mainnet in Anvil and uses the live
STATICS, WETH, Operator NFT, activation registry and drand registry. It deploys the actual Lottery
facets, a fully bootstrapped Operator Fee Router and the pinned Statics position contracts, then
seeds rounds with ordinary transactions and draws one with a genuine Quicknet signature.

Requirements: Foundry, a checkout of the contracts repo with submodules, and a Robinhood Chain RPC
with archive state.

```sh
export ROBINHOOD_MAINNET=<rpc url>
export BONANZA_CONTRACTS_DIR=../bonanza

npm run fork:build   # compile contracts into .local, leaving the contract checkout untouched
npm run fork:up      # first run takes several minutes while Anvil fills its fork cache
npm run dev:fork     # app on port 3000, signing with an unlocked test wallet
```

`BONANZA_FORK_WALLET=privy npm run dev:fork` signs with real Privy login instead. Use **Fund this
wallet** in the Fork panel to give that wallet test funds.

The Fork panel holds real governance calls and clock moves: skip a round to its draw, skip 24 hours,
pause the protocol, and open unwrap or public wrap.

| Command               | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `npm run fork:status` | Show the fork's block, chain time and addresses |
| `npm run fork:reset`  | Return to the seeded state and clock            |
| `npm run fork:down`   | Stop the fork                                   |
| `npm run abi:sync`    | Regenerate the Lottery ABI from built artifacts |

## Test

```sh
npm run verify    # lint, formatting, types, unit tests and a production build
npm run test:e2e  # fail-closed public build in a browser
npm run test:fork # every user flow against real contracts on the fork
```

`test:fork` needs a running fork and checks results onchain. It covers position creation, exact
approvals, buying, sellout and deadline draws with genuine beacons, winner and tip claims, staking
and its lock, Operator boosts, revenue claims, pausing and conversions.

## Deploy

Set the server-only RPC variables and `BONANZA_CSP_MODE` from `.env.example`, and add the app's
origins to the Privy dashboard's allowed list. Before a network can go live, its reviewed deployment
needs an entry in `deployments/manifests.ts`.

## License

[Business Source License 1.1](LICENSE).
