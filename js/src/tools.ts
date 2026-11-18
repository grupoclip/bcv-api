// Protocol-agnostic implementation of the five BCV Today tools.
//
// The remote MCP server and the A2A agent (mcp/src, Cloudflare Worker) and the
// local stdio MCP server (`bcv-today mcp`, src/mcp/stdio.ts) all call these
// functions, so every protocol returns the same numbers, notes and validation
// messages. Each function returns a ToolOutcome: an English one-line summary
// plus the structured (snake_case, JSON-ready) result, or a user-facing error.
//
// Numbers here are JS floats rounded for display, as the MCP output schema
// promises plain numbers. The npm client (src/client.ts) uses exact decimals.
import { NotFound, UpstreamError } from "./errors.js";
import {
  type AnyCurrency,
  CURRENCIES,
  type Currency,
  carryForwardNote,
  checkDay,
  conversionRates,
  type DataSource,
  freshness,
  historyWindow,
  invalidDateMessage,
  isIsoDate,
  isProblem,
  MAX_HISTORY_DAYS,
  notPublishedMessage,
  pickRates,
  type RateEntry,
  rangeOrderMessage,
  round,
  SOURCE,
  sameCurrencyMessage,
  TOOL_HINTS,
  UNIT,
} from "./rules.js";

export { MAX_HISTORY_DAYS, round, SOURCE, UNIT };

export type ToolOutcome =
  | { ok: true; summary: string; data: Record<string, unknown> }
  | { ok: false; message: string /** true when the data API failed, not the request */; upstream?: boolean };

export interface RateByDateArgs {
  date: string;
  currency?: Currency | undefined;
}
export interface HistoryArgs {
  currency: Currency;
  days?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}
export interface ConvertArgs {
  amount: number;
  from: AnyCurrency;
  to: AnyCurrency;
  date?: string | undefined;
}

// ---------------------------------------------------------------- helpers

function ok(summary: string, data: Record<string, unknown>): ToolOutcome {
  return { ok: true, summary, data };
}

function fail(message: string): ToolOutcome {
  return { ok: false, message };
}

function upstreamFailure(err: unknown): ToolOutcome {
  if (err instanceof UpstreamError || err instanceof NotFound)
    return { ok: false, message: err.message, upstream: true };
  return { ok: false, message: `Unexpected error: ${(err as Error)?.message ?? String(err)}`, upstream: true };
}

/** Display number: thousands separators, 2 to `digits` decimals (en-US). */
export function fmt(n: number, digits = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 });
}

async function loadDay(data: DataSource, date: string): Promise<RateEntry | ToolOutcome> {
  const bad = checkDay(date);
  if (bad) return fail(bad.message);
  try {
    return await data.day(date);
  } catch (err) {
    if (err instanceof NotFound) {
      let latest = "";
      try {
        latest = (await data.latest()).date;
      } catch {
        /* ignore */
      }
      return fail(notPublishedMessage(date, latest || undefined, TOOL_HINTS));
    }
    throw err;
  }
}

function isOutcome(v: RateEntry | ToolOutcome): v is ToolOutcome {
  return "ok" in v && typeof (v as ToolOutcome).ok === "boolean";
}

// ---------------------------------------------------------------- tools

export async function latestRates(data: DataSource): Promise<ToolOutcome> {
  try {
    const e = await data.latest();
    const { rates } = pickRates(e, e.date) as { rates: Partial<Record<Currency, number>> };
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

export async function rateByDate(data: DataSource, { date, currency }: RateByDateArgs): Promise<ToolOutcome> {
  try {
    const e = await loadDay(data, date);
    if (isOutcome(e)) return e;
    const picked = pickRates(e, date, currency);
    if (isProblem(picked)) return fail(picked.message);
    const { rates } = picked;
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

export async function history(data: DataSource, { currency, days, from, to }: HistoryArgs): Promise<ToolOutcome> {
  for (const [label, v] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (v !== undefined && !isIsoDate(v)) return fail(invalidDateMessage(label, v, false));
  }
  if (from && to && from > to) return fail(rangeOrderMessage("from", from, "to", to));
  try {
    const all = await data.history();
    const w = historyWindow(all, currency, { days, from, to }, TOOL_HINTS);
    if (isProblem(w)) return fail(w.message);
    const { series, first, last, min, max, notes } = w;
    const change = last.rate - first.rate;
    const changePct = (change / first.rate) * 100;
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

export async function convert(data: DataSource, { amount, from, to, date }: ConvertArgs): Promise<ToolOutcome> {
  if (from === to) return fail(sameCurrencyMessage(from));
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
    const picked = conversionRates(e, from, to, day);
    if (isProblem(picked)) return fail(picked.message);
    const { vesPerFrom: rf, vesPerTo: rt, ratesUsed } = picked;
    const rate = rf / rt;
    const result = amount * rate;
    const effective = e.effective_date ?? e.date;
    const note = date ? carryForwardNote(date, effective) : undefined;
    const out = {
      amount,
      from,
      to,
      result: round(result, 8),
      rate: round(rate, 10),
      rates_used: ratesUsed,
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

export async function status(data: DataSource): Promise<ToolOutcome> {
  try {
    const s = await data.status();
    const { ageHours, stale } = freshness(s);
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
