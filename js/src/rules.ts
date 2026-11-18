// Business rules of BCV Today, shared by every consumer:
//
//   * the npm client (src/client.ts) and CLI,
//   * the remote MCP + A2A Cloudflare Worker (mcp/ imports this file).
//
// Pure functions only: no I/O, no globals besides Date. They mirror the Python
// library (python/bcv/_core.py): same date validation, carry-forward semantics,
// history windowing, cross rates through the bolivar and the same messages.

/** Foreign currencies published by BCV, in display order. */
export const CURRENCIES = ["USD", "EUR", "CNY", "TRY", "RUB"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Currencies accepted by conversions: the bolivar plus the published ones. */
export const ANY_CURRENCIES = ["VES", ...CURRENCIES] as const;
export type AnyCurrency = (typeof ANY_CURRENCIES)[number];

/** Attribution string attached to every result. */
export const SOURCE = "Banco Central de Venezuela (BCV), via https://bcv.today";
/** Unit of every rate value. */
export const UNIT = "VES (bolivars) per 1 unit of the currency";
/** First calendar day with a /api/v1/history/{date}.json snapshot. */
export const EARLIEST_SNAPSHOT = "2021-08-02";
/** history.json keeps (at most) this many daily entries. */
export const MAX_HISTORY_DAYS = 1830;
/** Largest amount accepted by conversions. */
export const MAX_AMOUNT = 1e15;
/** Hours without a capture after which the data is considered stale (weekend + holiday). */
export const STALE_AFTER_HOURS = 96;

export const LATEST_PATH = "/api/v1/rate.json";
export const HISTORY_PATH = "/api/v1/history.json";
export const STATUS_PATH = "/api/v1/status.json";
export const dayPath = (date: string): string => `/api/v1/history/${date}.json`;

/** One daily entry as published by the API (rate.json, history.json items, day snapshots). */
export interface RateEntry {
  date: string;
  effective_date?: string;
  updated_at?: string;
  source?: string;
  USD?: number;
  EUR?: number;
  CNY?: number;
  TRY?: number;
  RUB?: number;
}

/** /api/v1/status.json as published. */
export interface StatusDoc {
  status?: string;
  updated_at?: string;
  generated_at?: string;
  date?: string;
  effective_date?: string;
  timezone?: string;
  source?: string;
  supported_currencies?: string[];
  api_version?: string;
  currencies?: Record<string, boolean>;
}

/** Read access to the static JSON API; implemented by `Api` (src/api.ts) and the Worker. */
export interface DataSource {
  latest(): Promise<RateEntry>;
  /** Snapshot for one calendar day; rejects with `NotFound` when there is none. */
  day(date: string): Promise<RateEntry>;
  history(): Promise<RateEntry[]>;
  status(): Promise<StatusDoc>;
}

/** Validation outcome: `kind` maps to an error class, `message` is user-facing. */
export interface Problem {
  kind: "invalid_date" | "out_of_range" | "not_available" | "invalid_currency";
  message: string;
}

// ---------------------------------------------------------------- rates

/** Numeric rate for `currency` in an entry, or undefined when absent. */
export function rateOf(entry: RateEntry, currency: Currency): number | undefined {
  const v = entry[currency];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Published rates of an entry, in canonical currency order. */
export function ratesOf(entry: RateEntry): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  for (const c of CURRENCIES) {
    const v = rateOf(entry, c);
    if (v !== undefined) out[c] = v;
  }
  return out;
}

export function isCurrency(code: unknown): code is Currency {
  return typeof code === "string" && (CURRENCIES as readonly string[]).includes(code);
}

export function isAnyCurrency(code: unknown): code is AnyCurrency {
  return code === "VES" || isCurrency(code);
}

// ---------------------------------------------------------------- dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** True when `s` is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in Caracas (UTC-4, no DST). */
export function todayCaracas(now = Date.now()): string {
  return new Date(now - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** English weekday name of an ISO date ("Saturday"). */
export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

/** Parses an ISO 8601 timestamp; undefined when missing or invalid. */
export function parseTimestamp(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

// ---------------------------------------------------------------- messages

/** Hints that name the API of the caller in user-facing messages. */
export interface Hints {
  /** How to get the latest rate, e.g. "get_latest_rates" or "latest()". */
  latest: string;
  /** How to get one older day, e.g. "get_rate_by_date" or "on()". */
  onDay: string;
}

export const TOOL_HINTS: Hints = { latest: "get_latest_rates", onDay: "get_rate_by_date" };
export const LIBRARY_HINTS: Hints = { latest: "latest()", onDay: "on()" };

export function invalidDateMessage(label: string, value: string, example = true): string {
  return `Invalid ${label} "${value}": use a real calendar date in YYYY-MM-DD format${example ? ", e.g. 2026-01-02" : ""}.`;
}

export function rangeOrderMessage(fromLabel: string, from: string, toLabel: string, to: string): string {
  return `"${fromLabel}" (${from}) must be on or before "${toLabel}" (${to}).`;
}

export function sameCurrencyMessage(code: string): string {
  return `"from" and "to" are both ${code}; choose two different currencies.`;
}

export function notPublishedMessage(date: string, latest: string | undefined, hints: Hints): string {
  return (
    `No BCV rate published yet for ${date}. Daily snapshots are available from ${EARLIEST_SNAPSHOT}` +
    (latest ? ` to ${latest}.` : " to the latest business day.") +
    ` Use ${hints.latest} for the rate currently in effect.`
  );
}

/** Explains a weekend/holiday carry-forward, or undefined when the rate is that day's own. */
export function carryForwardNote(date: string, effective?: string): string | undefined {
  if (!effective || effective === date) return undefined;
  return (
    `${date} (${weekday(date)}) uses the rate with effective date ${effective} (${weekday(effective)}): ` +
    "a published BCV rate stays in effect until the next publication (weekends and holidays carry it forward)."
  );
}

// ---------------------------------------------------------------- validation

/**
 * Checks a requested calendar day: real YYYY-MM-DD date, on or after the first
 * snapshot and at most tomorrow in Caracas (BCV publishes the next business
 * day's rate in the afternoon).
 */
export function checkDay(date: string, today = todayCaracas(), label = "date"): Problem | undefined {
  if (!isIsoDate(date)) return { kind: "invalid_date", message: invalidDateMessage(label, date) };
  if (date < EARLIEST_SNAPSHOT) {
    return { kind: "out_of_range", message: `No BCV data for ${date}: daily snapshots start on ${EARLIEST_SNAPSHOT}.` };
  }
  if (date > addDays(today, 1)) {
    return {
      kind: "out_of_range",
      message: `${date} is in the future (today in Caracas is ${today}); BCV rates are only known up to the next business day.`,
    };
  }
  return undefined;
}

/** Restricts a day's rates to one currency, or explains why it is missing. */
export function pickRates(
  entry: RateEntry,
  date: string,
  currency?: Currency,
): { rates: Partial<Record<Currency, number>> } | Problem {
  const all = ratesOf(entry);
  if (!currency) return { rates: all };
  const v = all[currency];
  if (v === undefined) {
    const avail = Object.keys(all).join(", ") || "none";
    return {
      kind: "not_available",
      message: `No ${currency} rate in the BCV data for ${date} (older entries may lack some currencies). Available that day: ${avail}.`,
    };
  }
  return { rates: { [currency]: v } };
}

/** Effective (official validity) date of an entry. */
export function effectiveDateOf(entry: RateEntry, fallback?: string): string {
  return entry.effective_date ?? entry.date ?? fallback ?? "";
}

// ---------------------------------------------------------------- conversion

/**
 * Bolivars per unit of each side of a conversion (VES counts as 1). Cross rates
 * go through the bolivar: result = amount * vesPerFrom / vesPerTo.
 */
export function conversionRates(
  entry: RateEntry,
  from: AnyCurrency,
  to: AnyCurrency,
  day: string,
): { vesPerFrom: number; vesPerTo: number; ratesUsed: Partial<Record<Currency, number>> } | Problem {
  const vesPer = (c: AnyCurrency): number | undefined => (c === "VES" ? 1 : rateOf(entry, c));
  const rf = vesPer(from);
  const rt = vesPer(to);
  if (rf === undefined || rt === undefined) {
    const missing = [from, to].filter((_, i) => (i === 0 ? rf : rt) === undefined);
    return {
      kind: "not_available",
      message: `No BCV rate for ${missing.join(" and ")} on ${day} (older entries may lack some currencies). Available: ${Object.keys(ratesOf(entry)).join(", ")}.`,
    };
  }
  const ratesUsed: Partial<Record<Currency, number>> = {};
  if (from !== "VES") ratesUsed[from] = rf;
  if (to !== "VES") ratesUsed[to] = rt;
  return { vesPerFrom: rf, vesPerTo: rt, ratesUsed };
}

// ---------------------------------------------------------------- history

export interface SeriesPoint {
  date: string;
  effective_date: string;
  rate: number;
}

export interface HistoryWindow {
  series: SeriesPoint[];
  first: SeriesPoint;
  last: SeriesPoint;
  /** Lowest rate (earliest day on ties). */
  min: SeriesPoint;
  /** Highest rate (earliest day on ties). */
  max: SeriesPoint;
  /** Explanations when the requested range was clipped to the available data. */
  notes: string[];
}

export interface HistoryRequest {
  days?: number;
  from?: string;
  to?: string;
  /** Names of the range arguments in messages ("from"/"to" or "start"/"end"). */
  labels?: [string, string];
}

/**
 * Selects the window of a history series: either the last `days` calendar days
 * (default 30) ending on the latest published date, or an inclusive from/to
 * range clipped to what history.json covers.
 */
export function historyWindow(
  entries: RateEntry[],
  currency: Currency,
  req: HistoryRequest,
  hints: Hints = TOOL_HINTS,
): HistoryWindow | Problem {
  const { days, from, to } = req;
  const series = entries
    .filter((e) => typeof e.date === "string" && rateOf(e, currency) !== undefined)
    .map((e) => ({ date: e.date, effective_date: e.effective_date ?? e.date, rate: rateOf(e, currency) as number }));
  // history.json is published oldest first; a stable sort keeps that order.
  series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (series.length === 0) return { kind: "not_available", message: `No ${currency} data in the BCV history.` };
  const earliest = (series[0] as SeriesPoint).date;
  const latest = (series[series.length - 1] as SeriesPoint).date;

  let start: string;
  let end: string;
  if (from || to) {
    start = from ?? earliest;
    end = to ?? latest;
  } else {
    end = latest;
    start = addDays(latest, -((days ?? 30) - 1));
  }
  const window = series.filter((p) => p.date >= start && p.date <= end);
  if (window.length === 0) {
    return {
      kind: "out_of_range",
      message:
        `No ${currency} rates between ${start} and ${end}. The history covers ${earliest} to ${latest} for ${currency}` +
        ` (latest ${MAX_HISTORY_DAYS} daily entries). For older single days use ${hints.onDay}.`,
    };
  }
  const first = window[0] as SeriesPoint;
  const last = window[window.length - 1] as SeriesPoint;
  let min = first;
  let max = first;
  for (const p of window) {
    if (p.rate < min.rate) min = p;
    if (p.rate > max.rate) max = p;
  }
  const notes: string[] = [];
  if (start < earliest) notes.push(`History for ${currency} starts on ${earliest}; earlier dates were skipped.`);
  if (end > latest) notes.push(`Latest available date is ${latest}.`);
  return { series: window, first, last, min, max, notes };
}

// ---------------------------------------------------------------- status

export function round(n: number, digits = 8): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Age (hours, one decimal) of the last capture and whether the data is stale. */
export function freshness(doc: StatusDoc, now = Date.now()): { ageHours: number | undefined; stale: boolean } {
  const updated = doc.updated_at ? Date.parse(doc.updated_at) : Number.NaN;
  const ageHours = Number.isFinite(updated) ? round((now - updated) / 3_600_000, 1) : undefined;
  // BCV skips weekends and holidays; > 4 days without a capture is unusual.
  const stale = ageHours === undefined || ageHours > STALE_AFTER_HOURS || doc.status !== "ok";
  return { ageHours, stale };
}

export function isProblem(v: unknown): v is Problem {
  return typeof v === "object" && v !== null && "kind" in v && "message" in v && !("series" in v);
}
