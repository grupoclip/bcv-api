// MCP server metadata shared by the remote Worker (mcp/src/server.ts) and the
// local stdio server (`bcv-today mcp`): server identity, instructions, tool
// names/titles/descriptions, argument descriptions and the documentation
// resources. Plain data, no dependencies.

export const SERVER_NAME = "bcv-today";
export const SERVER_TITLE = "BCV Today";
export const SERVER_WEBSITE = "https://bcv.today";

export const INSTRUCTIONS = [
  "BCV Today: official exchange rates published by Banco Central de Venezuela (BCV).",
  "Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB.",
  "effective_date is the official BCV validity date ('fecha valor'); updated_at is the UTC capture time.",
  "BCV does not publish on weekends and holidays: the last published rate stays in effect, so effective_date may be earlier than the requested date.",
  "Data is free, public and read-only. Unofficial project, not affiliated with the bank. Docs: https://bcv.today/llms.txt",
].join(" ");

/** Every tool is a read-only, idempotent lookup on a closed data set. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export type ToolName = "get_latest_rates" | "get_rate_by_date" | "get_history" | "convert" | "get_status";

export const TOOLS: Record<ToolName, { title: string; description: string }> = {
  get_latest_rates: {
    title: "Latest official BCV rates",
    description:
      "Official BCV exchange rates currently in effect for USD, EUR, CNY, TRY and RUB, in bolivars (VES) per unit, with effective date and capture time.",
  },
  get_rate_by_date: {
    title: "BCV rate on a date",
    description:
      "Official BCV rate(s) in effect on a calendar day (YYYY-MM-DD, from 2021-08-02). Weekends and holidays carry forward the last published rate; the response explains it. Optionally restrict to one currency.",
  },
  get_history: {
    title: "BCV rate history",
    description:
      "Daily official BCV rate series for one currency, either the last N calendar days (days, default 30, max 1830) or a from/to date range, with min, max and percentage change.",
  },
  convert: {
    title: "Convert currency at the BCV rate",
    description:
      "Convert an amount between VES, USD, EUR, CNY, TRY and RUB using the official BCV rate currently in effect, or the rate in effect on a given date (YYYY-MM-DD).",
  },
  get_status: {
    title: "BCV Today data freshness",
    description:
      "Freshness of the published BCV data: status, last capture time, effective date, age in hours and supported currencies.",
  },
};

/** Argument descriptions, keyed by tool then argument. */
export const ARGS = {
  dateFormat: "Use the YYYY-MM-DD format, e.g. 2026-01-02.",
  get_rate_by_date: {
    date: "Calendar day, YYYY-MM-DD (e.g. 2026-01-02).",
    currency: "Only return this currency. Omit for all available.",
  },
  get_history: {
    currency: "Currency to chart against the bolivar.",
    days: "Last N calendar days ending on the latest published date (default 30). Ignored when from/to is given.",
    from: "Range start, YYYY-MM-DD (inclusive).",
    to: "Range end, YYYY-MM-DD (inclusive). Defaults to the latest date.",
  },
  convert: {
    amount: "Amount to convert, e.g. 100.",
    from: "Source currency code.",
    to: "Target currency code.",
    date: "Use the rate in effect on this day (YYYY-MM-DD). Omit for the latest rate.",
  },
  convertRate: "Units of `to` per 1 unit of `from`.",
} as const;

/** Documentation exposed as MCP resources. */
export const DOC_RESOURCES = [
  {
    name: "llms-txt",
    path: "/llms.txt",
    mimeType: "text/plain",
    title: "BCV Today llms.txt",
    description: "Agent index: API endpoints, data notes and discovery documents.",
  },
  {
    name: "openapi",
    path: "/openapi.json",
    mimeType: "application/json",
    title: "BCV Today OpenAPI",
    description: "OpenAPI 3.1 description of the static JSON API.",
  },
] as const;
