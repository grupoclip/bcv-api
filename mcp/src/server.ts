import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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

export const SERVER_NAME = "bcv-today";
export const SERVER_VERSION = "1.0.0";

const SOURCE = "Banco Central de Venezuela (BCV), via https://bcv.today";
const UNIT = "VES (bolivars) per 1 unit of the currency";
const MAX_HISTORY_DAYS = 1830;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const INSTRUCTIONS = [
  "BCV Today: official exchange rates published by Banco Central de Venezuela (BCV).",
  "Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB.",
  "effective_date is the official BCV validity date ('fecha valor'); updated_at is the UTC capture time.",
  "BCV does not publish on weekends and holidays: the last published rate stays in effect, so effective_date may be earlier than the requested date.",
  "Data is free, public and read-only. Unofficial project, not affiliated with the bank. Docs: https://bcv.today/llms.txt",
].join(" ");

// ---------------------------------------------------------------- helpers

const currencyEnum = z.enum(CURRENCIES);
const anyCurrencyEnum = z.enum(["VES", ...CURRENCIES] as const);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format, e.g. 2026-01-02.");

function ok(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function upstreamFailure(err: unknown): CallToolResult {
  if (err instanceof UpstreamError || err instanceof NotFoundError) return fail(err.message);
  return fail(`Unexpected error: ${(err as Error)?.message ?? String(err)}`);
}

function fmt(n: number, digits = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 });
}

