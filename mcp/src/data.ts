// Read-only access to the static BCV Today JSON API (https://bcv.today/api/v1).
// Never calls bcv.org.ve. Responses are cached at the Cloudflare edge
// (cf.cacheTtl) and memoised per isolate, so repeated tool calls cost neither
// subrequests nor JSON parsing CPU.

export const CURRENCIES = ["USD", "EUR", "CNY", "TRY", "RUB"] as const;
export type Currency = (typeof CURRENCIES)[number];

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

/** First calendar day with a /api/v1/history/{date}.json snapshot. */
export const EARLIEST_SNAPSHOT = "2021-08-02";

const CACHE_TTL_SECONDS = 300;
const memo = new Map<string, { expires: number; value: unknown }>();
const MEMO_MAX = 64;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DataClient {
  constructor(private readonly origin: string) {}

  private async getText(path: string, accept: string): Promise<string> {
    const key = `${accept} ${path}`;
    const hit = memo.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as string;

    const url = new URL(path, this.origin).toString();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          accept,
          "user-agent": "bcv-today-mcp/1.0 (+https://mcp.bcv.today)",
        },
        cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      });
    } catch (err) {
      throw new UpstreamError(
        `Could not reach the BCV Today data API (${(err as Error).message}). Try again in a moment.`,
      );
    }
    if (res.status === 404) {
      throw new NotFoundError(`Not found: ${path}`);
    }
    if (!res.ok) {
      throw new UpstreamError(
        `The BCV Today data API answered HTTP ${res.status} for ${path}. Try again in a moment.`,
        res.status,
      );
    }
    const text = await res.text();
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, { expires: Date.now() + CACHE_TTL_SECONDS * 1000, value: text });
    return text;
  }

  private async getJson<T>(path: string): Promise<T> {
    const key = `json ${path}`;
    const hit = memo.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const text = await this.getText(path, "application/json");
    let value: T;
    try {
      value = JSON.parse(text) as T;
    } catch {
      throw new UpstreamError(`The BCV Today data API returned invalid JSON for ${path}.`);
    }
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, { expires: Date.now() + CACHE_TTL_SECONDS * 1000, value });
    return value;
  }

  latest(): Promise<RateEntry> {
    return this.getJson<RateEntry>("/api/v1/rate.json");
  }

  status(): Promise<StatusDoc> {
    return this.getJson<StatusDoc>("/api/v1/status.json");
  }

  async history(): Promise<RateEntry[]> {
    const data = await this.getJson<unknown>("/api/v1/history.json");
    if (!Array.isArray(data)) {
      throw new UpstreamError("Unexpected history.json shape (expected an array).");
    }
    return data as RateEntry[];
  }

  /** Snapshot for one calendar day; throws NotFoundError when out of range. */
  day(date: string): Promise<RateEntry> {
    return this.getJson<RateEntry>(`/api/v1/history/${date}.json`);
  }

  doc(path: string, accept = "text/plain"): Promise<string> {
    return this.getText(path, accept);
  }
}

/** Numeric rate for `currency` in an entry, or undefined when absent. */
export function rateOf(entry: RateEntry, currency: Currency): number | undefined {
  const v = entry[currency];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function ratesOf(entry: RateEntry): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  for (const c of CURRENCIES) {
    const v = rateOf(entry, c);
    if (v !== undefined) out[c] = v;
  }
  return out;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export function weekday(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
