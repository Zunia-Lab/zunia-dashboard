/**
 * The public contract of the chain analytics API: `/api/chains/*`,
 * `/api/validators/*`, `/api/staking`, `/api/governance/*`, `/api/security`.
 *
 * Types only, so both the route handlers and the browser hooks
 * (`@/lib/data/*`) import the same shapes and cannot drift apart.
 *
 * Conventions every shape follows (the house honesty rules):
 *
 * - Amounts are base-unit integer strings (`"658043304304364"`), never floats,
 *   so an 18-decimal token keeps every digit. The chain's `nativeDecimals` /
 *   `decimals` say how to display them.
 * - Ratios (APR, inflation, shares, uptime, commission) are fractions 0..1
 *   (`0.1834` is 18.34 %), never percents.
 * - Unknown is `null`, never `0`: a figure that could not be read or computed
 *   is null and, where it matters, `reasons[field]` says why, so the UI can
 *   show "—" with an explanation instead of a made-up number.
 * - Partial data beats no data: a response lists what failed in `errors`
 *   instead of failing whole.
 */

import type { FiatCurrency, SpotPrice } from "@/lib/token/types";

/** One upstream part that could not be read. Never contains upstream bodies. */
export interface PartError {
  chainId?: string;
  /** What was being read, e.g. "mint", "pool", "validators", "tally:1058". */
  scope: string;
  message: string;
}

export interface Coin {
  denom: string;
  /** Base units, integer string. */
  amount: string;
}

/* -------------------------------------------------------------------------- *
 * Chain economics (GET /api/chains/stats, GET /api/chains/[chainId])
 * -------------------------------------------------------------------------- */

/**
 * Where the APR came from.
 *
 * - `lcd`: the chain's own x/mint (`annual_provisions`, `inflation`, params).
 * - `osmosis-mint`: Osmosis epoch issuance (`epoch_provisions` × epochs per
 *   year × `distribution_proportions.staking`).
 * - `cosmos.directory`: third-party fallback when the chain exposes no mint
 *   data we can read; the UI must label it.
 */
export type AprSource = "lcd" | "osmosis-mint" | "cosmos.directory";

export interface ChainApr {
  /**
   * Staking APR as the mint parameters publish it, before validator
   * commission: provisions × (1 − community tax) ÷ bonded tokens.
   */
  naive: number | null;
  /**
   * What delegators actually earn before commission: the naive APR rescaled
   * by observed blocks per year ÷ `params.blocks_per_year` (x/mint pays per
   * block, so faster blocks pay more). Equals `naive` when issuance does not
   * depend on block time (epoch or time based mints); `note` then says so.
   */
  actual: number | null;
  source: AprSource | null;
  /** Why `actual` equals `naive`, or why a figure is missing. */
  note?: string;
  /** One line describing the formula used, for a "how is this computed" tip. */
  method?: string;
  /** Observed ÷ assumed blocks per year when the block-time correction applied. */
  blockTimeFactor: number | null;
  /** Mint rewards only: fees, MEV or taker-fee revenue shares are not included. */
  excludesFees: true;
}

export interface ChainInflation {
  /** The x/mint `inflation` parameter as published (assumes params.blocks_per_year). */
  param: number | null;
  /** Issuance actually happening per year ÷ total supply (block-time corrected). */
  actual: number | null;
}

export interface SlashingParams {
  /** Blocks in the uptime window. */
  signedBlocksWindow: number | null;
  /** Minimum share of the window a validator must sign to avoid jail. */
  minSignedPerWindow: number | null;
  downtimeJailSeconds: number | null;
  /** Share of stake slashed for downtime (often 0.0001 or 0). */
  slashFractionDowntime: number | null;
  /** Share of stake slashed for double signing (often 0.05). */
  slashFractionDoubleSign: number | null;
}

export interface GovParams {
  quorum: number | null;
  threshold: number | null;
  vetoThreshold: number | null;
  /** Threshold for expedited proposals (gov v1, SDK ≥ 0.50). */
  expeditedThreshold: number | null;
  votingPeriodDays: number | null;
  expeditedVotingPeriodDays: number | null;
  depositPeriodDays: number | null;
  minDeposit: Coin[] | null;
  /** Which gov API answered. */
  api: "v1" | "v1beta1";
}

