// Deterministic BCV Today agent (no LLM).
//
// Turns a short Spanish/English request, or a structured DataPart, into one
// call to the shared tool functions in ../tools.ts (the same code the MCP
// server runs), and renders the result as a short localized text plus the
// structured JSON. Anything it cannot map to a skill gets a help reply.
import * as z from "zod";
import { CURRENCIES, type Currency, type DataClient, addDays, todayCaracas } from "../data.js";
import {
  MAX_HISTORY_DAYS,
  type ToolOutcome,
  anyCurrencyEnum,
  argSchemas,
  convert,
  currencyEnum,
  history,
  isoDate,
  latestRates,
  rateByDate,
  status,
} from "../tools.js";

export type Lang = "es" | "en";
export type SkillId = "latest-rates" | "rate-on-date" | "convert" | "history" | "status";
export type AnyCurrency = Currency | "VES";

export type Intent =
  | { skill: "latest-rates"; args: { currency?: Currency } }
  | { skill: "rate-on-date"; args: { date: string; currency?: Currency } }
  | { skill: "convert"; args: { amount: number; from: AnyCurrency; to: AnyCurrency; date?: string } }
  | { skill: "history"; args: { currency: Currency; days?: number; from?: string; to?: string } }
  | { skill: "status"; args: Record<string, never> };

/** What the agent decided to answer. */
export type Reply =
  | { kind: "result"; skill: SkillId; lang: Lang; text: string; data: Record<string, unknown> }
  /** Help, clarification or a request the tools rejected: not a task output. */
  | { kind: "message"; lang: Lang; text: string; data: Record<string, unknown> }
  /** The upstream data API failed. */
  | { kind: "failed"; skill: SkillId; lang: Lang; text: string; data: Record<string, unknown> };

export interface AgentInput {
  text: string;
  data: unknown[];
  /** Language hint from message metadata (e.g. {"language":"es"}). */
  langHint?: string;
}

// ---------------------------------------------------------------- normalization

/** Lowercases and strips accents while keeping string length (indexes stay aligned). */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD")[0] ?? ch;
    const lower = base.toLowerCase();
    out += lower.length === ch.length ? lower : ch.length === 1 ? "?" : ch;
  }
  return out;
}

const ES_HINTS =
  /\b(tasa|tasas|dolar|dolares|bolivar|bolivares|cuanto|cuantos|cual|cuales|convertir|convierte|historial|ultimos?|ultimas?|dias|semanas?|meses|hoy|ayer|del|de|el|la|los|las|en|para|estado|fecha|vigente|oficial|precio|cambio|desde|hasta|que|euro|euros|yuanes|rublos|liras|son|al|una?|actualizo|actualizacion)\b|[¿¡ñáéíóú]/;
const EN_HINTS =
  /\b(rate|rates|dollar|dollars|bolivars|how|much|many|what|which|convert|history|last|past|days|weeks|months|today|yesterday|the|on|in|to|for|status|date|official|price|from|is|of|latest|current|trend|when|updated)\b/;

export function detectLang(text: string, hint?: string): Lang {
  const h = (hint ?? "").toLowerCase();
  if (h.startsWith("es")) return "es";
  if (h.startsWith("en")) return "en";
  const f = fold(text);
  const es = (f.match(new RegExp(ES_HINTS.source, "g")) ?? []).length + (/[¿¡ñáéíóú]/i.test(text) ? 2 : 0);
  const en = (f.match(new RegExp(EN_HINTS.source, "g")) ?? []).length;
  if (es === 0 && en === 0) return "es"; // the site's audience is Venezuelan
  return es >= en ? "es" : "en";
}

// ---------------------------------------------------------------- entity extraction

interface Span {
  start: number;
  end: number;
}
interface CurrencyMention extends Span {
  code: AnyCurrency;
}

