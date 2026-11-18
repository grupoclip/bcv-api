// The `BCV` client: typed, promise-based access to the BCV Today API with
// exact decimal conversions. Mirrors the Python library's public API
// (python/bcv/client.py) in JavaScript style.
import { Api, DEFAULT_BASE_URL, type FetchLike, TTLCache } from "./api.js";
import {
  cmp,
  type Dec,
  div,
  fromNumber,
  group,
  mul,
  parseDecimal,
  quantize,
  roundSignificant,
  sub,
  toFixed,
  toNumber,
  toPlain,
} from "./decimal.js";
import {
  BCVError,
  CurrencyNotAvailable,
  DateOutOfRange,
  InvalidAmount,
  InvalidArgument,
  InvalidCurrency,
  InvalidDate,
  NotFound,
  UpstreamError,
} from "./errors.js";
import {
  ANY_CURRENCIES,
  type AnyCurrency,
  CURRENCIES,
  type Currency,
  carryForwardNote,
  checkDay,
  conversionRates,
  freshness,
  historyWindow,
  invalidDateMessage,
  isIsoDate,
  isProblem,
  LIBRARY_HINTS,
  MAX_AMOUNT,
  MAX_HISTORY_DAYS,
  notPublishedMessage,
  type Problem,
  parseTimestamp,
  pickRates,
  type RateEntry,
  rangeOrderMessage,
  SOURCE,
  type StatusDoc,
  sameCurrencyMessage,
  todayCaracas,
  UNIT,
} from "./rules.js";
import type { Conversion, DayRate, History, HistoryPoint, RateMap, Rates, Status } from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_USER_AGENT = `bcv-today-js/${VERSION} (+https://bcv.today)`;

/** A calendar day: "YYYY-MM-DD" or a Date (its UTC calendar day is used). */
export type DateInput = string | Date;
/** An amount: a number, a decimal string ("12.50", "1_000") or a bigint. */
export type AmountInput = number | string | bigint;

export interface BCVOptions {
  /** API origin. Default "https://bcv.today". */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 10000; 0 disables it). */
  timeoutMs?: number;
  /** How long responses stay in the in-memory cache, in ms (default 300000; 0 disables it). */
  cacheTtlMs?: number;
  /** fetch implementation (default: the global fetch). */
  fetch?: FetchLike;
  /** User-Agent header (default "bcv-today-js/<version> (+https://bcv.today)"); not sent by browsers. */
  userAgent?: string;
  /** Clock used for "today in Caracas" and data age (testing hook). */
  now?: () => Date | number;
}

export interface HistoryOptions {
  /** Last N calendar days ending on the latest published date (1 to 1830, default 30). */
  days?: number;
  /** Inclusive range start (overrides `days`). */
  start?: DateInput;
  /** Inclusive range end (overrides `days`). */
  end?: DateInput;
}

export interface ConvertOptions {
  /** Use the rate in effect that day instead of the latest one. */
  date?: DateInput;
  /** Decimal places of `result` (0 to 12, default 2, rounded half-up); `null` keeps full precision. */
  decimals?: number | null;
}

const HUNDRED: Dec = { coef: BigInt(100), exp: 0 };
const MAX_AMOUNT_DEC = fromNumber(MAX_AMOUNT);

function repr(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Date) return `Date(${Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()})`;
  return String(value);
}

/** Coerces a date argument to "YYYY-MM-DD" or throws InvalidDate. */
export function parseDate(value: unknown, label = "date"): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new InvalidDate(`Invalid ${label} ${repr(value)}: not a valid Date.`);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (isIsoDate(text)) return text;
    throw new InvalidDate(invalidDateMessage(label, value));
  }
  throw new InvalidDate(`Invalid ${label} ${repr(value)}: expected a Date or a YYYY-MM-DD string.`);
}

/** Upper-cases and validates a currency code ("usd" -> "USD"; "VEF" -> "VES" when allowed). */
export function normalizeCurrency(code: unknown, allowVes: true): AnyCurrency;
export function normalizeCurrency(code: unknown, allowVes?: false): Currency;
export function normalizeCurrency(code: unknown, allowVes = false): AnyCurrency {
  const valid: readonly string[] = allowVes ? ANY_CURRENCIES : CURRENCIES;
  if (typeof code === "string") {
    let upper = code.trim().toUpperCase();
    if (upper === "VEF" && allowVes) upper = "VES"; // pre-2021 name some users still type
    if (valid.includes(upper)) return upper as AnyCurrency;
  }
  throw new InvalidCurrency(`Unsupported currency ${repr(code)}: use one of ${valid.join(", ")}.`);
}

