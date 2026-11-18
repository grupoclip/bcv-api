// Shared, protocol-agnostic implementation of the BCV Today tools.
//
// The MCP server (server.ts) and the A2A agent (a2a/agent.ts) both call these
// functions, so the two protocols always return the same numbers, notes and
// validation messages. Each function returns a ToolOutcome: an English
// one-line summary plus the structured result, or a user-facing error.
import * as z from "zod";
import {
  CURRENCIES,
  type Currency,
  DataClient,
  EARLIEST_SNAPSHOT,
  NotFoundError,
  type RateEntry,
  UpstreamError,
  addDays,
  isIsoDate,
  rateOf,
  ratesOf,
  todayCaracas,
  weekday,
} from "./data.js";

export const SOURCE = "Banco Central de Venezuela (BCV), via https://bcv.today";
export const UNIT = "VES (bolivars) per 1 unit of the currency";
export const MAX_HISTORY_DAYS = 1830;

export type ToolOutcome =
  | { ok: true; summary: string; data: Record<string, unknown> }
  | { ok: false; message: string; /** true when the data API failed, not the request */ upstream?: boolean };

// ---------------------------------------------------------------- schemas

export const currencyEnum = z.enum(CURRENCIES);
export const anyCurrencyEnum = z.enum(["VES", ...CURRENCIES] as const);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format, e.g. 2026-01-02.");

export const rateByDateInput = {
  date: isoDate.describe("Calendar day, YYYY-MM-DD (e.g. 2026-01-02)."),
  currency: currencyEnum.optional().describe("Only return this currency. Omit for all available."),
};

export const historyInput = {
  currency: currencyEnum.describe("Currency to chart against the bolivar."),
  days: z
    .number()
    .int()
    .min(1)
    .max(MAX_HISTORY_DAYS)
    .optional()
    .describe("Last N calendar days ending on the latest published date (default 30). Ignored when from/to is given."),
  from: isoDate.optional().describe("Range start, YYYY-MM-DD (inclusive)."),
  to: isoDate.optional().describe("Range end, YYYY-MM-DD (inclusive). Defaults to the latest date."),
};

export const convertInput = {
  amount: z.number().finite().nonnegative().max(1e15).describe("Amount to convert, e.g. 100."),
  from: anyCurrencyEnum.describe("Source currency code."),
  to: anyCurrencyEnum.describe("Target currency code."),
  date: isoDate.optional().describe("Use the rate in effect on this day (YYYY-MM-DD). Omit for the latest rate."),
};

const rateByDateArgs = z.object(rateByDateInput);
const historyArgs = z.object(historyInput);
const convertArgs = z.object(convertInput);
export type RateByDateArgs = z.infer<typeof rateByDateArgs>;
export type HistoryArgs = z.infer<typeof historyArgs>;
export type ConvertArgs = z.infer<typeof convertArgs>;
export const argSchemas = { rateByDate: rateByDateArgs, history: historyArgs, convert: convertArgs };

// ---------------------------------------------------------------- helpers

function ok(summary: string, data: Record<string, unknown>): ToolOutcome {
  return { ok: true, summary, data };
}

function fail(message: string): ToolOutcome {
  return { ok: false, message };
}

function upstreamFailure(err: unknown): ToolOutcome {
  if (err instanceof UpstreamError || err instanceof NotFoundError) return { ok: false, message: err.message, upstream: true };
  return { ok: false, message: `Unexpected error: ${(err as Error)?.message ?? String(err)}`, upstream: true };
}

export function fmt(n: number, digits = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 });
}

export function round(n: number, digits = 8): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Validates a date argument; returns an error message or undefined. */
function checkDate(date: string, label = "date"): string | undefined {
  if (!isIsoDate(date)) {
    return `Invalid ${label} "${date}": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.`;
  }
  if (date < EARLIEST_SNAPSHOT) {
    return `No BCV data for ${date}: daily snapshots start on ${EARLIEST_SNAPSHOT}.`;
  }
  const today = todayCaracas();
  // BCV publishes the next business day's rate in the afternoon, so allow tomorrow.
  if (date > addDays(today, 1)) {
    return `${date} is in the future (today in Caracas is ${today}); BCV rates are only known up to the next business day.`;
  }
  return undefined;
}

async function loadDay(data: DataClient, date: string): Promise<RateEntry | ToolOutcome> {
  const bad = checkDate(date);
  if (bad) return fail(bad);
  try {
    return await data.day(date);
  } catch (err) {
    if (err instanceof NotFoundError) {
      let latest = "";
      try {
        latest = (await data.latest()).date;
      } catch {
        /* ignore */
      }
      return fail(
        `No BCV rate published yet for ${date}. Daily snapshots are available from ${EARLIEST_SNAPSHOT}` +
          (latest ? ` to ${latest}.` : " to the latest business day.") +
          " Use get_latest_rates for the rate currently in effect.",
      );
    }
    throw err;
  }
}