const CURRENCY_PATTERNS: [AnyCurrency, RegExp][] = [
  ["USD", /\b(?:usd|dolar(?:es)?|dollars?|bucks?)\b|us\$|\$/g],
  ["EUR", /\b(?:eur|euros?)\b|€/g],
  ["CNY", /\b(?:cny|rmb|yuan(?:es)?|renminbi)\b|¥/g],
  ["TRY", /\b(?:liras?(?: turcas?)?|turkish liras?)\b/g],
  ["RUB", /\b(?:rub|rublos?|rubles?|roubles?)\b|₽/g],
  ["VES", /\b(?:ves|ved|bolivar(?:es)?|bolivars?|bolos)\b|\bbs\b\.?/g],
];

export function findCurrencies(original: string, folded: string): CurrencyMention[] {
  const out: CurrencyMention[] = [];
  for (const [code, re] of CURRENCY_PATTERNS) {
    for (const m of folded.matchAll(re)) out.push({ code, start: m.index, end: m.index + m[0].length });
  }
  // "try" is an English verb: only the upper-case ISO code counts.
  for (const m of original.matchAll(/\bTRY\b/g)) out.push({ code: "TRY", start: m.index, end: m.index + 3 });
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  // Drop mentions nested inside an earlier one ("us$" contains "$").
  return out.filter((m, i) => !out.slice(0, i).some((p) => p.start <= m.start && p.end >= m.end));
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Builds YYYY-MM-DD (may be an invalid calendar date; tools validate it). */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Year for a day/month given without one: this year unless that is in the future. */
function inferYear(m: number, d: number): number {
  const today = todayCaracas();
  const y = Number(today.slice(0, 4));
  return ymd(y, m, d) > addDays(today, 1) ? y - 1 : y;
}

export interface DateMention extends Span {
  date: string;
}

export function findDates(folded: string, lang: Lang): DateMention[] {
  const out: DateMention[] = [];
  const add = (m: RegExpMatchArray, date: string) => out.push({ start: m.index!, end: m.index! + m[0].length, date });

  for (const m of folded.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m, ymd(+m[1]!, +m[2]!, +m[3]!));
  for (const m of folded.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    const a = +m[1]!;
    const b = +m[2]!;
    // Venezuela writes day/month/year; English month/day only when unambiguous or lang=en.
    const dayFirst = a > 12 || (b <= 12 && lang === "es");
    add(m, dayFirst ? ymd(+m[3]!, b, a) : ymd(+m[3]!, a, b));
  }
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|ro)?\\s+(?:de\\s+|of\\s+)?(${MONTH_RE})\\.?(?:,?\\s+(?:de(?:l)?\\s+)?(\\d{4}))?\\b`, "g");
  for (const m of folded.matchAll(dm)) {
    const mo = MONTHS[m[2]!]!;
    const d = +m[1]!;
    add(m, ymd(m[3] ? +m[3] : inferYear(mo, d), mo, d));
  }
  const md = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "g");
  for (const m of folded.matchAll(md)) {
    const mo = MONTHS[m[1]!]!;
    const d = +m[2]!;
    add(m, ymd(m[3] ? +m[3] : inferYear(mo, d), mo, d));
  }
  const today = todayCaracas();
  for (const m of folded.matchAll(/\b(?:anteayer|antier|day before yesterday)\b/g)) add(m, addDays(today, -2));
  for (const m of folded.matchAll(/\b(?:ayer|yesterday)\b/g)) add(m, addDays(today, -1));
  for (const m of folded.matchAll(/\b(?:manana|tomorrow)\b/g)) add(m, addDays(today, 1));

  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out.filter((d, i) => !out.slice(0, i).some((p) => p.start < d.end && d.start < p.end));
}

export interface MonthRange extends Span {
  from: string;
  to: string;
}

/** "enero 2026", "enero de 2026", "January 2026" -> that whole month. */
export function findMonthRange(folded: string): MonthRange | undefined {
  const m = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(?:de(?:l)?\\s+)?(\\d{4})\\b`).exec(folded);
  if (!m) return undefined;
  const mo = MONTHS[m[1]!]!;
  const y = +m[2]!;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: m.index, end: m.index + m[0].length, from: ymd(y, mo, 1), to: ymd(y, mo, last) };
}

export interface DurationMention extends Span {
  days: number;
}

