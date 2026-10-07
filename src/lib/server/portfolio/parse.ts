/**
 * Reading a chain LCD's bank, staking and distribution answers. Pure, so the
 * shapes are tested; `read.ts` does the reads.
 *
 * Amounts stay base-unit integer strings end to end: an 18-decimal balance
 * does not fit a float, and a float is how a dust balance turns into "0" or a
 * whole balance into "0.99999…". Rows that do not read are skipped, never
 * guessed; a page that does not read at all is `null`, which the reader turns
 * into a reported failure.
 */

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const INTEGER = /^\d{1,78}$/;
/** Sdk.Dec strings ("1234.567000000000000000"), and plain integers. */
const DECIMAL = /^(\d{1,78})(?:\.\d{0,36})?$/;
/**
 * Bank denoms: a letter, then letters, digits, `/:._-`, at most 128 long. The
 * SDK's default minimum is 3, but chains relax it (Union's `au`, Function X's
 * `FX`), and a balance must never vanish because its denom is short.
 */
const DENOM = /^[a-zA-Z][a-zA-Z0-9/:._-]{1,127}$/;

/** An integer amount string, or null. */
export function integerAmount(value: unknown): string | null {
  const text = str(value);
  return text !== null && INTEGER.test(text) ? text.replace(/^0+(?=\d)/, "") : null;
}

/** A DecCoin amount truncated to whole base units, or null. Rewards accrue in fractions of a base unit. */
export function truncatedDecimal(value: unknown): string | null {
  const text = str(value);
  const match = text !== null ? DECIMAL.exec(text) : null;
  return match?.[1] ? match[1].replace(/^0+(?=\d)/, "") : null;
}

export function isDenom(value: unknown): value is string {
  return typeof value === "string" && DENOM.test(value);
}

export interface Coin {
  denom: string;
  amount: string;
}

export interface Page<T> {
  rows: T[];
  /** `pagination.next_key` (base64) when there is another page. */
  nextKey: string | null;
}

function nextKeyOf(root: Fields): string | null {
  const key = str(record(root.pagination)?.next_key);
  return key && key.length > 0 && key.length <= 512 ? key : null;
}

/** `/cosmos/bank/v1beta1/balances/{address}`: non-zero coins only. */
export function parseBalancesPage(body: unknown): Page<Coin> | null {
  const root = record(body);
  if (!root || !Array.isArray(root.balances)) return null;
  const rows: Coin[] = [];
  for (const raw of root.balances) {
    const row = record(raw);
    const amount = integerAmount(row?.amount);
    if (!isDenom(row?.denom) || amount === null || amount === "0") continue;
    rows.push({ denom: row.denom, amount });
  }
  return { rows, nextKey: nextKeyOf(root) };
}

export interface Delegation {
  validator: string;
  denom: string;
  amount: string;
}

/** `/cosmos/staking/v1beta1/delegations/{address}`. */
export function parseDelegationsPage(body: unknown): Page<Delegation> | null {
  const root = record(body);
  if (!root || !Array.isArray(root.delegation_responses)) return null;
  const rows: Delegation[] = [];
  for (const raw of root.delegation_responses) {
    const row = record(raw);
    const balance = record(row?.balance);
    const validator = str(record(row?.delegation)?.validator_address) ?? "";
    const amount = integerAmount(balance?.amount);
    if (!isDenom(balance?.denom) || amount === null || amount === "0") continue;
    rows.push({ validator, denom: balance.denom, amount });
  }
  return { rows, nextKey: nextKeyOf(root) };
}

/** `/cosmos/distribution/v1beta1/delegators/{address}/rewards`: the `total`, truncated per denom. */
export function parseRewards(body: unknown): Coin[] | null {
  const root = record(body);
  if (!root) return null;
  if (root.total === undefined || root.total === null) return Array.isArray(root.rewards) ? [] : null;
  if (!Array.isArray(root.total)) return null;
  const rows: Coin[] = [];
  for (const raw of root.total) {
    const row = record(raw);
    const amount = truncatedDecimal(row?.amount);
    if (!isDenom(row?.denom) || amount === null || amount === "0") continue;
    rows.push({ denom: row.denom, amount });
  }
  return rows;
}

export interface UnbondingEntry {
  validator: string;
  amount: string;
  /** Epoch ms; null when the chain's timestamp does not parse. */
  completesAt: number | null;
}

/** `/cosmos/staking/v1beta1/delegators/{address}/unbonding_delegations`: every entry, in the bond denom. */
export function parseUnbondingPage(body: unknown): Page<UnbondingEntry> | null {
  const root = record(body);
  if (!root || !Array.isArray(root.unbonding_responses)) return null;
  const rows: UnbondingEntry[] = [];
  for (const raw of root.unbonding_responses) {
    const row = record(raw);
    const validator = str(row?.validator_address) ?? "";
    if (!Array.isArray(row?.entries)) continue;
    for (const rawEntry of row.entries) {
      const entry = record(rawEntry);
      const amount = integerAmount(entry?.balance);
      if (amount === null || amount === "0") continue;
      const time = Date.parse(str(entry?.completion_time) ?? "");
      rows.push({ validator, amount, completesAt: Number.isFinite(time) ? time : null });
    }
  }
  return { rows, nextKey: nextKeyOf(root) };
}