/** Validates an amount and returns it as an exact decimal. */
export function parseAmount(amount: unknown): Dec {
  let dec: Dec | undefined;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount))
      throw new InvalidAmount(`Invalid amount ${repr(amount)}: it must be a finite number.`);
    dec = fromNumber(amount);
  } else if (typeof amount === "bigint") {
    dec = { coef: amount, exp: 0 };
  } else if (typeof amount === "string") {
    const text = amount.trim().replace(/_/g, "");
    if (/^[+-]?(nan|inf|infinity)$/i.test(text)) {
      throw new InvalidAmount(`Invalid amount ${repr(amount)}: it must be a finite number.`);
    }
    dec = parseDecimal(text);
  }
  if (!dec) throw new InvalidAmount(`Invalid amount ${repr(amount)}: expected a number.`);
  if (dec.coef < BigInt(0)) throw new InvalidAmount(`Invalid amount ${repr(amount)}: it must be zero or positive.`);
  if (cmp(dec, MAX_AMOUNT_DEC) > 0) {
    throw new InvalidAmount(`Invalid amount ${repr(amount)}: it must not exceed 1e15.`);
  }
  return dec;
}

function checkDecimals(decimals: unknown): number | null {
  if (decimals === null) return null;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new InvalidAmount(`Invalid decimals ${repr(decimals)}: use a whole number from 0 to 12, or null.`);
  }
  return decimals;
}

function checkDays(days: unknown): number {
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_HISTORY_DAYS) {
    throw new InvalidDate(`Invalid days ${repr(days)}: use a whole number from 1 to ${MAX_HISTORY_DAYS}.`);
  }
  return days;
}

function raise(p: Problem): never {
  switch (p.kind) {
    case "invalid_date":
      throw new InvalidDate(p.message);
    case "invalid_currency":
      throw new InvalidCurrency(p.message);
    case "not_available":
      throw new CurrencyNotAvailable(p.message);
    default:
      throw new DateOutOfRange(p.message);
  }
}

function expectObject<T>(value: unknown, what: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UpstreamError(`Unexpected ${what} shape (expected an object).`);
  }
  return value as T;
}

/** Calendar date and effective date of an entry, validated. */
function entryDates(entry: RateEntry, fallback?: string): [string, string] {
  const valid = (v: unknown): v is string => typeof v === "string" && isIsoDate(v);
  const day = valid(entry.date) ? entry.date : fallback;
  if (!day) throw new UpstreamError("Unexpected API response: the entry has no valid 'date'.");
  return [day, valid(entry.effective_date) ? entry.effective_date : day];
}

/** Display formatting with thousands separators (never used for math). */
function num(value: number | Dec, places = 4): string {
  return group(typeof value === "number" ? fromNumber(value) : value, places);
}

function ratesLine(rates: RateMap): string {
  return Object.entries(rates)
    .map(([c, v]) => `${c} ${num(v as number)}`)
    .join(", ");
}

/**
 * Client for the free, read-only BCV Today API (https://bcv.today/api/).
 *
 * Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB, as
 * published by Banco Central de Venezuela. Unofficial project, not affiliated
 * with the bank.
 *
 * @example
 * const bcv = new BCV();
 * const { rates } = await bcv.latest();          // { USD: 916.6477, ... }
 * const c = await bcv.convert(100, "USD", "VES"); // c.resultText === "91664.77"
 */
export class BCV {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly cacheTtlMs: number;
  readonly userAgent: string;
  private readonly api: Api;
  private readonly cache: TTLCache;
  private readonly clock: () => number;