/** Nullable `ChainStats` fields that `reasons` can explain. */
export type ChainStatsField =
  | "price"
  | "apr"
  | "inflation"
  | "realYield"
  | "bondedRatio"
  | "bondedTokens"
  | "totalSupply"
  | "communityTax"
  | "unbondingDays"
  | "maxValidators"
  | "minCommission"
  | "activeValidators"
  | "nakamoto"
  | "top10Share"
  | "medianCommission"
  | "blockTimeSec"
  | "latestHeight"
  | "halted"
  | "slashing"
  | "gov";

export interface ChainStats {
  chainId: string;
  chainName: string;
  network: "mainnet" | "testnet";
  iconUrl: string | null;
  /** Ticker of the staking token, e.g. "SAF". */
  nativeSymbol: string;
  /** Staking (bond) denom, e.g. "usaf". */
  nativeDenom: string;
  /** Decimals of the staking denom; null when the catalog does not know them. */
  nativeDecimals: number | null;
  /**
   * Spot price of the staking token in the response's `currency`, from the
   * shared prices module (Numia / Coinstore / CoinGecko, with its `source`
   * and read time `at`); null with `reasons.price` when unpriced or
   * unreachable.
   */
  price: SpotPrice | null;
  apr: ChainApr;
  inflation: ChainInflation;
  /** `apr.actual − inflation.actual`: what staking adds to your share of supply. */
  realYield: number | null;
  /** Bonded tokens ÷ total supply of the staking denom. */
  bondedRatio: number | null;
  /** x/mint `goal_bonded` when the chain has one. */
  goalBonded: number | null;
  bondedTokens: string | null;
  notBondedTokens: string | null;
  totalSupply: string | null;
  communityTax: number | null;
  unbondingDays: number | null;
  maxValidators: number | null;
  minCommission: number | null;
  /** Bonded validators. */
  activeValidators: number | null;
  /** Smallest number of validators holding more than 1/3 of voting power. */
  nakamoto: number | null;
  /** Voting power share of the 10 largest validators. */
  top10Share: number | null;
  /** Median commission rate of bonded validators. */
  medianCommission: number | null;
  /** Observed average block time over the last `blockTimeWindow` blocks. */
  blockTimeSec: number | null;
  /** Block time implied by `params.blocks_per_year` (what the mint assumes). */
  paramsBlockTimeSec: number | null;
  /** Blocks the observed block time was measured over. */
  blockTimeWindow: number | null;
  latestHeight: number | null;
  /** ISO time of the latest block the endpoint served. */
  latestBlockTime: string | null;
  /**
   * The endpoint's latest block is more than 5 minutes old: the chain is
   * halted or the public node is stalled (the UI should say "or stalled").
   */
  halted: boolean | null;
  slashing: SlashingParams | null;
  gov: GovParams | null;
  /** Why a field is null (or why `apr.actual` is missing). */
  reasons?: Partial<Record<ChainStatsField, string>>;
  errors?: PartError[];
}

export interface ChainStatsResponse {
  /** When the oldest live figure in this payload was read (epoch ms). */
  updatedAt: number;
  /** Currency of every `price` (the `currency` query parameter; default usd). */
  currency: FiatCurrency;
  chains: ChainStats[];
  /** Requested ids that are not in the catalog. */
  unknown?: string[];
  errors?: PartError[];
}

/** Bonded validator set at a glance. */
export interface ValidatorSetSummary {
  /** Bonded validators. */
  active: number;
  maxValidators: number | null;
  /** True when every active slot is taken (a newcomer must outbid the cutoff). */
  activeSetFull: boolean | null;
  /** Smallest bonded stake when the set is full; null when anyone can join. */
  cutoffTokens: string | null;
  nakamoto: number | null;
  top10Share: number | null;
  medianCommission: number | null;
  /** Sum of bonded validators' tokens. */
  bondedTokens: string | null;
  /** The chain's actual APR (before commission). */
  aprActual: number | null;
  /** Why `aprActual` is null, when it is. */
  aprNote?: string;
  /** Uptime window length (slashing `signed_blocks_window`). */
  signedBlocksWindow: number | null;
}

export interface ChainDetailResponse {
  updatedAt: number;
  /** Currency of `chain.price`. */
  currency: FiatCurrency;
  chain: ChainStats;
  validatorSet:
    | (ValidatorSetSummary & {
        /** The 10 largest validators, for a voting-power BarList. */
        top: Array<{
          operatorAddress: string;
          moniker: string;
          logoUrl?: string;
          rank: number;
          votingPower: number;
        }>;
        /** Share held by everyone outside `top`. */
        othersShare: number;
      })
    | null;
  /** Open proposals on this chain; null when governance could not be read. */
  proposals: { voting: number; deposit: number } | null;
  errors?: PartError[];
}

