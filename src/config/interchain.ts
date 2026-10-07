/**
 * Deployment data for swapping on Osmosis: the venue, the crosschain-swaps
 * contract to check, the router, the slippage policy, the price lifetime and
 * the explorers a hash links to.
 *
 * Ported from zunia-extension config/interchain.ts @ 1453e7a, so the dashboard
 * and the extension quote, gate and sign a swap under the same numbers.
 *
 * Pure constants, safe in the browser bundle. Nothing here is trusted without
 * a check: the contract address is a *candidate* that the server reads off
 * the chain (`src/lib/server/swap/venue.ts`) before any contract path is
 * offered, and the swap fails closed with a named reason when the address is
 * unset, unreachable, or answers with another contract. The environment
 * override is read on the server only (venue.ts), never here, so a client
 * bundle can neither be talked into another address nor learn the setting's
 * name.
 */

/** The chain every Zunia swap executes on: its pools and its crosschain-swaps contract. */
export const SWAP_VENUE_CHAIN_ID = "osmosis-1";

/**
 * Crosschain-swaps addresses, highest confidence first.
 *
 * The one entry answered on 2026-10-05 (and again on 2026-10-07 from this
 * machine) with label "CrossChainSwaps v1.2", code 37, whose raw `config`
 * names the swaprouter `osmo1fy547nr4…gdqx7`. Recorded so the server has
 * something to *check*, not something to trust: a wrong address in an
 * ibc-hooks memo sends funds to a contract that will not send them back.
 * Never inline it at a call site; read it through the venue check.
 */
export const XCS_CONTRACT_CANDIDATES: readonly string[] = [
  "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs",
];

/**
 * What the venue check expects the contract's on-chain `label` to start with.
 * A different label is a different contract (a swaprouter, a registry, a
 * token), and its address must never land in a swap memo.
 */
export const XCS_CONTRACT_LABEL_PREFIX = "CrossChainSwaps";

/**
 * The code ids the venue check accepts behind the contract, as decimal
 * strings. The label alone cannot carry this: it is fixed at instantiation and
 * survives a migration, and the deployment's admin is a plain account
 * (`osmo1tfu4j7…dlm3v` on 2026-10-07), not governance, so it can move the
 * contract to any code at any time. Code 37 is the crosschain-swaps build both
 * Zunia clients were written and tested against. A migration therefore turns
 * the contract path off, with a named reason, until someone has read the new
 * code and added its id here; the pool paths keep working meanwhile.
 */
export const XCS_CONTRACT_CODE_IDS: readonly string[] = ["37"];

/**
 * Public SQS router hosts, in priority order.
 *
 * The pool graph is not on chain in a form the LCD can search by denom pair,
 * so without a router nothing can be priced and every swap control stays
 * disabled. The second host is the same service under its production name,
 * tried when the first does not answer.
 */
export const SWAP_ROUTER_ENDPOINTS: readonly string[] = [
  "https://sqs.osmosis.zone",
  "https://sqsprod.osmosis.zone",
];

/**
 * Slippage tolerance, as a percentage on the 0-100 scale the swaprouter reads
 * (`percentage_impact.div(100)`), not a 0-1 fraction.
 *
 * 1% is a defensible middle: tight enough that a real adverse move fails the
 * swap (and refunds), loose enough that an ordinary pair does not fail on the
 * normal drift between signing and inclusion or packet delivery.
 */
export const DEFAULT_SLIPPAGE_PERCENT = 1;

/** Offered as one-tap choices. Any value in range can still be typed. */
export const SLIPPAGE_PRESETS: readonly number[] = [0.5, 1, 3];

/**
 * Above this the UI warns before the user can confirm. Not a limit: a thin
 * pool genuinely needs a wide tolerance. It is where the number stops being
 * routine and the user should be told what they are agreeing to lose.
 */
export const HIGH_SLIPPAGE_PERCENT = 3;

/** Refused outright. A 50% tolerance is indistinguishable from none. */
export const MAX_SLIPPAGE_PERCENT = 50;