export function findDuration(folded: string): DurationMention | undefined {
  const unit: Record<string, number> = {
    dia: 1, dias: 1, day: 1, days: 1,
    semana: 7, semanas: 7, week: 7, weeks: 7,
    mes: 30, meses: 30, month: 30, months: 30,
    ano: 365, anos: 365, year: 365, years: 365,
  };
  const n = /\b(\d{1,4})\s*(dias?|days?|semanas?|weeks?|mes(?:es)?|months?|anos?|years?)\b/.exec(folded);
  if (n) return { start: n.index, end: n.index + n[0].length, days: +n[1]! * unit[n[2]!]! };
  const one = /\b(?:(?:la |el )?(?:ultim[oa]|pasad[oa])\s+(semana|mes|ano)|(?:the )?(?:last|past)\s+(week|month|year))\b/.exec(folded);
  if (one) return { start: one.index, end: one.index + one[0].length, days: unit[(one[1] ?? one[2])!]! };
  return undefined;
}

export interface AmountMention extends Span {
  value: number;
}

/** Parses "1.234,56", "1,234.56", "100", "2,5", "1.000" (thousands), with k/mil/millones suffixes. */
export function parseNumber(raw: string): number | undefined {
  let s = raw;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const groups = parts.slice(1);
    if (groups.length > 1 || (groups.length === 1 && groups[0]!.length === 3 && parts[0] !== "0")) {
      // 1.000 / 1,000 / 1.000.000 → thousands separators
      s = parts.join("");
    } else {
      s = parts.join(".");
    }
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

export function findAmount(folded: string, masked: Span[]): AmountMention | undefined {
  const re = /(?<![\w.,])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*(k|mil|millon(?:es)?|millions?|mm)\b)?/g;
  for (const m of folded.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (masked.some((s) => s.start < end && start < s.end)) continue;
    let v = parseNumber(m[1]!);
    if (v === undefined) continue;
    const suffix = m[2];
    if (suffix === "k" || suffix === "mil") v *= 1_000;
    else if (suffix) v *= 1_000_000;
    return { start, end, value: v };
  }
  return undefined;
}

// ---------------------------------------------------------------- text -> intent

const HELP_RE = /\b(ayuda|help|que puedes hacer|what can you do|comandos|commands|hola|hello|hi|buenas|menu|opciones|options)\b/;
const STATUS_RE = /\b(status|estado|frescura|freshness|stale|salud|health|ultima captura|last capture)\b/;
const STATUS_WHEN_RE = /\b(cuando|when)\b.*\b(actualiz\w*|updated?|publica\w*|published|captur\w*)\b/;
const HISTORY_RE =
  /\b(historial|historico|historia|history|historical|serie|series|evolucion|tendencia|trend|grafic\w*|chart|variacion|desde|hasta|between|entre)\b/;
const CONVERT_RE = /\b(convert\w*|conversion|cambiar|cambia|calcula\w*|cuanto|cuantos|cuantas|how much|how many|equivale\w*|son|is|are|en|in|a|to|into|para)\b/;
const RATE_RE =
  /\b(tasa|tasas|rate|rates|precio|price|cotizacion|valor|cambio|exchange|oficial|official|bcv|hoy|today|actual|current|latest|ultima|vigente)\b/;

