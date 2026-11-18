// A2A (Agent2Agent) JSON-RPC endpoint for the Worker: POST https://mcp.bcv.today/a2a.
//
// Uses the official @a2a-js/sdk request handler and JSON-RPC transports
// (A2A 1.0, plus the 0.3 compatibility layer for older clients) wired to a
// plain fetch handler instead of Express. Stateless: every request gets its
// own in-memory task store and the agent completes synchronously, so there is
// no Durable Object and no task to fetch later (GetTask answers TaskNotFound).
import { AgentCard, type Message, type Part, Role, type Task, TaskState } from "@a2a-js/sdk";
import { ContentTypeNotSupportedError } from "@a2a-js/sdk/errors";
import {
  type AgentExecutor,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  type RequestContext,
  type ExecutionEventBus,
  AgentEvent,
  UnauthenticatedUser,
  defaultServerCallContextBuilder,
  validateVersion,
} from "@a2a-js/sdk/server";
import { LegacyJsonRpcTransportHandler } from "@a2a-js/sdk/compat/v0_3/server";
import agentCardJson from "../../../.well-known/agent-card.json";
import type { DataClient } from "../data.js";
import { type Reply, respond } from "./agent.js";

/** The published card (bcv.today/.well-known/agent-card.json) is the single source of truth. */
export const AGENT_CARD_V1 = agentCardJson;
const CORE_CARD = AgentCard.fromJSON(agentCardJson);

const LEGACY_VERSION = "0.3";

/**
 * Card for clients that do not send `A2A-Version` (0.3 clients): the 0.3 shape
 * (url, preferredTransport, protocolVersion) with the 1.0 `supportedInterfaces`
 * embedded, exactly what the SDK's own agent-card handler serves by default.
 */
export function compatAgentCard(): Record<string, unknown> {
  const card = agentCardJson;
  const legacy = card.supportedInterfaces.filter((i) => i.protocolVersion === LEGACY_VERSION);
  const primary = legacy[0]!;
  return {
    name: card.name,
    description: card.description,
    version: card.version,
    url: primary.url,
    preferredTransport: primary.protocolBinding,
    protocolVersion: primary.protocolVersion,
    capabilities: { streaming: card.capabilities.streaming, pushNotifications: card.capabilities.pushNotifications },
    defaultInputModes: card.defaultInputModes,
    defaultOutputModes: card.defaultOutputModes,
    skills: card.skills,
    provider: card.provider,
    documentationUrl: card.documentationUrl,
    iconUrl: card.iconUrl,
    supportsAuthenticatedExtendedCard: card.capabilities.extendedAgentCard,
    securitySchemes: {},
    security: [],
    supportedInterfaces: card.supportedInterfaces,
  };
}

/** True when the request asks for an A2A 1.x card/protocol. */
export function wantsV1(request: Request): boolean {
  const v = request.headers.get("A2A-Version") ?? new URL(request.url).searchParams.get("A2A-Version");
  return Boolean(v && !v.trim().startsWith("0."));
}

// ---------------------------------------------------------------- executor

function textPart(text: string): Part {
  return { content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" };
}

function dataPart(value: Record<string, unknown>): Part {
  return { content: { $case: "data", value }, metadata: undefined, filename: "", mediaType: "application/json" };
}

function partsFor(reply: Reply, accepted: string[]): Part[] {
  const acceptsText = accepted.length === 0 || accepted.some((m) => m === "text/plain" || m === "text/*" || m === "*/*");
  const acceptsJson = accepted.length === 0 || accepted.some((m) => m === "application/json" || m === "*/*");
  const parts: Part[] = [];
  if (acceptsText || !acceptsJson) parts.push(textPart(reply.text));
  if (acceptsJson) parts.push(dataPart(reply.data));
  return parts;
}

class BcvAgentExecutor implements AgentExecutor {
  constructor(private readonly data: DataClient) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const msg = ctx.userMessage;
    const texts: string[] = [];
    const datas: unknown[] = [];
    for (const p of msg.parts) {
      if (p.content?.$case === "text") texts.push(p.content.value);
      else if (p.content?.$case === "data") datas.push(p.content.value);
    }
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const langHint = [meta.language, meta.lang, meta.locale].find((v): v is string => typeof v === "string");
    const reply = await respond(this.data, { text: texts.join("\n"), data: datas, langHint });
    const accepted = ctx.request.configuration?.acceptedOutputModes ?? [];
    const parts = partsFor(reply, accepted);
    const now = new Date().toISOString();

    if (reply.kind === "message") {
      // Help, clarification or a rejected request: a direct reply, no task.
      const out: Message = {
        messageId: crypto.randomUUID(),
        contextId: ctx.contextId,
        taskId: "",
        role: Role.ROLE_AGENT,
        parts,
        metadata: { language: reply.lang },
        extensions: [],
        referenceTaskIds: [],
      };
      bus.publish(AgentEvent.message(out));
    } else {
      const statusMessage: Message | undefined =
        reply.kind === "failed"
          ? {
              messageId: crypto.randomUUID(),
              contextId: ctx.contextId,
              taskId: ctx.taskId,
              role: Role.ROLE_AGENT,
              parts,
              metadata: undefined,
              extensions: [],
              referenceTaskIds: [],
            }
          : undefined;
      const task: Task = {
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: reply.kind === "result" ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_FAILED,
          message: statusMessage,
          timestamp: now,
        },
        artifacts:
          reply.kind === "result"
            ? [
                {
                  artifactId: crypto.randomUUID(),
                  name: reply.skill,
                  description: "Official BCV exchange-rate result (text summary + structured JSON).",
                  parts,
                  metadata: { language: reply.lang },
                  extensions: [],
                },
              ]
            : [],
        history: [msg],
        metadata: { skill: reply.skill },
      };
      bus.publish(AgentEvent.task(task));
    }
    bus.finished();
  }

  async cancelTask(): Promise<void> {
    // Tasks complete synchronously; nothing is ever running to cancel.
  }
}