/* -------------------------------------------------------------------------- *
 * Validators (GET /api/validators, GET /api/validators/[address])
 * -------------------------------------------------------------------------- */

export type ValidatorStatus = "bonded" | "unbonding" | "unbonded";

export interface ValidatorCommission {
  rate: number;
  maxRate: number;
  /** Largest change allowed per 24 h. */
  maxChangeRate: number;
  /** Last commission change (ISO), null when unknown. */
  updatedAt: string | null;
  /** Highest rate the validator can legally reach within 30 days from now. */
  reachable30d: number;
  /** Same within 90 days. */
  reachable90d: number;
}

export interface ValidatorRow {
  operatorAddress: string;
  /** The operator's own account (valoper bytes on the account prefix). */
  accountAddress: string | null;
  /** Consensus address used to join signing info (`<prefix>valcons1…`). */
  consensusAddress: string | null;
  moniker: string;
  identity?: string;
  /** http(s) URL only; anything else is dropped. */
  website?: string;
  details?: string;
  securityContact?: string;
  logoUrl?: string;
  /** 1-based rank by tokens among bonded validators; null when not bonded. */
  rank: number | null;
  status: ValidatorStatus;
  jailed: boolean;
  /** Null when signing info could not be joined. */
  tombstoned: boolean | null;
  /** Set when the validator has been jailed at least once (jail end time, ISO). */
  jailedUntil: string | null;
  /** When an unbonding validator finishes unbonding (ISO). */
  unbondingTime: string | null;
  tokens: string;
  delegatorShares: string;
  minSelfDelegation: string;
  /** Share of bonded tokens, 0..1 (0 when not bonded). */
  votingPower: number;
  /** Cumulative share up to and including this validator; null when not bonded. */
  cumulative: number | null;
  /** Part of the smallest set holding more than 1/3 (the Nakamoto set). */
  inNakamotoSet: boolean;
  commission: ValidatorCommission;
  /**
   * Signed share of the current uptime window, 0..1. Null when the signing
   * info could not be joined, and always null for validators outside the
   * bonded set (x/slashing stops counting and resets the counter on jail, so
   * their stored figure would read as a perfect 100 %).
   */
  uptime: number | null;
  missedBlocks: number | null;
  /** Blocks counted in the current window (≤ signed_blocks_window). */
  signedWindow: number | null;
  /**
   * What delegators earn here: chain actual APR × (1 − commission). 0 when the
   * validator is jailed or not bonded (it earns nothing while inactive).
   */
  apr: number | null;
}

export interface ValidatorsResponse {
  updatedAt: number;
  chainId: string;
  chainName: string;
  symbol: string;
  decimals: number | null;
  /** "bonded" lists the active set; "all" adds inactive ones (capped). */
  status: "bonded" | "all";
  summary: ValidatorSetSummary;
  validators: ValidatorRow[];
  /** True when inactive validators were cut at the cap. */
  truncated?: boolean;
  errors?: PartError[];
}

export interface ValidatorSlash {
  /** Distribution period of the slash (heights are not exposed over REST). */
  period: string;
  fraction: number;
}

export interface ValidatorDetailResponse {
  updatedAt: number;
  chainId: string;
  chainName: string;
  symbol: string;
  decimals: number | null;
  validator: ValidatorRow;
  /** The operator's own stake in its validator; null when unreadable. */
  selfDelegation: { amount: string; ratio: number | null } | null;
  /** Slash events recorded by x/distribution; null when unreadable. */
  slashes: ValidatorSlash[] | null;
  summary: ValidatorSetSummary;
  errors?: PartError[];
}

/* -------------------------------------------------------------------------- *
 * Staking positions (GET /api/staking, private)
 * -------------------------------------------------------------------------- */

/** What a staking row needs to know about its validator. */
export interface ValidatorLite {
  operatorAddress: string;
  moniker: string;
  logoUrl?: string;
  /** Null when the validator could not be read. */
  status: ValidatorStatus | null;
  jailed: boolean | null;
  tombstoned: boolean | null;
  commissionRate: number | null;
  /** The commission's hard cap (`max_rate`). */
  commissionMaxRate: number | null;
  /** Highest commission the validator can legally set within 30 days (risk badge "can rise to X %"). */
  commissionReachable30d: number | null;
  uptime: number | null;
  rank: number | null;
  votingPower: number | null;
  inNakamotoSet: boolean | null;
  /** Chain actual APR × (1 − commission); 0 when inactive. */
  apr: number | null;
}

