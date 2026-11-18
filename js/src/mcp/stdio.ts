// Local stdio MCP server: `bcv-today mcp`.
//
// Exposes the same five tools as the remote server (https://mcp.bcv.today/mcp)
// with the same names, descriptions, JSON Schemas and tool implementations
// (src/tools.ts). The MCP SDK is an optional peer dependency, imported lazily
// here only, so the library itself stays dependency-free.
import { Api, TTLCache } from "../api.js";
import { ANY_CURRENCIES, CURRENCIES, MAX_HISTORY_DAYS } from "../rules.js";
import {
  type ConvertArgs,
  convert,
  type HistoryArgs,
  history,
  latestRates,
  type RateByDateArgs,
  rateByDate,
  status,
  type ToolOutcome,
} from "../tools.js";
import { VERSION } from "../version.js";
import {
  ARGS,
  DOC_RESOURCES,
  INSTRUCTIONS,
  READ_ONLY,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_WEBSITE,
  TOOLS,
  type ToolName,
} from "./meta.js";
import { EXECUTION, INPUT_SCHEMAS, OUTPUT_SCHEMAS } from "./schemas.js";

export const SDK_PACKAGE = "@modelcontextprotocol/sdk";

/** Thrown when the optional MCP SDK is not installed. */
export class MissingSdk extends Error {
  override name = "MissingSdk";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Tool list in the shape of MCP tools/list. */
export function toolList(): Record<string, unknown>[] {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    title: TOOLS[name].title,
    description: TOOLS[name].description,
    inputSchema: INPUT_SCHEMAS[name],
    outputSchema: OUTPUT_SCHEMAS[name],
    annotations: { title: TOOLS[name].title, ...READ_ONLY },
    ...(EXECUTION[name] ? { execution: EXECUTION[name] } : {}),
  }));
}

type Args = Record<string, unknown>;

/** Validates tool arguments with the same constraints as the Worker's zod schemas. */
export function validateArgs(name: ToolName, args: Args): string[] {
  const issues: string[] = [];
  const date = (key: string, required: boolean) => {
    const v = args[key];
    if (v === undefined && !required) return;
    if (typeof v !== "string") issues.push(`${key}: expected a string`);
    else if (!ISO.test(v)) issues.push(`${key}: ${ARGS.dateFormat}`);
  };
  const oneOf = (key: string, values: readonly string[], required: boolean) => {
    const v = args[key];
    if (v === undefined && !required) return;
    if (typeof v !== "string" || !values.includes(v)) issues.push(`${key}: expected one of ${values.join(", ")}`);
  };
  switch (name) {
    case "get_rate_by_date":
      date("date", true);
      oneOf("currency", CURRENCIES, false);
      break;
    case "get_history": {
      oneOf("currency", CURRENCIES, true);
      const d = args.days;
      if (d !== undefined && (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > MAX_HISTORY_DAYS)) {
        issues.push(`days: expected a whole number from 1 to ${MAX_HISTORY_DAYS}`);
      }
      date("from", false);
      date("to", false);
      break;
    }
    case "convert": {
      const a = args.amount;
      if (typeof a !== "number" || !Number.isFinite(a) || a < 0 || a > 1e15) {
        issues.push("amount: expected a finite number from 0 to 1e15");
      }
      oneOf("from", ANY_CURRENCIES, true);
      oneOf("to", ANY_CURRENCIES, true);
      date("date", false);
      break;
    }
    default:
      break;
  }
  return issues;
}

/** Runs one tool with already validated arguments. */
export function runTool(api: Api, name: ToolName, args: Args): Promise<ToolOutcome> {
  switch (name) {
    case "get_latest_rates":
      return latestRates(api);
    case "get_rate_by_date":
      return rateByDate(api, args as unknown as RateByDateArgs);
    case "get_history":
      return history(api, args as unknown as HistoryArgs);
    case "convert":
      return convert(api, args as unknown as ConvertArgs);
    default:
      return status(api);
  }
}

/** Shared tool outcome -> MCP CallToolResult (text summary + JSON, structuredContent). */
export function toResult(r: ToolOutcome): Record<string, unknown> {
  if (!r.ok) return { content: [{ type: "text", text: r.message }], isError: true };
  return {
    content: [{ type: "text", text: `${r.summary}\n\n${JSON.stringify(r.data, null, 2)}` }],
    structuredContent: r.data,
  };
}

export interface StdioOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

async function loadSdk() {
  try {
    const [server, stdio, types] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
    return { Server: server.Server, StdioServerTransport: stdio.StdioServerTransport, types };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new MissingSdk(
        `"bcv-today mcp" needs the optional peer dependency ${SDK_PACKAGE}. Install it next to bcv-today ` +
          `(npm install ${SDK_PACKAGE}) or run: npx -y -p bcv-today -p ${SDK_PACKAGE} bcv-today mcp`,
      );
    }
    throw err;
  }
}

/** Starts the stdio MCP server; resolves once it is connected. */
export async function runStdioServer(opts: StdioOptions = {}): Promise<void> {
  const { Server, StdioServerTransport, types } = await loadSdk();
  const api = new Api({
    baseUrl: opts.baseUrl,
    timeoutMs: opts.timeoutMs ?? 10_000,
    cache: new TTLCache(300_000),
    userAgent: `bcv-today-js/${VERSION} (+https://bcv.today) mcp-stdio`,
  });
  const server = new Server(
    { name: SERVER_NAME, title: SERVER_TITLE, version: VERSION, websiteUrl: SERVER_WEBSITE },
    { instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
  );
  const tools = toolList();
  server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools }) as never);
  server.setRequestHandler(types.CallToolRequestSchema, async (req) => {
    const name = req.params.name as ToolName;
    if (!(name in TOOLS)) {
      return { content: [{ type: "text", text: `Tool ${req.params.name} not found` }], isError: true } as never;
    }
    const args = (req.params.arguments ?? {}) as Args;
    const issues = validateArgs(name, args);
    if (issues.length) {
      return {
        content: [
          { type: "text", text: `Input validation error: Invalid arguments for tool ${name}: ${issues.join("; ")}` },
        ],
        isError: true,
      } as never;
    }
    return toResult(await runTool(api, name, args)) as never;
  });
  server.setRequestHandler(types.ListResourcesRequestSchema, async () => ({
    resources: DOC_RESOURCES.map((d) => ({
      uri: `https://bcv.today${d.path}`,
      name: d.name,
      title: d.title,
      description: d.description,
      mimeType: d.mimeType,
    })),
  }));
  server.setRequestHandler(types.ReadResourceRequestSchema, async (req) => {
    const d = DOC_RESOURCES.find((r) => `https://bcv.today${r.path}` === req.params.uri);
    if (!d) throw new Error(`Resource ${req.params.uri} not found`);
    return { contents: [{ uri: req.params.uri, mimeType: d.mimeType, text: await api.text(d.path, d.mimeType) }] };
  });
  await server.connect(new StdioServerTransport());
}