function isOutcome(v: RateEntry | ToolOutcome): v is ToolOutcome {
  return "ok" in v && typeof (v as ToolOutcome).ok === "boolean";
}

function carryForwardNote(date: string, effective?: string): string | undefined {
  if (!effective || effective === date) return undefined;
  return (
    `${date} (${weekday(date)}) uses the rate with effective date ${effective} (${weekday(effective)}): ` +
    "a published BCV rate stays in effect until the next publication (weekends and holidays carry it forward)."
  );
}

// ---------------------------------------------------------------- tools

export async function latestRates(data: DataClient): Promise<ToolOutcome> {
  try {
    const e = await data.latest();
    const rates = ratesOf(e);
    const out = {
      rates,
      effective_date: e.effective_date ?? e.date,
      date: e.date,
      updated_at: e.updated_at ?? "",
      unit: UNIT,
      source: SOURCE,
    };
    const line = Object.entries(rates)
      .map(([c, v]) => `${c} ${fmt(v)}`)
      .join(", ");
    return ok(`Official BCV rates (effective ${out.effective_date}, Bs. per unit): ${line}.`, out);
  } catch (err) {
    return upstreamFailure(err);
  }
}

export async function rateByDate(data: DataClient, { date, currency }: RateByDateArgs): Promise<ToolOutcome> {
  try {
    const e = await loadDay(data, date);
    if (isOutcome(e)) return e;
    const all = ratesOf(e);
    let rates: Partial<Record<Currency, number>> = all;
    if (currency) {
      const v = all[currency];
      if (v === undefined) {
        const avail = Object.keys(all).join(", ") || "none";
        return fail(
          `No ${currency} rate in the BCV data for ${date} (older entries may lack some currencies). Available that day: ${avail}.`,
        );
      }
      rates = { [currency]: v };
    }
    const effective = e.effective_date ?? e.date;
    const note = carryForwardNote(date, effective);
    const out = {
      date,
      effective_date: effective,
      carried_forward: Boolean(note),
      ...(note ? { note } : {}),
      rates,
      ...(e.updated_at ? { updated_at: e.updated_at } : {}),
      unit: UNIT,
      source: SOURCE,
    };
    const line = Object.entries(rates)
      .map(([c, v]) => `${c} ${fmt(v)}`)
      .join(", ");
    return ok(`BCV rate in effect on ${date} (Bs. per unit): ${line}.${note ? ` ${note}` : ""}`, out);
  } catch (err) {
    return upstreamFailure(err);
  }
}

export async function history(data: DataClient, { currency, days, from, to }: HistoryArgs): Promise<ToolOutcome> {
  for (const [label, v] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (v !== undefined && !isIsoDate(v)) {
      return fail(`Invalid ${label} "${v}": use a real calendar date in YYYY-MM-DD format.`);
    }
  }
  if (from && to && from > to) return fail(`"from" (${from}) must be on or before "to" (${to}).`);
  try {
    const all = await data.history();
    const withRate = all.filter((e) => typeof e.date === "string" && rateOf(e, currency) !== undefined);
    if (withRate.length === 0) return fail(`No ${currency} data in the BCV history.`);
    const earliest = withRate[0]!.date;
    const latest = withRate[withRate.length - 1]!.date;

    let start: string;
    let end: string;
    if (from || to) {
      start = from ?? earliest;
      end = to ?? latest;
    } else {
      const n = days ?? 30;
      end = latest;
      start = addDays(latest, -(n - 1));
    }
    const series = withRate
      .filter((e) => e.date >= start && e.date <= end)
      .map((e) => ({ date: e.date, effective_date: e.effective_date ?? e.date, rate: rateOf(e, currency)! }));
    if (series.length === 0) {
      return fail(
        `No ${currency} rates between ${start} and ${end}. The history covers ${earliest} to ${latest} for ${currency}` +
          ` (latest ${MAX_HISTORY_DAYS} daily entries). For older single days use get_rate_by_date.`,
      );
    }
    const first = series[0]!;
    const last = series[series.length - 1]!;
    let min = first;
    let max = first;
    for (const p of series) {
      if (p.rate < min.rate) min = p;
      if (p.rate > max.rate) max = p;
    }
    const change = last.rate - first.rate;
    const changePct = (change / first.rate) * 100;
    const notes: string[] = [];
    if (start < earliest) notes.push(`History for ${currency} starts on ${earliest}; earlier dates were skipped.`);
    if (end > latest) notes.push(`Latest available date is ${latest}.`);
    const out = {
      currency,
      from: first.date,
      to: last.date,
      points: series.length,
      first: { date: first.date, rate: first.rate },
      last: { date: last.date, rate: last.rate },
      min: { date: min.date, rate: min.rate },
      max: { date: max.date, rate: max.rate },
      change: round(change),
      change_pct: round(changePct, 4),
      series,
      ...(notes.length ? { note: notes.join(" ") } : {}),
      unit: UNIT,
      source: SOURCE,
    };
    const sign = change >= 0 ? "+" : "";
    return ok(
      `${currency}/VES from ${first.date} to ${last.date} (${series.length} days): ${fmt(first.rate)} → ${fmt(last.rate)} ` +
        `(${sign}${changePct.toFixed(2)}%). Min ${fmt(min.rate)} on ${min.date}, max ${fmt(max.rate)} on ${max.date}.` +
        (notes.length ? ` ${notes.join(" ")}` : ""),
      out,
    );
  } catch (err) {
    return upstreamFailure(err);
  }
}