export interface StakingDelegation {
  validator: ValidatorLite;
  /** Staked amount, base units of the staking denom. */
  amount: string;
  /** Pending rewards, truncated to whole base units (what a claim pays). */
  rewards: Coin[];
}

export interface UnbondingEntry {
  balance: string;
  initialBalance: string;
  completionTime: string;
  creationHeight: number;
}

export interface UnbondingPosition {
  validator: ValidatorLite;
  entries: UnbondingEntry[];
}

export interface RedelegationEntry {
  balance: string;
  initialBalance: string;
  /** Until then this stake cannot be redelegated again (the "redelegation lock"). */
  completionTime: string;
  creationHeight: number;
}

export interface RedelegationPosition {
  src: ValidatorLite;
  dst: ValidatorLite;
  entries: RedelegationEntry[];
}

export interface StakingChain {
  chainId: string;
  address: string;
  /** Staking denom and how to display it. */
  denom: string;
  symbol: string;
  decimals: number | null;
  delegations: StakingDelegation[];
  unbonding: UnbondingPosition[];
  redelegations: RedelegationPosition[];
  /** Where rewards are paid; null when unreadable. */
  withdrawAddress: string | null;
  /**
   * Base-unit sums. Each is null when its own read failed (see `errors`), so
   * "nothing staked" ("0") and "could not read" (null) never look alike.
   */
  totals: {
    staked: string | null;
    /** Pending rewards in the staking denom only. */
    rewards: string | null;
    unbonding: string | null;
  };
  /** Pending rewards in other denoms (fee tokens some chains distribute). */
  rewardsOther: Coin[];
  /** Earliest unbonding completion, for "next release" figures. */
  nextUnbonding: { completionTime: string; balance: string } | null;
  apr: {
    /** Chain actual APR before commission. */
    chain: number | null;
    /** Stake-weighted APR after each validator's commission (inactive count 0). */
    weighted: number | null;
  };
  status: "ok" | "partial" | "error";
  error?: string;
  errors?: PartError[];
}

export interface StakingResponse {
  updatedAt: number;
  chains: StakingChain[];
  errors?: PartError[];
}

/* -------------------------------------------------------------------------- *
 * Governance (GET /api/governance, GET /api/governance/[chainId]/[id])
 * -------------------------------------------------------------------------- */

export type ProposalStatus = "deposit" | "voting" | "passed" | "rejected" | "failed" | "unknown";

/** List filter: "rejected" also returns failed proposals. */
export type ProposalStatusFilter = "voting" | "deposit" | "passed" | "rejected" | "all";

export type VoteOptionName = "yes" | "no" | "abstain" | "veto";

export interface VoteChoice {
  option: VoteOptionName | "weighted";
  /** Present for split votes. */
  weights?: Array<{ option: VoteOptionName; weight: number }>;
}

export interface Tally {
  /** Voting power in base units of the staking denom. */
  yes: string;
  no: string;
  abstain: string;
  veto: string;
}

export interface InheritedVote {
  /** Operator address of one of your validators. */
  validator: string;
  moniker: string | null;
  /** The validator's vote; null when it has not voted (yet). */
  option: VoteOptionName | "weighted" | null;
  /** Share of your voting power on this chain delegated to it, 0..1. */
  weight: number;
}

