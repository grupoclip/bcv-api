// Command-line interface: bcv-today latest | on | convert | history | status | mcp
//
// Exit codes (same as the Python `bcv` CLI): 0 success, 1 no data for the
// request (date out of range, currency not available), 2 invalid arguments,
// 3 upstream/network error.
import { parseArgs } from "node:util";
import { BCV } from "./client.js";
import { fromNumber, group, parseDecimal } from "./decimal.js";
import { BCVError, InvalidArgument, UpstreamError } from "./errors.js";
import { MAX_HISTORY_DAYS, SOURCE, UNIT } from "./rules.js";
import type { Conversion, DayRate, History, HistoryPoint, Rates, Status } from "./types.js";
import { VERSION } from "./version.js";

export const EXIT_OK = 0;
export const EXIT_NO_DATA = 1;
export const EXIT_USAGE = 2;
export const EXIT_UPSTREAM = 3;

const PROG = "bcv-today";
const ATTRIBUTION = "Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial.";

const HELP = `Usage: ${PROG} [options] <command> [args]

Official Banco Central de Venezuela exchange rates from the BCV Today API
(https://bcv.today). Unofficial client, not affiliated with the bank.

Commands:
  latest                              rates currently in effect
  on <date> [-c CUR]                  rate in effect on a date (YYYY-MM-DD)
  convert <amount> <from> <to>        convert an amount, e.g. "${PROG} convert 100 USD VES"
          [-d DATE] [--decimals N]
  history <currency> [-n DAYS]        daily series (last N days, default 30, max ${MAX_HISTORY_DAYS})
          [--start DATE] [--end DATE]
  status                              data freshness
  mcp                                 run a local MCP server over stdio (needs @modelcontextprotocol/sdk)

Options:
  --json             machine-readable JSON output
  --base-url URL     API origin (default https://bcv.today)
  --timeout SECONDS  request timeout (default 10)
  -h, --help         show this help
  -v, --version      show the version

Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API error.`;

const OPTIONS = {
  json: { type: "boolean" },
  "base-url": { type: "string" },
  timeout: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  currency: { type: "string", short: "c" },
  date: { type: "string", short: "d" },
  decimals: { type: "string" },
  days: { type: "string", short: "n" },
  start: { type: "string" },
  end: { type: "string" },
} as const;

type OptionName = keyof typeof OPTIONS;
const COMMON: OptionName[] = ["json", "base-url", "timeout", "help", "version"];
const COMMANDS: Record<string, { args: string[]; options: OptionName[] }> = {
  latest: { args: [], options: [] },
  on: { args: ["date"], options: ["currency"] },
  convert: { args: ["amount", "from", "to"], options: ["date", "decimals"] },
  history: { args: ["currency"], options: ["days", "start", "end"] },
  status: { args: [], options: [] },
  mcp: { args: [], options: [] },
};

class UsageError extends Error {}

const NEGATIVE = /^-\d+(?:\.\d*)?$/;
const NEG_MARK = "\u0000";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: Io = {
  stdout: (t) => process.stdout.write(`${t}\n`),
  stderr: (t) => process.stderr.write(`${t}\n`),
};

// ---------------------------------------------------------------- rendering

function n(value: number | string, places = 4): string {
  const d = typeof value === "number" ? fromNumber(value) : parseDecimal(value);
  return d ? group(d, places) : String(value);
}

