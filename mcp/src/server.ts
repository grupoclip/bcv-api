import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { DataClient } from "./data.js";
import {
  type ToolOutcome,
  UNIT,
  convert,
  convertInput,
  history,
  historyInput,
  latestRates,
  rateByDate,
  rateByDateInput,
  status,
} from "./tools.js";

export const SERVER_NAME = "bcv-today";
export const SERVER_VERSION = "1.0.0";

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

/** Shared tool outcome -> MCP CallToolResult (text summary + JSON, structuredContent). */
function toResult(r: ToolOutcome): CallToolResult {
  if (!r.ok) return { content: [{ type: "text", text: r.message }], isError: true };
  return {
    content: [{ type: "text", text: `${r.summary}\n\n${JSON.stringify(r.data, null, 2)}` }],
    structuredContent: r.data,
  };
}

// ---------------------------------------------------------------- server

export function buildServer(data: DataClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: "BCV Today", version: SERVER_VERSION, websiteUrl: "https://bcv.today" },
    { instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
  );

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
    async () => toResult(await latestRates(data)),
  );

  server.registerTool(
    "get_rate_by_date",
    {
      title: "BCV rate on a date",
      description:
        "Official BCV rate(s) in effect on a calendar day (YYYY-MM-DD, from 2021-08-02). Weekends and holidays carry forward the last published rate; the response explains it. Optionally restrict to one currency.",
      inputSchema: rateByDateInput,
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
    async (args) => toResult(await rateByDate(data, args)),
  );

  server.registerTool(
    "get_history",
    {
      title: "BCV rate history",
      description:
        "Daily official BCV rate series for one currency, either the last N calendar days (days, default 30, max 1830) or a from/to date range, with min, max and percentage change.",
      inputSchema: historyInput,
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
    async (args) => toResult(await history(data, args)),
  );

  server.registerTool(
    "convert",
    {
      title: "Convert currency at the BCV rate",
      description:
        "Convert an amount between VES, USD, EUR, CNY, TRY and RUB using the official BCV rate currently in effect, or the rate in effect on a given date (YYYY-MM-DD).",
      inputSchema: convertInput,
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
    async (args) => toResult(await convert(data, args)),
  );

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
    async () => toResult(await status(data)),
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