  constructor(options: BCVOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
      throw new InvalidArgument(`Invalid baseUrl ${repr(baseUrl)}: it must start with https:// or http://.`);
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    const cacheTtlMs = options.cacheTtlMs ?? 300_000;
    for (const [label, v] of [
      ["timeoutMs", timeoutMs],
      ["cacheTtlMs", cacheTtlMs],
    ] as const) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        throw new InvalidArgument(`Invalid ${label} ${repr(v)}: use a number of milliseconds >= 0.`);
      }
    }
    if (options.fetch !== undefined && typeof options.fetch !== "function") {
      throw new InvalidArgument("Invalid fetch: expected a function.");
    }
    const now = options.now;
    this.clock = now ? () => +now() : Date.now;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.cache = new TTLCache(cacheTtlMs, this.clock);
    this.api = new Api({
      baseUrl: this.baseUrl,
      timeoutMs,
      cache: this.cache,
      userAgent: this.userAgent,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  /** Forgets every cached response. */
  clearCache(): void {
    this.cache.clear();
  }

  private today(): string {
    return todayCaracas(this.clock());
  }

  private async latestEntry(): Promise<RateEntry> {
    return expectObject<RateEntry>(await this.api.latest(), "/api/v1/rate.json");
  }

  private async dayEntry(date: string): Promise<RateEntry> {
    const bad = checkDay(date, this.today());
    if (bad) raise(bad);
    try {
      return expectObject<RateEntry>(await this.api.day(date), "day snapshot");
    } catch (err) {
      if (!(err instanceof NotFound)) throw err;
      let latest: string | undefined;
      try {
        latest = (await this.latest()).date;
      } catch (e) {
        if (!(e instanceof BCVError)) throw e;
      }
      throw new DateOutOfRange(notPublishedMessage(date, latest, LIBRARY_HINTS));
    }
  }

  /** Official rates currently in effect (`/api/v1/rate.json`). */
  async latest(): Promise<Rates> {
    const entry = await this.latestEntry();
    const [date, effectiveDate] = entryDates(entry);
    const rates = (pickRates(entry, date) as { rates: RateMap }).rates;
    return {
      rates,
      date,
      effectiveDate,
      updatedAt: parseTimestamp(entry.updated_at) ?? null,
      unit: UNIT,
      source: SOURCE,
      summary: `Official BCV rates (effective ${effectiveDate}, Bs. per unit): ${ratesLine(rates)}`,
      raw: entry,
    };
  }

  /**
   * Rate(s) in effect on a calendar day.
   *
   * BCV does not publish on weekends and holidays: the last published rate stays
   * in effect, so `effectiveDate` may be earlier than `date` and `carriedForward`
   * is then true (with an explanatory `note`). Data starts on 2021-08-02; dates
   * after tomorrow (Caracas time) throw `DateOutOfRange`.
   *
   * @param date "YYYY-MM-DD" or a Date (its UTC calendar day).
   * @param currency Restrict the result to one currency (throws `CurrencyNotAvailable` if it was not published that day).
   */
  async on(date: DateInput, currency?: string): Promise<DayRate> {
    const day = parseDate(date);
    const code = currency !== undefined && currency !== null ? normalizeCurrency(currency) : undefined;
    const entry = await this.dayEntry(day);
    const [, effectiveDate] = entryDates(entry, day);
    const picked = pickRates(entry, day, code);
    if (isProblem(picked)) raise(picked);
    const { rates } = picked;
    const note = carryForwardNote(day, effectiveDate) ?? null;
    const values = Object.values(rates);
    const text = `BCV rate in effect on ${day} (Bs. per unit): ${ratesLine(rates)}.`;
    return {
      date: day,
      effectiveDate,
      carriedForward: note !== null,
      rates,
      rate: values.length === 1 ? values[0] : undefined,
      updatedAt: parseTimestamp(entry.updated_at) ?? null,
      note,
      unit: UNIT,
      source: SOURCE,
      summary: note ? `${text} ${note}` : text,
      raw: entry,
    };
  }

  /**
   * Daily series for one currency, oldest first: the last `days` calendar days
   * ending on the latest published date (default 30, max 1830), or an inclusive
   * `start`/`end` range (`days` is then ignored). Uses `/api/v1/history.json`,
   * which keeps the latest 1830 daily entries; ranges are clipped to what it
   * covers and `note` says so.
   */
  async history(currency: string, options: HistoryOptions = {}): Promise<History> {
    const code = normalizeCurrency(currency);
    const start = options.start !== undefined ? parseDate(options.start, "start") : undefined;
    const end = options.end !== undefined ? parseDate(options.end, "end") : undefined;
    const days = checkDays(options.days ?? 30);
    if (start && end && start > end) throw new InvalidDate(rangeOrderMessage("start", start, "end", end));
    const entries = (await this.api.history()).filter(
      (e): e is RateEntry => typeof e === "object" && e !== null && typeof e.date === "string" && isIsoDate(e.date),
    );
    const w = historyWindow(entries, code, { days, from: start, to: end }, LIBRARY_HINTS);
    if (isProblem(w)) raise(w);
    const point = (p: { date: string; effective_date: string; rate: number }): HistoryPoint => ({
      date: p.date,
      effectiveDate: p.effective_date,
      rate: p.rate,
      carriedForward: p.effective_date !== p.date,
    });
    const points = w.series.map(point);
    const first = points[0] as HistoryPoint;
    const last = points[points.length - 1] as HistoryPoint;
    const firstDec = fromNumber(first.rate);
    const changeDec = sub(fromNumber(last.rate), firstDec);
    const pctDec = quantize(mul(div(changeDec, firstDec), HUNDRED), 4);
    const min = point(w.min);
    const max = point(w.max);
    const note = w.notes.length ? w.notes.join(" ") : null;
    const sign = changeDec.coef >= BigInt(0) ? "+" : "";
    const text =
      `${code}/VES from ${first.date} to ${last.date} (${points.length} days): ` +
      `${num(first.rate)} -> ${num(last.rate)} (${sign}${toFixed(pctDec, 2)}%). ` +
      `Min ${num(min.rate)} on ${min.date}, max ${num(max.rate)} on ${max.date}.`;
    return {
      currency: code,
      points,
      start: first.date,
      end: last.date,
      first,
      last,
      min,
      max,
      change: toNumber(changeDec),
      changeExact: toPlain(changeDec),
      changePct: toNumber(pctDec),
      note,
      unit: UNIT,
      source: SOURCE,
      summary: note ? `${text} ${note}` : text,
    };
  }

  /**
   * Converts `amount` between VES, USD, EUR, CNY, TRY and RUB at the BCV rate.
   *
   * Cross rates go through the bolivar: `amount * vesPerFrom / vesPerTo`. The
   * math is exact decimal (no float drift; divisions keep 28 significant
   * digits, half-up), then `result` is rounded half-up to `decimals` places
   * (default 2; `null` keeps full precision). `resultExact` is the unrounded
   * value as a string. Numbers are read via their shortest decimal string
   * (0.1 is exactly "0.1"); pass a string for amounts beyond float precision.
   */
  async convert(amount: AmountInput, from: string, to: string, options: ConvertOptions = {}): Promise<Conversion> {
    const value = parseAmount(amount);
    const src = normalizeCurrency(from, true);
    const dst = normalizeCurrency(to, true);
    if (src === dst) throw new InvalidCurrency(sameCurrencyMessage(src));
    const decimals = checkDecimals(options.decimals === undefined ? 2 : options.decimals);
    const date = options.date !== undefined ? parseDate(options.date) : undefined;
    const entry = date !== undefined ? await this.dayEntry(date) : await this.latestEntry();
    const [entryDay, effectiveDate] = entryDates(entry, date);
    const day = date ?? entryDay;
    const picked = conversionRates(entry, src, dst, day);
    if (isProblem(picked)) raise(picked);
    const rf = fromNumber(picked.vesPerFrom);
    const rt = fromNumber(picked.vesPerTo);
    const rate = div(rf, rt);
    // Multiply first (like the Python library): VES -> X stays exact longer.
    const exact = div(roundSignificant(mul(value, rf)), rt);
    const result = decimals === null ? exact : quantize(exact, decimals);
    const note = date !== undefined ? (carryForwardNote(date, effectiveDate) ?? null) : null;
    const places = decimals ?? 8;
    const text =
      `${num(value, 2)} ${src} = ${num(result, places)} ${dst} at the official BCV rate ` +
      `(effective ${effectiveDate}; 1 ${src} = ${num(rate, 6)} ${dst}).`;
    return {
      amount: toNumber(value),
      amountExact: toPlain(value),
      from: src,
      to: dst,
      result: toNumber(result),
      resultText: decimals === null ? toPlain(exact) : toFixed(result, decimals),
      resultExact: toPlain(exact),
      rate: toNumber(rate),
      rateExact: toPlain(rate),
      ratesUsed: picked.ratesUsed,
      date: day,
      effectiveDate,
      carriedForward: note !== null,
      decimals,
      note,
      source: SOURCE,
      summary: note ? `${text} ${note}` : text,
    };
  }

  /** Freshness of the published data (`/api/v1/status.json`). */
  async status(): Promise<Status> {
    const doc = expectObject<StatusDoc>(await this.api.status(), "/api/v1/status.json");
    const { ageHours, stale } = freshness(doc, this.clock());
    const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
    const day = (v: unknown): string | null => (typeof v === "string" && isIsoDate(v) ? v : null);
    const status = text(doc.status) ?? "unknown";
    const age = ageHours !== undefined ? ` (${ageHours} h ago)` : "";
    return {
      status,
      updatedAt: parseTimestamp(doc.updated_at) ?? null,
      generatedAt: parseTimestamp(doc.generated_at) ?? null,
      date: day(doc.date),
      effectiveDate: day(doc.effective_date),
      ageHours: ageHours ?? null,
      stale,
      supportedCurrencies: Array.isArray(doc.supported_currencies)
        ? doc.supported_currencies.map(String)
        : [...CURRENCIES],
      currencies:
        doc.currencies && typeof doc.currencies === "object"
          ? Object.fromEntries(Object.entries(doc.currencies).map(([k, v]) => [k, Boolean(v)]))
          : {},
      timezone: text(doc.timezone),
      apiVersion: text(doc.api_version),
      summary:
        `Status ${status}${stale ? " (STALE)" : ""}: last capture ${text(doc.updated_at) ?? "unknown"}${age}, ` +
        `effective date ${day(doc.effective_date) ?? "unknown"}.`,
      raw: doc,
    };
  }
}
