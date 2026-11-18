// HTTP access to the static JSON API (https://bcv.today/api/v1/) with a small
// in-memory TTL cache. Uses the global fetch (Node >= 18, Deno, Bun, browsers,
// Cloudflare Workers). Shared by the npm client and the MCP/A2A Worker, so both
// map network failures, HTTP errors and invalid JSON to the same errors.
import { NotFound, UpstreamError } from "./errors.js";
import {
  type DataSource,
  dayPath,
  HISTORY_PATH,
  LATEST_PATH,
  type RateEntry,
  STATUS_PATH,
  type StatusDoc,
} from "./rules.js";

export const DEFAULT_BASE_URL = "https://bcv.today";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Tiny in-memory cache with a per-entry deadline; cleared when it grows past 64 keys. */
export class TTLCache {
  static readonly MAX_ENTRIES = 64;
  private readonly data = new Map<string, { expires: number; value: unknown }>();

  constructor(
    readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const hit = this.data.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.clock()) {
      this.data.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown): void {
    if (this.ttlMs <= 0) return;
    if (this.data.size >= TTLCache.MAX_ENTRIES) this.data.clear();
    this.data.set(key, { expires: this.clock() + this.ttlMs, value });
  }

  clear(): void {
    this.data.clear();
  }
}

export interface ApiOptions {
  /** API origin, default https://bcv.today. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (0 disables it). */
  timeoutMs?: number;
  /** Cache of parsed responses; share one to cache across instances. */
  cache?: TTLCache;
  /** fetch implementation; defaults to the global fetch. */
  fetch?: FetchLike;
  /** User-Agent header, sent only where the runtime allows it (not in browsers). */
  userAgent?: string;
  /** Extra fetch init merged into every request (e.g. Cloudflare `cf` options). */
  init?: Record<string, unknown>;
}

/**
 * True in browsers and browser workers (their User-Agent always starts with
 * "Mozilla/"). There the header must not be set: browsers ignore it or turn the
 * request into a CORS preflight. Node, Deno, Bun and Cloudflare Workers allow it.
 */
function isBrowserLike(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: unknown } }).navigator;
  return typeof nav?.userAgent === "string" && nav.userAgent.startsWith("Mozilla/");
}

/** Reads the static JSON API; implements `DataSource`. */
export class Api implements DataSource {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly cache: TTLCache;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly headersBase: Record<string, string>;
  private readonly init: Record<string, unknown>;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: ApiOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cache = opts.cache ?? new TTLCache(300_000);
    this.fetchImpl = opts.fetch;
    this.headersBase = opts.userAgent && !isBrowserLike() ? { "user-agent": opts.userAgent } : {};
    this.init = opts.init ?? {};
  }

  private async request(path: string, accept: string): Promise<string> {
    const url = this.baseUrl + path;
    const doFetch: FetchLike | undefined = this.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    if (!doFetch) {
      throw new UpstreamError("No fetch implementation available: pass { fetch } to the client.");
    }
    const init: Record<string, unknown> = { ...this.init, headers: { accept, ...this.headersBase } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    if (this.timeoutMs > 0 && typeof AbortController === "function") {
      controller = new AbortController();
      init.signal = controller.signal;
      timer = setTimeout(() => controller?.abort(), this.timeoutMs);
    }
    try {
      let res: Response;
      try {
        res = await doFetch(url, init as RequestInit);
      } catch (err) {
        const reason = controller?.signal.aborted ? `timed out after ${this.timeoutMs} ms` : errorText(err);
        throw new UpstreamError(
          `Could not reach the BCV Today data API (${reason}). Try again in a moment.`,
          undefined,
          {
            cause: err,
          },
        );
      }
      if (res.status === 404) {
        await discard(res);
        throw new NotFound(`Not found: ${path}`);
      }
      if (!res.ok) {
        await discard(res);
        throw new UpstreamError(
          `The BCV Today data API answered HTTP ${res.status} for ${path}. Try again in a moment.`,
          res.status,
        );
      }
      try {
        return await res.text();
      } catch (err) {
        const reason = controller?.signal.aborted ? `timed out after ${this.timeoutMs} ms` : errorText(err);
        throw new UpstreamError(
          `Could not reach the BCV Today data API (${reason}). Try again in a moment.`,
          undefined,
          {
            cause: err,
          },
        );
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Memoised fetch: one network request per key while it is cached or in flight. */
  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = load().then(
      (value) => {
        this.inflight.delete(key);
        this.cache.set(key, value);
        return value;
      },
      (err: unknown) => {
        this.inflight.delete(key);
        throw err;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  /** Raw text of any path on the origin (e.g. "/llms.txt"). */
  text(path: string, accept = "text/plain"): Promise<string> {
    return this.memo(`${accept} ${path}`, () => this.request(path, accept));
  }

  /** Parsed JSON of a path; errors are never cached. */
  json<T = unknown>(path: string): Promise<T> {
    return this.memo(`json ${path}`, async () => {
      const text = await this.request(path, "application/json");
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new UpstreamError(`The BCV Today data API returned invalid JSON for ${path}.`);
      }
    });
  }

  latest(): Promise<RateEntry> {
    return this.json<RateEntry>(LATEST_PATH);
  }

  status(): Promise<StatusDoc> {
    return this.json<StatusDoc>(STATUS_PATH);
  }

  async history(): Promise<RateEntry[]> {
    const data = await this.json<unknown>(HISTORY_PATH);
    if (!Array.isArray(data)) {
      throw new UpstreamError("Unexpected history.json shape (expected an array).");
    }
    return data as RateEntry[];
  }

  /** Snapshot for one calendar day; rejects with NotFound when out of range. */
  day(date: string): Promise<RateEntry> {
    return this.json<RateEntry>(dayPath(date));
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}