function round(n: number, digits = 8): number {
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

async function loadDay(data: DataClient, date: string): Promise<RateEntry | CallToolResult> {
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

function carryForwardNote(date: string, effective?: string): string | undefined {
  if (!effective || effective === date) return undefined;
  return (
    `${date} (${weekday(date)}) uses the rate with effective date ${effective} (${weekday(effective)}): ` +
    "a published BCV rate stays in effect until the next publication (weekends and holidays carry it forward)."
  );
}

// ---------------------------------------------------------------- server

export function buildServer(data: DataClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: "BCV Today", version: SERVER_VERSION, websiteUrl: "https://bcv.today" },
    { instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
  );

  // get_latest_rates ------------------------------------------------------
  server.registerTool(
    "get_latest_rates",
    {
      title: "Latest official BCV rates",
      description:
        "Official BCV exchange rates currently in effect for USD, EUR, CNY, TRY and RUB, in bolivars (VES) per unit, with effective date and capture time.",
      inputSchema: {},
      outputSchema: {
        rates: z.record(z.string(), z.number()).describe(UNIT),
        effective_date: z.string(),
        date: z.string(),
        updated_at: z.string(),
        unit: z.string(),
        source: z.string(),
      },
      annotations: { title: "Latest official BCV rates", ...READ_ONLY },
    },
    async () => {
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
    },
  );

  // get_rate_by_date ------------------------------------------------------
  server.registerTool(
    "get_rate_by_date",
    {
      title: "BCV rate on a date",
      description:
        "Official BCV rate(s) in effect on a calendar day (YYYY-MM-DD, from 2021-08-02). Weekends and holidays carry forward the last published rate; the response explains it. Optionally restrict to one currency.",
      inputSchema: {
        date: isoDate.describe("Calendar day, YYYY-MM-DD (e.g. 2026-01-02)."),
        currency: currencyEnum.optional().describe("Only return this currency. Omit for all available."),
      },
      outputSchema: {
        date: z.string(),
        effective_date: z.string(),
        carried_forward: z.boolean(),
        note: z.string().optional(),
        rates: z.record(z.string(), z.number()).describe(UNIT),
        updated_at: z.string().optional(),
        unit: z.string(),
        source: z.string(),
      },
      annotations: { title: "BCV rate on a date", ...READ_ONLY },
    },
    async ({ date, currency }) => {
      try {
        const e = await loadDay(data, date);
        if ("content" in e) return e;
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
    },
  );

  // get_history -----------------------------------------------------------
  server.registerTool(
    "get_history",
    {
      title: "BCV rate history",
      description:
        "Daily official BCV rate series for one currency, either the last N calendar days (days, default 30, max 1830) or a from/to date range, with min, max and percentage change.",
      inputSchema: {
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
      },
      outputSchema: {
        currency: z.string(),
        from: z.string(),
        to: z.string(),
        points: z.number(),
        first: z.object({ date: z.string(), rate: z.number() }),
        last: z.object({ date: z.string(), rate: z.number() }),
        min: z.object({ date: z.string(), rate: z.number() }),
        max: z.object({ date: z.string(), rate: z.number() }),
        change: z.number(),
        change_pct: z.number(),
        series: z.array(z.object({ date: z.string(), effective_date: z.string(), rate: z.number() })),
        note: z.string().optional(),
        unit: z.string(),
        source: z.string(),
      },
      annotations: { title: "BCV rate history", ...READ_ONLY },
    },
    async ({ currency, days, from, to }) => {
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
        const history = await data.history();
        const withRate = history.filter((e) => typeof e.date === "string" && rateOf(e, currency) !== undefined);
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
    },
  );

  // convert ---------------------------------------------------------------
  server.registerTool(
    "convert",
    {
      title: "Convert currency at the BCV rate",
      description:
        "Convert an amount between VES, USD, EUR, CNY, TRY and RUB using the official BCV rate currently in effect, or the rate in effect on a given date (YYYY-MM-DD).",
      inputSchema: {
        amount: z.number().finite().nonnegative().max(1e15).describe("Amount to convert, e.g. 100."),
        from: anyCurrencyEnum.describe("Source currency code."),
        to: anyCurrencyEnum.describe("Target currency code."),
        date: isoDate.optional().describe("Use the rate in effect on this day (YYYY-MM-DD). Omit for the latest rate."),
      },
      outputSchema: {
        amount: z.number(),
        from: z.string(),
        to: z.string(),
        result: z.number(),
        rate: z.number().describe("Units of `to` per 1 unit of `from`."),
        rates_used: z.record(z.string(), z.number()).describe(UNIT),
        date: z.string(),
        effective_date: z.string(),
        note: z.string().optional(),
        source: z.string(),
      },
      annotations: { title: "Convert currency at the BCV rate", ...READ_ONLY },
    },
    async ({ amount, from, to, date }) => {
      if (from === to) return fail(`"from" and "to" are both ${from}; choose two different currencies.`);
      try {
        let e: RateEntry;
        if (date) {
          const r = await loadDay(data, date);
          if ("content" in r) return r;
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
    },
  );

  // get_status ------------------------------------------------------------
  server.registerTool(
    "get_status",
    {
      title: "BCV Today data freshness",
      description:
        "Freshness of the published BCV data: status, last capture time, effective date, age in hours and supported currencies.",
      inputSchema: {},
      outputSchema: {
        status: z.string(),
        updated_at: z.string(),
        generated_at: z.string().optional(),
        date: z.string().optional(),
        effective_date: z.string().optional(),
        age_hours: z.number().optional(),
        stale: z.boolean(),
        supported_currencies: z.array(z.string()),
        currencies: z.record(z.string(), z.boolean()).optional(),
        timezone: z.string().optional(),
        api_version: z.string().optional(),
      },
      annotations: { title: "BCV Today data freshness", ...READ_ONLY },
    },
    async () => {
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
    },
  );

  // resources -------------------------------------------------------------
  const docs = [
    { name: "llms-txt", path: "/llms.txt", mimeType: "text/plain", title: "BCV Today llms.txt", description: "Agent index: API endpoints, data notes and discovery documents." },
    { name: "openapi", path: "/openapi.json", mimeType: "application/json", title: "BCV Today OpenAPI", description: "OpenAPI 3.1 description of the static JSON API." },
  ];
  for (const d of docs) {
    const uri = `https://bcv.today${d.path}`;
    server.registerResource(d.name, uri, { title: d.title, description: d.description, mimeType: d.mimeType }, async () => ({
      contents: [{ uri, mimeType: d.mimeType, text: await data.doc(d.path, d.mimeType) }],
    }));
  }

  return server;
}
