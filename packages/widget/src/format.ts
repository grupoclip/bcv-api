// Pure helpers: languages, currency names, number and date formatting, amount parsing.
// No DOM access here, so the unit tests can import this file directly in Node.

export type Lang = "es" | "en";
export const CURRENCIES = ["USD", "EUR", "CNY", "TRY", "RUB"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const STRINGS = {
  es: {
    names: { USD: "Dólar", EUR: "Euro", CNY: "Yuan", TRY: "Lira turca", RUB: "Rublo" },
    rate: "Tasa BCV",
    converter: "Convertidor BCV",
    toVes: "a bolívares",
    effective: "Fecha valor",
    change: "Variación frente a la tasa anterior:",
    amount: "Monto en",
    invalid: "Monto no válido",
    source: "Fuente:",
    loading: "Cargando la tasa BCV…",
    error: "No se pudo cargar la tasa BCV.",
    cached: "Dato guardado: no se pudo actualizar.",
  },
  en: {
    names: { USD: "US dollar", EUR: "Euro", CNY: "Chinese yuan", TRY: "Turkish lira", RUB: "Russian ruble" },
    rate: "BCV rate",
    converter: "BCV converter",
    toVes: "to bolívars",
    effective: "Effective",
    change: "Change from the previous rate:",
    amount: "Amount in",
    invalid: "Invalid amount",
    source: "Source:",
    loading: "Loading the BCV rate…",
    error: "Couldn't load the BCV rate.",
    cached: "Cached value: couldn't refresh.",
  },
} satisfies Record<Lang, unknown>;

/** "en", "en-US", "EN_gb" -> "en"; anything else -> "es". */
export function toLang(value: string | null | undefined): Lang {
  return /^en\b/i.test(value ?? "") ? "en" : "es";
}

export function toCurrency(value: string | null | undefined): Currency {
  const c = (value ?? "").toUpperCase() as Currency;
  return CURRENCIES.includes(c) ? c : "USD";
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format with exactly `digits` decimals: es-VE (1.007,3867) or en-US (1,007.3867). */
export function formatNumber(value: number, lang: Lang, digits: number, signed = false): string {
  const key = lang + digits + signed;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === "es" ? "es-VE" : "en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatters.set(key, f);
  }
  return f.format(value);
}

/** "2026-11-18" -> "18/11/2026" (es) or "2026-11-18" (en). */
export function formatDate(iso: string, lang: Lang): string {
  return lang === "es" ? iso.split("-").reverse().join("/") : iso;
}

/** Shift an ISO calendar day by `days` (UTC arithmetic, no time zone surprises). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

/**
 * Parse a typed amount in either convention: "1.234,5", "1,234.5", "1234,5", "1234.5", "1 234,5".
 * When both separators appear, the last one is the decimal mark and the other groups thousands; a separator
 * that appears more than once groups thousands. A single dot or comma is the decimal mark, except when it
 * groups exactly three digits after a 1-3 digit non-zero integer part and is the page language's thousands
 * separator: "1.234" is 1234 in Spanish and "1,234" is 1234 in English (the other way round they are 1.234).
 * Thousands groups must have three digits. Returns NaN for empty, negative or malformed input.
 */
export function parseAmount(input: string, lang: Lang = "es"): number {
  const s = input.replace(/\s/g, "");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  let decimal = dot > comma ? "." : ",";
  let group = decimal === "." ? "," : ".";
  if (dot < 0 || comma < 0) {
    // At most one kind of separator: repeated, or the language's own thousands grouping, means thousands.
    const thousands =
      s.split(decimal).length !== 2 ||
      (/^[1-9]\d{0,2}[.,]\d{3}$/.test(s) && (decimal === "." ? lang === "es" : lang === "en"));
    if (thousands) [decimal, group] = [group, decimal];
  }
  const [int = "", frac = "", extra] = s.split(decimal);
  if (
    extra !== undefined ||
    !/\d/.test(s) ||
    !/^\d*$/.test(frac) ||
    !new RegExp(`^(\\d*|\\d{1,3}(\\${group}\\d{3})+)$`).test(int)
  ) {
    return Number.NaN;
  }
  return Number(`${int.split(group).join("")}.${frac}`);
}