/** Maps free text to an intent, or undefined when it is not a rate question. */
export function parseText(text: string, lang: Lang): Intent | undefined {
  const f = fold(text);
  const currencies = findCurrencies(text, f);
  const dates = findDates(f, lang);
  const duration = findDuration(f);
  const month = dates.length === 0 ? findMonthRange(f) : undefined;
  const masked: Span[] = [...dates, ...(duration ? [duration] : []), ...(month ? [month] : [])];
  const amount = findAmount(f, masked);
  const foreign = currencies.map((c) => c.code).filter((c): c is Currency => c !== "VES");
  const focus = foreign[0];

  const hasHistoryWord = HISTORY_RE.test(f);
  if (!amount && !hasHistoryWord && (STATUS_RE.test(f) || STATUS_WHEN_RE.test(f))) return { skill: "status", args: {} };

  if (hasHistoryWord || ((duration || month) && !amount)) {
    const currency = focus ?? "USD";
    if (month) return { skill: "history", args: { currency, from: month.from, to: month.to } };
    if (dates.length >= 2) {
      const sorted = dates.map((d) => d.date).sort();
      return { skill: "history", args: { currency, from: sorted[0]!, to: sorted[sorted.length - 1]! } };
    }
    if (dates.length === 1 && /\b(desde|since|from)\b/.test(f)) {
      return { skill: "history", args: { currency, from: dates[0]!.date } };
    }
    if (dates.length === 1 && /\b(hasta|until|to)\b/.test(f)) {
      return { skill: "history", args: { currency, to: dates[0]!.date } };
    }
    return { skill: "history", args: { currency, days: Math.min(duration?.days ?? 30, MAX_HISTORY_DAYS) } };
  }

  if (amount && (currencies.length > 0 || CONVERT_RE.test(f))) {
    const between = (a: number, b: number) => f.slice(a, b);
    // Source = currency written right after the amount ("100 dólares", "100 US dollars")
    // or right before it ("$100", "Bs. 500", "USD 100").
    let source = currencies.find((c) => c.start >= amount.end && /^\s*(?:us|u\.s\.|american|americanos?|estadounidenses?)?\s*$/.test(between(amount.end, c.start)));
    source ??= currencies.find((c) => c.end <= amount.start && /^\s*$/.test(between(c.end, amount.start)));
    let target = currencies.find((c) => c.code !== source?.code);
    let from: AnyCurrency;
    let to: AnyCurrency;
    if (source) {
      from = source.code;
      to = target?.code ?? (from === "VES" ? "USD" : "VES");
    } else if (target) {
      // "convertir 100 a bolívares": the only currency named is the target.
      to = target.code;
      from = to === "VES" ? "USD" : "VES";
    } else {
      from = "USD";
      to = "VES";
    }
    return { skill: "convert", args: { amount: amount.value, from, to, ...(dates[0] ? { date: dates[0].date } : {}) } };
  }

  if (dates.length > 0) {
    return { skill: "rate-on-date", args: { date: dates[0]!.date, ...(focus ? { currency: focus } : {}) } };
  }

  if (HELP_RE.test(f) && currencies.length === 0) return undefined;
  if (currencies.length > 0 || RATE_RE.test(f)) {
    return { skill: "latest-rates", args: focus ? { currency: focus } : {} };
  }
  return undefined;
}

// ---------------------------------------------------------------- structured input

const SKILL_ALIASES: Record<string, SkillId> = {
  "latest-rates": "latest-rates", latest: "latest-rates", get_latest_rates: "latest-rates", "get-latest-bcv-rates": "latest-rates", rates: "latest-rates",
  "rate-on-date": "rate-on-date", get_rate_by_date: "rate-on-date", rate_by_date: "rate-on-date", "rate-by-date": "rate-on-date",
  convert: "convert", conversion: "convert",
  history: "history", get_history: "history", "get-bcv-rate-history": "history",
  status: "status", get_status: "status",
};

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);

const structuredSchemas = {
  "latest-rates": z.object({ currency: z.preprocess(upper, currencyEnum).optional() }),
  "rate-on-date": z.object({ date: isoDate, currency: z.preprocess(upper, currencyEnum).optional() }),
  convert: argSchemas.convert.extend({
    amount: z.preprocess(num, argSchemas.convert.shape.amount),
    from: z.preprocess(upper, anyCurrencyEnum),
    to: z.preprocess(upper, anyCurrencyEnum),
  }),
  history: argSchemas.history.extend({
    currency: z.preprocess(upper, currencyEnum).default("USD"),
    days: z.preprocess(num, argSchemas.history.shape.days),
  }),
  status: z.object({}),
} as const;

export type StructuredResult = { intent: Intent } | { error: string; skill?: string };