export async function convert(data: DataClient, { amount, from, to, date }: ConvertArgs): Promise<ToolOutcome> {
  if (from === to) return fail(`"from" and "to" are both ${from}; choose two different currencies.`);
  try {
    let e: RateEntry;
    if (date) {
      const r = await loadDay(data, date);
      if (isOutcome(r)) return r;
      e = r;
    } else {
      e = await data.latest();
    }
    const day = date ?? e.date;
    const vesPer = (c: string): number | undefined => (c === "VES" ? 1 : rateOf(e, c as Currency));
    const rf = vesPer(from);
    const rt = vesPer(to);
    const missing = [from, to].filter((c, i) => (i === 0 ? rf : rt) === undefined);
    if (rf === undefined || rt === undefined) {
      return fail(
        `No BCV rate for ${missing.join(" and ")} on ${day} (older entries may lack some currencies). Available: ${Object.keys(ratesOf(e)).join(", ")}.`,
      );
    }
    const rate = rf / rt;
    const result = amount * rate;
    const rates_used: Record<string, number> = {};
    if (from !== "VES") rates_used[from] = rf;
    if (to !== "VES") rates_used[to] = rt;
    const effective = e.effective_date ?? e.date;
    const note = date ? carryForwardNote(date, effective) : undefined;
    const out = {
      amount,
      from,
      to,
      result: round(result, 8),
      rate: round(rate, 10),
      rates_used,
      date: day,
      effective_date: effective,
      ...(note ? { note } : {}),
      source: SOURCE,
    };
    return ok(
      `${fmt(amount, 2)} ${from} = ${fmt(result, 2)} ${to} at the official BCV rate (effective ${effective}; 1 ${from} = ${fmt(rate, 6)} ${to}).` +
        (note ? ` ${note}` : ""),
      out,
    );
  } catch (err) {
    return upstreamFailure(err);
  }
}

export async function status(data: DataClient): Promise<ToolOutcome> {
  try {
    const s = await data.status();
    const updated = s.updated_at ? Date.parse(s.updated_at) : NaN;
    const ageHours = Number.isFinite(updated) ? round((Date.now() - updated) / 3_600_000, 1) : undefined;
    // BCV skips weekends and holidays; > 4 days without a capture is unusual.
    const stale = ageHours === undefined || ageHours > 96 || s.status !== "ok";
    const out = {
      status: s.status ?? "unknown",
      updated_at: s.updated_at ?? "",
      ...(s.generated_at ? { generated_at: s.generated_at } : {}),
      ...(s.date ? { date: s.date } : {}),
      ...(s.effective_date ? { effective_date: s.effective_date } : {}),
      ...(ageHours !== undefined ? { age_hours: ageHours } : {}),
      stale,
      supported_currencies: s.supported_currencies ?? [...CURRENCIES],
      ...(s.currencies ? { currencies: s.currencies } : {}),
      ...(s.timezone ? { timezone: s.timezone } : {}),
      ...(s.api_version ? { api_version: s.api_version } : {}),
    };
    return ok(
      `Status ${out.status}${stale ? " (STALE)" : ""}: last capture ${out.updated_at}` +
        (ageHours !== undefined ? ` (${ageHours} h ago)` : "") +
        `, effective date ${s.effective_date ?? "unknown"}.`,
      out,
    );
  } catch (err) {
    return upstreamFailure(err);
  }
}