// ---------------------------------------------------------------- JSON-RPC over HTTP

type Json = Record<string, unknown>;

function rpcResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function rpcError(id: unknown, code: number, message: string, status = 200): Response {
  const safeId = typeof id === "string" || typeof id === "number" ? id : null;
  return rpcResponse({ jsonrpc: "2.0", id: safeId, error: { code, message } }, status);
}

/** File parts are not supported (text/plain and application/json only). */
function hasFilePart(body: Json): boolean {
  const parts = ((body.params as Json | undefined)?.message as Json | undefined)?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => {
    if (!p || typeof p !== "object") return false;
    const o = p as Json;
    return "raw" in o || "file" in o || o.kind === "file";
  });
}

export async function handleA2A(request: Request, data: DataClient, maxBodyBytes: number): Promise<Response> {
  if (request.method !== "POST") {
    return rpcError(null, -32600, "Use POST with a JSON-RPC 2.0 body. Agent card: https://mcp.bcv.today/.well-known/agent-card.json", 405);
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > maxBodyBytes) return rpcError(null, -32600, `Request body too large (max ${maxBodyBytes} bytes).`, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) {
    return rpcError(null, -32600, `Request body too large (max ${maxBodyBytes} bytes).`, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Invalid JSON payload");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(null, -32600, "Request payload validation error (batch requests are not supported)");
  }
  const req = body as Json;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    // JSON-RPC 2.0 §5.1: not a valid Request object -> -32600 (the SDK reports -32602).
    return rpcError(req.id, -32600, "Request payload validation error: expected a JSON-RPC 2.0 request with a method.");
  }
  const method = req.method;

  // A2A-Version: absent means 0.3 (spec 3.6.1). As a convenience, a request
  // without the header that uses a 1.0 PascalCase method is treated as 1.0.
  const header = request.headers.get("A2A-Version") ?? new URL(request.url).searchParams.get("A2A-Version") ?? undefined;
  const requestedVersion = header?.trim() || (/^[A-Z]/.test(method) ? "1.0" : LEGACY_VERSION);
  const useLegacy = requestedVersion === LEGACY_VERSION;
  const mapError = useLegacy ? LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError : JsonRpcTransportHandler.mapToJSONRPCError;

  try {
    validateVersion(requestedVersion, CORE_CARD, "JSONRPC");
    if (hasFilePart(req)) {
      throw new ContentTypeNotSupportedError("File parts are not supported: send text/plain or application/json (DataPart).");
    }
    const context = defaultServerCallContextBuilder({
      extensions: undefined,
      user: new UnauthenticatedUser(),
      headers: Object.fromEntries(request.headers),
      requestedVersion,
    });
    const handler = new DefaultRequestHandler(CORE_CARD, new InMemoryTaskStore(), new BcvAgentExecutor(data));
    const transport = useLegacy ? new LegacyJsonRpcTransportHandler(handler) : new JsonRpcTransportHandler(handler);
    const result = await transport.handle(req, context);
    if (result && typeof (result as AsyncGenerator)[Symbol.asyncIterator] === "function") {
      // Streaming is declared unsupported; the SDK raises UnsupportedOperation on the first pull.
      const it = (result as AsyncGenerator<unknown>)[Symbol.asyncIterator]();
      try {
        await it.next();
        await it.return?.(undefined);
        return rpcError(req.id, -32004, "Streaming is not supported by this agent; use SendMessage (message/send).");
      } catch (err) {
        return rpcResponse({ jsonrpc: "2.0", id: req.id ?? null, error: mapError(err) });
      }
    }
    return rpcResponse(result);
  } catch (err) {
    return rpcResponse({ jsonrpc: "2.0", id: typeof req.id === "string" || typeof req.id === "number" ? req.id : null, error: mapError(err) });
  }
}