/**
 * Price impact (the router's own figure, in percent, positive against the
 * user) from which the swap page colours and words it as a caution, then as a
 * warning. Not limits: nothing is refused for it, because the minimum the
 * user signs already bounds the loss. Below 1% the order is small for the
 * pools it crosses; from 5% a noticeable share of what is sold goes into
 * moving the price, and a smaller amount or another pair usually does better.
 * One pair of numbers so every surface (form, route panel, review card) says
 * the same thing about the same quote.
 */
export const PRICE_IMPACT_CAUTION_PERCENT = 1;
export const PRICE_IMPACT_WARNING_PERCENT = 5;

/**
 * The TWAP window the contract path's slippage rule averages over, in
 * seconds. Matches the crosschain-swaps README and the extension, so a memo
 * the dashboard builds reads the same as one the extension builds.
 */
export const TWAP_WINDOW_SECONDS = 10;

/** Per-hop ICS20 packet timeout, in minutes. */
export const PACKET_TIMEOUT_MINUTES = 10;

/** Hop ceiling for a route. Each extra hop is another timeout to survive. */
export const MAX_ROUTE_HOPS = 3;

/**
 * How long a swap price counts as current. Past it the form fetches a new one
 * on its own, and the review will not sign until the price is refreshed.
 */
export const QUOTE_TTL_MS = 20_000;

/**
 * Block explorers, keyed by chain id, for linking a transaction hash.
 *
 * Each template is the chain's `explorers[].tx_page` in cosmos/chain-registry
 * (read September 2026), as the extension ships it: Mintscan where the
 * registry lists it, otherwise the explorer the registry names. A guessed
 * domain is worse than none (it 404s or shows somebody else's chain), so a
 * chain missing here keeps its hashes as selectable text.
 */
export const EXPLORER_TX_URLS: Readonly<Record<string, string>> = {
  "safrochain-1": "https://explorer.safrochain.com/tx/{hash}",
  "safro-testnet-1": "https://explorer.testnet.safrochain.com/transactions/{hash}",
  "cosmoshub-4": "https://www.mintscan.io/cosmos/transactions/{hash}",
  "osmosis-1": "https://www.mintscan.io/osmosis/transactions/{hash}",
  "akashnet-2": "https://www.mintscan.io/akash/transactions/{hash}",
  "archway-1": "https://archway.explorers.guru/transaction/{hash}",
  "axelar-dojo-1": "https://www.mintscan.io/axelar/transactions/{hash}",
  celestia: "https://celestia.explorers.guru/transaction/{hash}",
  "dydx-mainnet-1": "https://www.mintscan.io/dydx/txs/{hash}",
  "dymension_1100-1": "https://www.mintscan.io/dymension/tx/{hash}",
  "evmos_9001-2": "https://www.mintscan.io/evmos/transactions/{hash}",
  "injective-1": "https://www.mintscan.io/injective/transactions/{hash}",
  "juno-1": "https://ezstaking.app/juno/txs/{hash}",
  "kaiyo-1": "https://finder.kujira.app/kaiyo-1/tx/{hash}",
  "mantra-1": "https://mintscan.io/mantra/txs/{hash}",
  "neutron-1": "https://www.mintscan.io/neutron/transactions/{hash}",
  "noble-1": "https://www.mintscan.io/noble/txs/{hash}",
  "phoenix-1": "https://www.mintscan.io/terra/transactions/{hash}",
  "secret-4": "https://www.mintscan.io/secret/transactions/{hash}",
  "sentinelhub-2": "https://explorer.sentinel.co/transactions/{hash}",
  "stride-1": "https://www.mintscan.io/stride/transactions/{hash}",
};

/** Explorer URL for a hash, or `null` when no explorer is known for the chain. */
export function explorerTxUrl(chainId: string, txHash: string): string | null {
  if (!Object.hasOwn(EXPLORER_TX_URLS, chainId)) return null;
  const template = EXPLORER_TX_URLS[chainId];
  if (!template) return null;
  return template.replace("{hash}", encodeURIComponent(txHash));
}