/** Interprets a DataPart object. Returns undefined when it is not addressed to a skill. */
export function parseStructured(value: unknown): StructuredResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const rawArgs = (obj.arguments ?? obj.args ?? obj.input ?? obj.params) as Record<string, unknown> | undefined;
  const args: Record<string, unknown> = { ...obj, ...(rawArgs && typeof rawArgs === "object" ? rawArgs : {}) };
  for (const k of ["skill", "tool", "skillId", "name", "arguments", "args", "input", "params", "language", "lang"]) delete args[k];

  const named = obj.skill ?? obj.tool ?? obj.skillId;
  let skill: SkillId | undefined;
  if (typeof named === "string") {
    skill = SKILL_ALIASES[named.trim().toLowerCase()];
    if (!skill) return { error: `Unknown skill "${named}". Use one of: ${Object.keys(structuredSchemas).join(", ")}.`, skill: named };
  } else if ("amount" in args) skill = "convert";
  else if ("days" in args || ("from" in args && !("amount" in args)) || "to" in args) skill = "history";
  else if ("date" in args) skill = "rate-on-date";
  else return undefined;

  const parsed = structuredSchemas[skill].safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { error: `Invalid arguments for skill "${skill}": ${issues}.`, skill };
  }
  return { intent: { skill, args: parsed.data } as Intent };
}

// ---------------------------------------------------------------- rendering

function n(lang: Lang, v: number, max = 4, min = 2): string {
  return v.toLocaleString(lang === "es" ? "es-VE" : "en-US", { maximumFractionDigits: max, minimumFractionDigits: min });
}