function table(headers: string[], rows: string[][], align: string): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (align[i] === "r" ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function bare(rows: string[][]): string {
  return table(["", ""], rows, "ll").split("\n").slice(2).join("\n");
}

function utc(d: Date | null): string {
  if (!d) return "unknown";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function renderRates(r: Rates): string {
  const rows = Object.entries(r.rates).map(([c, v]) => [c, n(v as number)]);
  return [
    `Official BCV rates, effective ${r.effectiveDate} (Bs. per unit)`,
    "",
    table(["Currency", "Rate (VES)"], rows, "lr"),
    "",
    `Updated ${utc(r.updatedAt)}. ${ATTRIBUTION}`,
  ].join("\n");
}

function renderDay(d: DayRate): string {
  const rows = Object.entries(d.rates).map(([c, v]) => [c, n(v as number)]);
  const out = [
    `BCV rate in effect on ${d.date} (effective date ${d.effectiveDate}, Bs. per unit)`,
    "",
    table(["Currency", "Rate (VES)"], rows, "lr"),
  ];
  if (d.note) out.push("", `Note: ${d.note}`);
  return [...out, "", ATTRIBUTION].join("\n");
}

function renderConversion(c: Conversion): string {
  const places = c.decimals ?? 8;
  const rows = [
    ["Amount", `${n(c.amountExact, 2)} ${c.from}`],
    ["Result", `${n(c.resultText, places)} ${c.to}`],
    ["Rate", `1 ${c.from} = ${n(c.rateExact, 6)} ${c.to}`],
    ...Object.entries(c.ratesUsed).map(([code, v]) => [`BCV ${code}`, `${n(v as number)} VES`]),
    ["Effective", c.effectiveDate],
  ];
  const out = [bare(rows)];
  if (c.note) out.push("", `Note: ${c.note}`);
  return [...out, "", ATTRIBUTION].join("\n");
}

function renderHistory(h: History): string {
  const rows = h.points.map((p) => [p.date, p.effectiveDate + (p.carriedForward ? " *" : ""), n(p.rate)]);
  const sign = h.change >= 0 ? "+" : "";
  const out = [
    `${h.currency}/VES official BCV rate, ${h.start} to ${h.end} (${h.points.length} days)`,
    "",
    table(["Date", "Effective", "Rate (VES)"], rows, "llr"),
    "",
    `First ${n(h.first.rate)}  Last ${n(h.last.rate)}  Change ${sign}${n(h.changeExact)} (${sign}${h.changePct.toFixed(2)}%)`,
    `Min ${n(h.min.rate)} on ${h.min.date}  Max ${n(h.max.rate)} on ${h.max.date}`,
  ];
  if (h.points.some((p) => p.carriedForward))
    out.push("* rate carried forward from the effective date (weekend/holiday).");
  if (h.note) out.push(`Note: ${h.note}`);
  return [...out, ATTRIBUTION].join("\n");
}

function renderStatus(s: Status): string {
  return bare([
    ["Status", s.status + (s.stale ? " (STALE)" : "")],
    ["Updated", typeof s.raw.updated_at === "string" && s.updatedAt ? s.raw.updated_at : "unknown"],
    ["Age", s.ageHours !== null ? `${s.ageHours} h` : "unknown"],
    ["Effective date", s.effectiveDate ?? "unknown"],
    ["Currencies", s.supportedCurrencies.join(", ")],
  ]);
}

// ---------------------------------------------------------------- JSON (same shape as the Python CLI)

function stamp(raw: unknown, parsed: Date | null): string | null {
  return parsed ? (typeof raw === "string" ? raw : parsed.toISOString()) : null;
}

const point = (p: HistoryPoint) => ({ date: p.date, rate: p.rate });

export function toJson(result: Rates | DayRate | History | Conversion | Status, kind: string): Record<string, unknown> {
  switch (kind) {
    case "latest": {
      const r = result as Rates;
      return {
        rates: r.rates,
        date: r.date,
        effective_date: r.effectiveDate,
        updated_at: stamp(r.raw.updated_at, r.updatedAt),
        unit: UNIT,
        source: r.source,
      };
    }
    case "on": {
      const d = result as DayRate;
      return {
        date: d.date,
        effective_date: d.effectiveDate,
        carried_forward: d.carriedForward,
        rates: d.rates,
        updated_at: stamp(d.raw.updated_at, d.updatedAt),
        unit: UNIT,
        source: d.source,
        ...(d.note ? { note: d.note } : {}),
      };
    }
    case "history": {
      const h = result as History;
      return {
        currency: h.currency,
        from: h.start,
        to: h.end,
        points: h.points.length,
        first: point(h.first),
        last: point(h.last),
        min: point(h.min),
        max: point(h.max),
        change: h.change,
        change_pct: h.changePct,
        series: h.points.map((p) => ({ date: p.date, effective_date: p.effectiveDate, rate: p.rate })),
        unit: UNIT,
        source: h.source,
        ...(h.note ? { note: h.note } : {}),
      };
    }
    case "convert": {
      const c = result as Conversion;
      return {
        amount: c.amount,
        from: c.from,
        to: c.to,
        result: c.result,
        result_text: c.resultText,
        result_exact: c.resultExact,
        rate: c.rate,
        rates_used: c.ratesUsed,
        date: c.date,
        effective_date: c.effectiveDate,
        carried_forward: c.carriedForward,
        source: c.source,
        ...(c.note ? { note: c.note } : {}),
      };
    }
    default: {
      const s = result as Status;
      return {
        status: s.status,
        updated_at: stamp(s.raw.updated_at, s.updatedAt),
        generated_at: stamp(s.raw.generated_at, s.generatedAt),
        date: s.date,
        effective_date: s.effectiveDate,
        age_hours: s.ageHours,
        stale: s.stale,
        supported_currencies: s.supportedCurrencies,
        currencies: s.currencies,
        timezone: s.timezone,
        api_version: s.apiVersion,
        source: SOURCE,
      };
    }
  }
}

// ---------------------------------------------------------------- main

interface Parsed {
  command: string;
  positionals: string[];
  values: Partial<Record<OptionName, string | boolean>>;
}

function parse(argv: string[]): Parsed | "help" | "version" {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    // Like argparse, treat negative numbers ("-5") as positionals, not options,
    // so `convert -5 USD VES` reports an invalid amount.
    const args = argv.map((a) => (NEGATIVE.test(a) ? `${NEG_MARK}${a}` : a));
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
    const unmark = (a: string) => (a.startsWith(NEG_MARK) ? a.slice(NEG_MARK.length) : a);
    parsed.positionals = parsed.positionals.map(unmark);
    for (const [k, v] of Object.entries(parsed.values)) if (typeof v === "string") parsed.values[k] = unmark(v);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const values = parsed.values as Parsed["values"];
  if (values.version) return "version";
  if (values.help) return "help";
  const [command, ...positionals] = parsed.positionals;
  if (!command) throw new UsageError("missing command");
  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`unknown command "${command}" (choose from ${Object.keys(COMMANDS).join(", ")})`);
  if (positionals.length !== spec.args.length) {
    const want = spec.args.length ? spec.args.map((a) => `<${a}>`).join(" ") : "no arguments";
    throw new UsageError(`"${command}" expects ${want}`);
  }
  for (const key of Object.keys(values) as OptionName[]) {
    if (!COMMON.includes(key) && !spec.options.includes(key)) {
      throw new UsageError(`option --${key} is not valid for "${command}"`);
    }
  }
  return { command, positionals, values };
}

function int(value: string | boolean | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) {
    throw new UsageError(`argument --${label}: invalid int value: '${String(value)}'`);
  }
  return Number(value);
}

