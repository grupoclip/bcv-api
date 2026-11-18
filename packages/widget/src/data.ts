// Data layer: one shared fetch per API origin for every <bcv-rate> on the page, a 30-minute refresh while
// the page is visible, and a localStorage copy of the last good value for when the API is unreachable.
import { addDays } from "./format.ts";

export const DEFAULT_API = "https://bcv.today";
/** Refresh period while the page is visible. */
export const REFRESH_MS = 30 * 60e3;
/** After a failed refresh, try again sooner. */
export const RETRY_MS = 2 * 60e3;
/** How many day files to walk back looking for the previous effective rate. */
export const MAX_WALK = 5;

/** The fields of /api/v1/rate.json (and of a history day file) that the widget uses. */
export interface Rates {
  USD: number;
  EUR?: number;
  CNY?: number;
  TRY?: number;
  RUB?: number;
  effective_date: string;
  date?: string;
  updated_at?: string;
}

/** What an element renders: current rates, the previous effective rates (if found), and whether it is a cached copy. */
export interface View {
  rates: Rates;
  previous?: Rates;
  cached?: boolean;
}

export interface Store {
  view?: View;
  /** Set when there is nothing to show (API failed and nothing cached). */
  error?: boolean;
  /** Time of the last attempt (ms); 0 = never. */
  at: number;
  busy?: Promise<void>;
  subs: Set<(store: Store) => void>;
  timer?: ReturnType<typeof setInterval>;
}

const stores = new Map<string, Store>();

function valid(json: unknown): json is Rates {
  const r = json as Rates;
  return !!r && typeof r.USD === "number" && /^\d{4}-\d\d-\d\d$/.test(r.effective_date);
}

async function getJson(url: string): Promise<Rates> {
  const res = await fetch(url, {
    cache: "no-cache",
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15e3) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!valid(json)) throw new Error("bad data");
  return json;
}

const storageKey = (api: string) => `bcv-today-widget:${api}`;

function readCache(api: string): View | undefined {
  try {
    const view = JSON.parse(localStorage.getItem(storageKey(api)) ?? "null") as View | null;
    if (view && valid(view.rates)) return { rates: view.rates, previous: view.previous, cached: true };
  } catch {
    // Storage blocked (privacy mode, sandboxed iframe) or corrupt: no cache.
  }
  return undefined;
}

function writeCache(api: string, view: View): void {
  try {
    localStorage.setItem(storageKey(api), JSON.stringify({ rates: view.rates, previous: view.previous }));
  } catch {
    // Quota or blocked storage: the widget still works, just without an offline copy.
  }
}

/**
 * The previous effective rates: walk the day files back from effective_date - 1 (up to MAX_WALK days)
 * until one has a different effective_date. Missing days are skipped; failures give `undefined`.
 */
export async function findPrevious(api: string, rates: Rates): Promise<Rates | undefined> {
  for (let i = 1; i <= MAX_WALK; i++) {
    try {
      const day = await getJson(`${api}/api/v1/history/${addDays(rates.effective_date, -i)}.json`);
      if (day.effective_date !== rates.effective_date) return day;
    } catch {
      // No file for that day (before the series, or not generated): keep walking.
    }
  }
  return undefined;
}

/** Fetch the current rates and the previous effective rates; on failure fall back to the cached copy. */
export async function load(api: string, last?: View): Promise<View> {
  try {
    const rates = await getJson(`${api}/api/v1/rate.json`);
    // Reuse the previous rates already known for the same effective date (refreshes cost one request).
    const previous =
      last && last.rates.effective_date === rates.effective_date && last.previous
        ? last.previous
        : await findPrevious(api, rates);
    const view: View = { rates, previous };
    writeCache(api, view);
    return view;
  } catch (err) {
    const fallback = last ? { ...last, cached: true } : readCache(api);
    if (fallback) return fallback;
    throw err;
  }
}

function check(api: string, store: Store): void {
  const visible = typeof document === "undefined" || !document.hidden;
  if (store.busy || !(store.at === 0 || visible) || Date.now() - store.at < REFRESH_MS) return;
  store.at = Date.now();
  store.busy = load(api, store.view)
    .then(
      (view) => {
        store.view = view;
        store.error = false;
        // A cached result means the API failed: retry sooner than the normal period.
        if (view.cached) store.at = Date.now() - REFRESH_MS + RETRY_MS;
      },
      () => {
        store.error = true;
        store.at = Date.now() - REFRESH_MS + RETRY_MS;
      },
    )
    .finally(() => {
      store.busy = undefined;
      for (const fn of store.subs) fn(store);
    });
}

let listening = false;

/**
 * Subscribe a listener to the data for `api`. The listener is called immediately when data is already
 * known and after every load. Returns the unsubscribe function.
 */
export function subscribe(api: string, fn: (store: Store) => void): () => void {
  let store = stores.get(api);
  if (!store) {
    store = { at: 0, subs: new Set() };
    stores.set(api, store);
  }
  const s = store;
  s.subs.add(fn);
  if (s.view || s.error) fn(s);
  s.timer ??= setInterval(() => check(api, s), 60e3);
  if (!listening && typeof document !== "undefined") {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      for (const [key, st] of stores) if (st.subs.size) check(key, st);
    });
  }
  check(api, s);
  return () => {
    s.subs.delete(fn);
    if (!s.subs.size) {
      clearInterval(s.timer);
      s.timer = undefined;
    }
  };
}

/** Test helper: forget every store. */
export function reset(): void {
  for (const s of stores.values()) clearInterval(s.timer);
  stores.clear();
}
