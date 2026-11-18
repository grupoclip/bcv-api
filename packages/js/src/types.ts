// Result types returned by the `BCV` client. Calendar days are ISO strings
// ("2026-01-02"); timestamps are Date objects. Rates are numbers exactly as
// published (BCV quotes them with at most 8 decimals, which JS numbers
// round-trip); conversion math is done with exact decimals and also returned as
// strings.
import type { AnyCurrency, Currency, RateEntry, StatusDoc } from "./rules.js";

/** Bolivars (VES) per one unit of each published currency. */
export type RateMap = Partial<Record<Currency, number>>;

/** The official BCV rates currently in effect (`/api/v1/rate.json`). */
export interface Rates {
  /** Bolivars per unit, keyed by currency code, in USD, EUR, CNY, TRY, RUB order. */
  rates: RateMap;
  /** Calendar date of the snapshot. */
  date: string;
  /** Official BCV validity date ("fecha valor"). */
  effectiveDate: string;
  /** UTC capture time of the rate, when known. */
  updatedAt: Date | null;
  unit: string;
  source: string;
  /** One-line English description. */
  summary: string;
  /** The entry as published by the API. */
  raw: RateEntry;
}

/** The BCV rate(s) in effect on one calendar day (`/api/v1/history/{date}.json`). */
export interface DayRate {
  /** The calendar day that was requested. */
  date: string;
  /** Date of the BCV publication in effect that day (earlier on weekends/holidays). */
  effectiveDate: string;
  /** True when `effectiveDate` differs from `date` (rate carried forward). */
  carriedForward: boolean;
  /** Bolivars per unit (only the requested currency when one was given). */
  rates: RateMap;
  /** The single rate when exactly one currency is present (e.g. `on(d, "USD")`). */
  rate: number | undefined;
  updatedAt: Date | null;
  /** Human explanation of the carry-forward, when it applies. */
  note: string | null;
  unit: string;
  source: string;
  summary: string;
  raw: RateEntry;
}

/** One daily entry of a `History` series. */
export interface HistoryPoint {
  date: string;
  effectiveDate: string;
  /** Bolivars per unit of the series currency. */
  rate: number;
  carriedForward: boolean;
}

/** A daily rate series for one currency, oldest first (never empty). */
export interface History {
  currency: Currency;
  points: HistoryPoint[];
  /** First date of the series. */
  start: string;
  /** Last date of the series. */
  end: string;
  first: HistoryPoint;
  last: HistoryPoint;
  /** Lowest rate (earliest day on ties). */
  min: HistoryPoint;
  /** Highest rate (earliest day on ties). */
  max: HistoryPoint;
  /** `last.rate - first.rate`, exact (as a number). */
  change: number;
  /** `last.rate - first.rate`, exact decimal string. */
  changeExact: string;
  /** Percentage change from first to last, rounded half-up to 4 decimals. */
  changePct: number;
  /** Explanation when the requested range was clipped to the available data. */
  note: string | null;
  unit: string;
  source: string;
  summary: string;
}

/**
 * Result of `BCV.convert()`.
 *
 * `resultExact` is `amount * vesPerFrom / vesPerTo` (VES counts as 1) computed
 * with exact decimal arithmetic (division to 28 significant digits, half-up);
 * `result`/`resultText` are rounded half-up to `decimals` places.
 */
export interface Conversion {
  /** The amount, as a number. */
  amount: number;
  /** The amount, as an exact decimal string. */
  amountExact: string;
  from: AnyCurrency;
  to: AnyCurrency;
  /** Rounded result as a number (e.g. 91664.77). */
  result: number;
  /** Rounded result with exactly `decimals` places (e.g. "91664.77", "1.10"). */
  resultText: string;
  /** Unrounded result, exact decimal string (28 significant digits for divisions). */
  resultExact: string;
  /** Units of `to` per 1 unit of `from`, as a number. */
  rate: number;
  /** Units of `to` per 1 unit of `from`, exact decimal string (28 significant digits). */
  rateExact: string;
  /** Bolivars per unit for the non-VES side(s) of the conversion. */
  ratesUsed: RateMap;
  /** Requested date, or the date of the latest snapshot. */
  date: string;
  effectiveDate: string;
  carriedForward: boolean;
  /** Decimal places of `result` (`null` = not rounded). */
  decimals: number | null;
  note: string | null;
  source: string;
  summary: string;
}

/** Freshness of the published data (`/api/v1/status.json`). */
export interface Status {
  status: string;
  updatedAt: Date | null;
  generatedAt: Date | null;
  date: string | null;
  effectiveDate: string | null;
  /** Hours since `updatedAt` (one decimal), when known. */
  ageHours: number | null;
  /** True when status is not "ok" or the last capture is older than 96 hours. */
  stale: boolean;
  supportedCurrencies: string[];
  currencies: Record<string, boolean>;
  timezone: string | null;
  apiVersion: string | null;
  summary: string;
  raw: StatusDoc;
}