/** Entry point; returns the exit code. `client` is a testing hook. */
export async function main(argv: string[] = process.argv.slice(2), io: Io = defaultIo, client?: BCV): Promise<number> {
  let args: Parsed;
  try {
    const p = parse(argv);
    if (p === "version") {
      io.stdout(`${PROG} ${VERSION}`);
      return EXIT_OK;
    }
    if (p === "help") {
      io.stdout(HELP);
      return EXIT_OK;
    }
    args = p;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`Usage: ${PROG} [options] <command> [args]   (${PROG} --help for details)`);
    io.stderr(`${PROG}: error: ${err.message}`);
    return EXIT_USAGE;
  }
  const { command, positionals: pos, values } = args;
  const asJson = values.json === true;
  try {
    const timeoutSec = values.timeout !== undefined ? Number(values.timeout) : 10;
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
      throw new UsageError(`argument --timeout: invalid float value: '${String(values.timeout)}'`);
    }
    const baseUrl = typeof values["base-url"] === "string" ? values["base-url"] : undefined;
    if (command === "mcp") {
      const { runStdioServer } = await import("./mcp/stdio.js");
      await runStdioServer({ ...(baseUrl ? { baseUrl } : {}), timeoutMs: timeoutSec * 1000 });
      return EXIT_OK;
    }
    const bcv = client ?? new BCV({ ...(baseUrl ? { baseUrl } : {}), timeoutMs: timeoutSec * 1000 });
    let result: Rates | DayRate | History | Conversion | Status;
    let text: string;
    switch (command) {
      case "latest": {
        const r = await bcv.latest();
        [result, text] = [r, renderRates(r)];
        break;
      }
      case "on": {
        const d = await bcv.on(pos[0] as string, values.currency as string | undefined);
        [result, text] = [d, renderDay(d)];
        break;
      }
      case "convert": {
        const decimals = int(values.decimals, "decimals");
        const c = await bcv.convert(pos[0] as string, pos[1] as string, pos[2] as string, {
          ...(values.date !== undefined ? { date: values.date as string } : {}),
          ...(decimals !== undefined ? { decimals } : {}),
        });
        [result, text] = [c, renderConversion(c)];
        break;
      }
      case "history": {
        const days = int(values.days, "days");
        const h = await bcv.history(pos[0] as string, {
          ...(days !== undefined ? { days } : {}),
          ...(values.start !== undefined ? { start: values.start as string } : {}),
          ...(values.end !== undefined ? { end: values.end as string } : {}),
        });
        [result, text] = [h, renderHistory(h)];
        break;
      }
      default: {
        const s = await bcv.status();
        [result, text] = [s, renderStatus(s)];
      }
    }
    io.stdout(asJson ? JSON.stringify(toJson(result, command), null, 2) : text);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${PROG}: error: ${err.message}`);
      return EXIT_USAGE;
    }
    if (err instanceof BCVError || (err instanceof Error && err.name === "MissingSdk")) {
      const code =
        err instanceof InvalidArgument || err.name === "MissingSdk"
          ? EXIT_USAGE
          : err instanceof UpstreamError
            ? EXIT_UPSTREAM
            : EXIT_NO_DATA;
      if (asJson) io.stdout(JSON.stringify({ error: { type: err.name, message: err.message } }));
      io.stderr(`${PROG}: error: ${err.message}`);
      return code;
    }
    throw err;
  }
}
