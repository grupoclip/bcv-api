// Read-only access to the static BCV Today JSON API (https://bcv.today/api/v1).
// Never calls bcv.org.ve. Responses are cached at the Cloudflare edge
// (cf.cacheTtl) and memoised per isolate, so repeated tool calls cost neither
// subrequests nor JSON parsing CPU.
//
// The HTTP client, error mapping and business rules live in the npm package
// source (js/src, published as `bcv-today`) so the Worker and the package
// cannot diverge; this module only adds the Worker-specific configuration.
import { Api, TTLCache } from "../../js/src/api.js";

export { NotFound as NotFoundError, UpstreamError } from "../../js/src/errors.js";
export {
  CURRENCIES,
  type Currency,
  EARLIEST_SNAPSHOT,
  type RateEntry,
  type StatusDoc,
  addDays,
  isIsoDate,
  rateOf,
  ratesOf,
  todayCaracas,
  weekday,
} from "../../js/src/rules.js";

const CACHE_TTL_SECONDS = 300;
/** Per-isolate memo shared by every request (one DataClient is built per request). */
const memo = new TTLCache(CACHE_TTL_SECONDS * 1000);

export class DataClient extends Api {
  constructor(origin: string) {
    super({
      baseUrl: origin,
      timeoutMs: 0,
      cache: memo,
      userAgent: "bcv-today-mcp/1.0 (+https://mcp.bcv.today)",
      init: { cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true } },
    });
  }

  /** Raw documentation file (llms.txt, openapi.json) for MCP resources. */
  doc(path: string, accept = "text/plain"): Promise<string> {
    return this.text(path, accept);
  }
}