const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function weekdayEs(date: string): string {
  return WEEKDAYS_ES[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

function ratesLine(lang: Lang, rates: Record<string, number>): string {
  return Object.entries(rates)
    .map(([c, v]) => `${c} ${n(lang, v)}`)
    .join(", ");
}

/** Spanish version of the history window notes built in bcv-today (rules.ts); unknown text passes through. */
function historyNoteEs(note: string): string {
  return note
    .replace(/History for (\w+) starts on (\S+); earlier dates were skipped\./g, "El historial de $1 empieza el $2; se omitieron las fechas anteriores.")
    .replace(/Latest available date is (\S+)\./g, "La fecha más reciente disponible es el $1.");
}

/** Short human text for a successful tool outcome. English reuses the tool summary. */
export function renderText(intent: Intent, lang: Lang, r: Extract<ToolOutcome, { ok: true }>): string {
  const d = r.data as Record<string, any>;
  if (lang === "en") {
    if (intent.skill === "latest-rates" && intent.args.currency && d.rates?.[intent.args.currency] !== undefined) {
      const c = intent.args.currency;
      return `1 ${c} = Bs. ${n("en", d.rates[c])} (official BCV rate, effective ${d.effective_date}). ${r.summary}`;
    }
    return r.summary;
  }
  switch (intent.skill) {
    case "latest-rates": {
      const all = `Tasas oficiales del BCV (fecha valor ${d.effective_date}, Bs. por unidad): ${ratesLine("es", d.rates)}.`;
      const c = intent.args.currency;
      if (c && d.rates?.[c] !== undefined) {
        return `1 ${c} = Bs. ${n("es", d.rates[c])} (tasa oficial del BCV, fecha valor ${d.effective_date}). ${all}`;
      }
      return all;
    }
    case "rate-on-date": {
      let s = `Tasa BCV vigente el ${d.date} (Bs. por unidad): ${ratesLine("es", d.rates)}.`;
      if (d.carried_forward) {
        s +=
          ` Para el ${d.date} (${weekdayEs(d.date)}) rige la tasa con fecha valor ${d.effective_date} (${weekdayEs(d.effective_date)}):` +
          " el BCV no publica los fines de semana ni los feriados, así que la última tasa publicada sigue vigente.";
      }
      return s;
    }
    case "convert": {
      let s =
        `${n("es", d.amount, 2)} ${d.from} = ${n("es", d.result, 2)} ${d.to} a la tasa oficial del BCV ` +
        `(fecha valor ${d.effective_date}; 1 ${d.from} = ${n("es", d.rate, 6)} ${d.to}).`;
      if (d.note) s += ` Para el ${d.date} rige la tasa con fecha valor ${d.effective_date} (los fines de semana y feriados se mantiene la última tasa publicada).`;
      return s;
    }
    case "history": {
      const pct = d.change_pct as number;
      const sign = pct >= 0 ? "+" : "";
      return (
        `${d.currency}/VES del ${d.from} al ${d.to} (${d.points} días): ${n("es", d.first.rate)} → ${n("es", d.last.rate)} ` +
        `(${sign}${n("es", pct, 2)} %). Mínimo ${n("es", d.min.rate)} el ${d.min.date}, máximo ${n("es", d.max.rate)} el ${d.max.date}.` +
        (d.note ? ` Nota: ${historyNoteEs(d.note)}` : "")
      );
    }
    case "status": {
      const ok = d.status === "ok" && !d.stale;
      return (
        `Estado ${d.status}${d.stale ? " (DESACTUALIZADO)" : ""}: última captura ${d.updated_at}` +
        (d.age_hours !== undefined ? ` (hace ${n("es", d.age_hours, 1, 0)} h)` : "") +
        `, fecha valor ${d.effective_date ?? "desconocida"}.` +
        (ok ? " Los datos están al día." : "")
      );
    }
  }
}

export const SKILL_EXAMPLES: Record<SkillId, { es: string; en: string; data: Record<string, unknown> }> = {
  "latest-rates": { es: "¿Cuál es la tasa del dólar BCV hoy?", en: "What is the official BCV dollar rate today?", data: { skill: "latest-rates", currency: "USD" } },
  "rate-on-date": { es: "tasa del 2026-01-04", en: "USD rate on 2026-01-04", data: { skill: "rate-on-date", date: "2026-01-04", currency: "USD" } },
  convert: { es: "convertir 100 USD a VES", en: "convert 50000 VES to EUR", data: { skill: "convert", amount: 100, from: "USD", to: "VES" } },
  history: { es: "historial del dólar últimos 7 días", en: "USD history for the last 30 days", data: { skill: "history", currency: "USD", days: 7 } },
  status: { es: "estado de los datos", en: "status", data: { skill: "status" } },
};

export function helpReply(lang: Lang | "both", reason?: string): Reply {
  const es =
    "Soy el agente de BCV Today: respondo con las tasas oficiales del Banco Central de Venezuela (USD, EUR, CNY, TRY y RUB en bolívares). Puedo:\n" +
    `• Tasas vigentes: «${SKILL_EXAMPLES["latest-rates"].es}»\n` +
    `• Tasa en una fecha: «${SKILL_EXAMPLES["rate-on-date"].es}»\n` +
    `• Convertir: «${SKILL_EXAMPLES.convert.es}», «100 dólares en bolívares»\n` +
    `• Historial: «${SKILL_EXAMPLES.history.es}»\n` +
    `• Estado de los datos: «${SKILL_EXAMPLES.status.es}»\n` +
    'También acepto un DataPart JSON, p. ej. {"skill":"convert","amount":100,"from":"USD","to":"VES"}.';
  const en =
    "I am the BCV Today agent: I answer with the official Banco Central de Venezuela rates (USD, EUR, CNY, TRY and RUB in bolivars). I can do:\n" +
    `• Latest rates: "${SKILL_EXAMPLES["latest-rates"].en}"\n` +
    `• Rate on a date: "${SKILL_EXAMPLES["rate-on-date"].en}"\n` +
    `• Conversions: "${SKILL_EXAMPLES.convert.en}", "100 dollars in bolivars"\n` +
    `• History: "${SKILL_EXAMPLES.history.en}"\n` +
    `• Data freshness: "${SKILL_EXAMPLES.status.en}"\n` +
    'Agents can also send a JSON DataPart, e.g. {"skill":"convert","amount":100,"from":"USD","to":"VES"}.';
  const text = lang === "es" ? es : lang === "en" ? en : `${es}\n\n${en}`;
  return {
    kind: "message",
    lang: lang === "both" ? "es" : lang,
    text: reason ? `${reason}\n\n${text}` : text,
    data: {
      type: "help",
      ...(reason ? { reason } : {}),
      skills: Object.entries(SKILL_EXAMPLES).map(([id, e]) => ({ id, examples: [e.es, e.en], data_example: e.data })),
      currencies: ["VES", ...CURRENCIES],
      languages: ["es", "en"],
      documentation: "https://bcv.today/en/api/#a2a-agent",
    },
  };
}

// ---------------------------------------------------------------- run

export async function runIntent(data: DataClient, intent: Intent, lang: Lang): Promise<Reply> {
  let r: ToolOutcome;
  switch (intent.skill) {
    case "latest-rates":
      r = await latestRates(data);
      break;
    case "rate-on-date":
      r = await rateByDate(data, intent.args);
      break;
    case "convert":
      if (intent.args.from === intent.args.to) {
        const c = intent.args.from;
        return {
          kind: "message",
          lang,
          text:
            lang === "es"
              ? `Indica dos monedas distintas para convertir (recibí ${c} como origen y como destino), p. ej. «convertir 100 USD a VES».`
              : `Name two different currencies to convert (I got ${c} on both sides), e.g. "convert 100 USD to VES".`,
          data: { type: "error", code: "invalid_arguments", skill: "convert", arguments: intent.args, message: `"from" and "to" are both ${c}.` },
        };
      }
      r = await convert(data, intent.args);
      break;
    case "history":
      r = await history(data, intent.args);
      break;
    case "status":
      r = await status(data);
      break;
  }
  if (r.ok) {
    return {
      kind: "result",
      skill: intent.skill,
      lang,
      text: renderText(intent, lang, r),
      data: { skill: intent.skill, arguments: intent.args, result: r.data },
    };
  }
  const lead = lang === "es" ? (r.upstream ? "No pude consultar los datos del BCV en este momento" : "No pude responder esa consulta") : "";
  const text = lead ? `${lead}: ${r.message}` : r.message;
  const payload = { type: "error", code: r.upstream ? "upstream_unavailable" : "invalid_request", skill: intent.skill, arguments: intent.args, message: r.message };
  return r.upstream
    ? { kind: "failed", skill: intent.skill, lang, text, data: payload }
    : { kind: "message", lang, text, data: payload };
}

/** Full pipeline: structured DataPart first, then JSON-in-text, then free text. */
export async function respond(dataClient: DataClient, input: AgentInput): Promise<Reply> {
  const text = input.text.trim();
  for (const d of input.data) {
    const obj = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    const hint = input.langHint ?? (typeof obj.language === "string" ? obj.language : typeof obj.lang === "string" ? obj.lang : undefined);
    // Agents sending JSON without a language hint get English text.
    const lang: Lang = hint || text ? detectLang(text, hint) : "en";
    const s = parseStructured(d);
    if (!s) continue;
    if ("error" in s) return { kind: "message", lang, text: s.error, data: { type: "error", code: "invalid_arguments", ...(s.skill ? { skill: s.skill } : {}), message: s.error } };
    return runIntent(dataClient, s.intent, lang);
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const obj = JSON.parse(text) as unknown;
      const s = parseStructured(obj);
      const o = obj as Record<string, unknown>;
      const hint = input.langHint ?? (typeof o?.language === "string" ? o.language : undefined);
      const lang: Lang = hint ? detectLang("", hint) : "en";
      if (s && "error" in s) return { kind: "message", lang, text: s.error, data: { type: "error", code: "invalid_arguments", message: s.error } };
      if (s) return runIntent(dataClient, s.intent, lang);
    } catch {
      /* not JSON: treat as text */
    }
  }
  if (!text) return helpReply(input.langHint ? detectLang("", input.langHint) : "both");
  const lang = detectLang(text, input.langHint);
  const intent = parseText(text, lang);
  if (!intent) {
    const hasSignal = input.langHint || ES_HINTS.test(fold(text)) || EN_HINTS.test(fold(text));
    const reason =
      lang === "es"
        ? HELP_RE.test(fold(text)) ? undefined : "No entendí la consulta."
        : HELP_RE.test(fold(text)) ? undefined : "I did not understand the request.";
    return helpReply(hasSignal ? lang : "both", reason);
  }
  return runIntent(dataClient, intent, lang);
}
