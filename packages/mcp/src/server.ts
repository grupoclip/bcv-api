import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { ARGS, DOC_RESOURCES, INSTRUCTIONS, READ_ONLY, SERVER_NAME, SERVER_TITLE, SERVER_WEBSITE, TOOLS } from "./meta.js";
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

export { SERVER_NAME };
export const SERVER_VERSION = "1.0.0";

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
    { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION, websiteUrl: SERVER_WEBSITE },
    { instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
  );

  server.registerTool(
    "get_latest_rates",
    {
      title: TOOLS.get_latest_rates.title,
      description: TOOLS.get_latest_rates.description,
      inputSchema: {},
      outputSchema: {
        rates: z.record(z.string(), z.number()).describe(UNIT),
        effective_date: z.string(),
        date: z.string(),
        updated_at: z.string(),
        unit: z.string(),
        source: z.string(),
      },
      annotations: { title: TOOLS.get_latest_rates.title, ...READ_ONLY },
    },
    async () => toResult(await latestRates(data)),
  );

  server.registerTool(
    "get_rate_by_date",
    {
      title: TOOLS.get_rate_by_date.title,
      description: TOOLS.get_rate_by_date.description,
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
      annotations: { title: TOOLS.get_rate_by_date.title, ...READ_ONLY },
    },
    async (args) => toResult(await rateByDate(data, args)),
  );

  server.registerTool(
    "get_history",
    {
      title: TOOLS.get_history.title,
      description: TOOLS.get_history.description,
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
      annotations: { title: TOOLS.get_history.title, ...READ_ONLY },
    },
    async (args) => toResult(await history(data, args)),
  );

  server.registerTool(
    "convert",
    {
      title: TOOLS.convert.title,
      description: TOOLS.convert.description,
      inputSchema: convertInput,
      outputSchema: {
        amount: z.number(),
        from: z.string(),
        to: z.string(),
        result: z.number(),
        rate: z.number().describe(ARGS.convertRate),
        rates_used: z.record(z.string(), z.number()).describe(UNIT),
        date: z.string(),
        effective_date: z.string(),
        note: z.string().optional(),
        source: z.string(),
      },
      annotations: { title: TOOLS.convert.title, ...READ_ONLY },
    },
    async (args) => toResult(await convert(data, args)),
  );

  server.registerTool(
    "get_status",
    {
      title: TOOLS.get_status.title,
      description: TOOLS.get_status.description,
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
      annotations: { title: TOOLS.get_status.title, ...READ_ONLY },
    },
    async () => toResult(await status(data)),
  );

  // resources -------------------------------------------------------------
  for (const d of DOC_RESOURCES) {
    const uri = `https://bcv.today${d.path}`;
    server.registerResource(d.name, uri, { title: d.title, description: d.description, mimeType: d.mimeType }, async () => ({
      contents: [{ uri, mimeType: d.mimeType, text: await data.doc(d.path, d.mimeType) }],
    }));
  }

  return server;
}