export interface ProposalRow {
  chainId: string;
  id: string;
  /**
   * The gov API the chain answered with. A vote form uses the matching
   * message: `/cosmos.gov.v1.MsgVote` on "v1" chains (also the only one that
   * carries weighted votes with metadata), `/cosmos.gov.v1beta1.MsgVote`
   * on chains that never migrated.
   */
  api: "v1" | "v1beta1";
  title: string;
  /** Plain-text excerpt (markdown stripped, ≤ 400 chars). */
  summary: string;
  /** Short type of the first message, e.g. "MsgSoftwareUpgrade"; "Text" when none. */
  type: string;
  messageTypes: string[];
  status: ProposalStatus;
  submitTime: string | null;
  depositEndTime: string | null;
  votingStartTime: string | null;
  votingEndTime: string | null;
  totalDeposit: Coin[];
  minDeposit: Coin[] | null;
  expedited: boolean;
  /** Live tally while voting, final tally after; null in the deposit period (nobody has voted). */
  tally: Tally | null;
  tallyKind: "live" | "final" | null;
  /** Tally total ÷ bonded tokens. */
  turnout: number | null;
  /** Ended proposals: turnout uses today's bonded tokens, so it is approximate. */
  turnoutEstimate?: true;
  quorum: number | null;
  /** Threshold that applies (the expedited one for expedited proposals). */
  threshold: number | null;
  vetoThreshold: number | null;
  /** Voting proposals only: the SDK tally rules applied to the live tally. */
  passingIfEndedNow: boolean | null;
  failedReason?: string;
  /** The requested voter's own vote (voting proposals only). */
  myVote: VoteChoice | null;
  /**
   * `voted` / `not-voted` while voting; `unknown` when the read failed or the
   * proposal ended (votes are pruned after the tally); null without a voter.
   */
  myVoteStatus: "voted" | "not-voted" | "unknown" | null;
  /**
   * Voter's gov voting power (base units): stake delegated to validators in
   * the bonded set, which is all x/gov counts. "0" = no voting power on this
   * chain; null when it could not be read.
   */
  myVotingPower: string | null;
  /**
   * Without a vote of your own, how your bonded validators voted for your
   * stake (up to 10, largest first; weights are shares of your whole voting
   * power, so they may sum to less than 1).
   */
  inheritedVote?: InheritedVote[];
}

export interface ProposalsResponse {
  updatedAt: number;
  proposals: ProposalRow[];
  /** Per-chain read status, so "0 proposals" and "unreadable" differ. */
  chains: Array<{ chainId: string; status: "ok" | "error"; api: "v1" | "v1beta1" | null }>;
  unknown?: string[];
  errors?: PartError[];
}

export interface ValidatorVote {
  operatorAddress: string;
  moniker: string;
  logoUrl?: string;
  rank: number;
  votingPower: number;
  /** Null when the validator has not voted. */
  option: VoteOptionName | "weighted" | null;
}

export interface ProposalDetail extends ProposalRow {
  /** Full description (raw markdown; the UI must sanitise it). */
  description: string;
  /** Raw metadata (often a URL or JSON), capped at 20 KB. */
  metadata: string | null;
  proposer: string | null;
  /** Messages as JSON, with huge strings (wasm byte code…) elided. */
  messages: unknown[];
  messagesTruncated: boolean;
  deposit: { total: Coin[]; min: Coin[] | null; progress: number | null };
  /** Votes of the 30 largest validators while voting is open; null otherwise. */
  validatorVotes: ValidatorVote[] | null;
}

export interface ProposalDetailResponse {
  updatedAt: number;
  proposal: ProposalDetail;
  errors?: PartError[];
}

/* -------------------------------------------------------------------------- *
 * Security review (GET /api/security, private)
 * -------------------------------------------------------------------------- */

export interface AuthzGrantRow {
  chainId: string;
  granter: string;
  grantee: string;
  /** Short authorization type, e.g. "GenericAuthorization", "StakeAuthorization". */
  authorization: string;
  authorizationTypeUrl: string;
  /** GenericAuthorization: the message type it allows. */
  msgTypeUrl?: string;
  /** StakeAuthorization: delegate / undelegate / redelegate. */
  stakeAction?: string;
  /** Validators a StakeAuthorization is limited to (allow list). */
  validators?: string[];
  /** Spend cap for send / stake authorizations, when set. */
  spendLimit?: Coin[];
  /** ISO, or null for a grant that never expires. */
  expiration: string | null;
}

export interface FeeGrantRow {
  chainId: string;
  granter: string;
  grantee: string;
  /** Short allowance type, e.g. "BasicAllowance". */
  allowance: string;
  allowanceTypeUrl: string;
  spendLimit?: Coin[];
  /** Messages an AllowedMsgAllowance is limited to. */
  allowedMessages?: string[];
  expiration: string | null;
}

export interface SecurityReviewResponse {
  updatedAt: number;
  /** Grants your accounts gave: who can act for you. */
  authzGrants: AuthzGrantRow[];
  /** Fee allowances your accounts issued. */
  feeGrants: FeeGrantRow[];
  /** Chains where staking rewards are paid to another address. */
  withdrawAddressDiffers: Array<{ chainId: string; address: string; withdrawAddress: string }>;
  /** What was checked, so "nothing found" and "could not check" differ. */
  checked: Array<{ chainId: string; address: string; status: "ok" | "partial" | "error" }>;
  errors?: PartError[];
}
