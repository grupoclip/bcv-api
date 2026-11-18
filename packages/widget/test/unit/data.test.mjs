// Data layer: previous-rate walk, localStorage fallback, shared fetch per API origin.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { findPrevious, load, reset, subscribe } from "../../src/data.ts";

const API = "https://api.test";
// Widget fixtures (rate.json and 2026-11-17/18 day files), then the shared Python fixtures.
const DIRS = [
  new URL("../fixtures/api/v1/", import.meta.url),
  new URL("../../../python/tests/fixtures/", import.meta.url),
];

function fixture(rel) {
  for (const dir of DIRS) {
    const url = new URL(rel, dir);
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  return undefined;
}

/** fetch() serving fixtures; `overrides` maps a path (after /api/v1/) to a body object, a status or a function. */
function installFetch(overrides = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const rel = url.slice(`${API}/api/v1/`.length);
    const o = overrides[rel];
    if (typeof o === "function") return o();
    if (typeof o === "number") return new Response("error", { status: o });
    const body = o ? JSON.stringify(o) : fixture(rel);
    return body === undefined ? new Response("<html>404</html>", { status: 404 }) : new Response(body);
  };
  return calls;
}

class MemoryStorage {
  map = new Map();
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});
afterEach(() => {
  reset();
  globalThis.fetch = realFetch;
  delete globalThis.localStorage;
});

const day = (file) => JSON.parse(fixture(`history/${file}.json`));

test("load: current rates and the previous effective rates", async () => {
  const calls = installFetch();
  const view = await load(API);
  assert.equal(view.rates.USD, 916.6477);
  assert.equal(view.rates.effective_date, "2026-11-18");
  assert.equal(view.previous.effective_date, "2026-11-17");
  assert.equal(view.previous.USD, 915.7476);
  assert.equal(view.cached, undefined);
  assert.deepEqual(calls, [`${API}/api/v1/rate.json`, `${API}/api/v1/history/2026-11-17.json`]);
  // The good value is saved for offline use.
  const saved = JSON.parse(localStorage.getItem(`bcv-today-widget:${API}`));
  assert.equal(saved.rates.USD, 916.6477);
  assert.equal(saved.previous.USD, 915.7476);
});

test("findPrevious: walks back over missing days and carried-forward weekends", async () => {
  // 2026-01-06 (Tuesday): 2026-01-05 has no file, 2026-01-04 (Sunday) still carries 2026-01-03.
  const calls = installFetch();
  const prev = await findPrevious(API, day("2026-01-06"));
  assert.equal(prev.effective_date, "2026-01-03");
  assert.equal(prev.USD, 304.6796);
  assert.equal(calls.length, 2);
});

test("findPrevious: skips day files that still carry the same effective date", async () => {
  // A rate published ahead (effective 2026-01-05) whose 2026-01-04 day file already carries it.
  const calls = installFetch({ "history/2026-01-04.json": { USD: 310, effective_date: "2026-01-05" } });
  const prev = await findPrevious(API, { USD: 310, effective_date: "2026-01-05" });
  assert.equal(prev.effective_date, "2026-01-03");
  assert.equal(calls.length, 2);
});

test("findPrevious: gives up after 5 days", async () => {
  const calls = installFetch();
  assert.equal(await findPrevious(API, { USD: 1, effective_date: "2030-01-10" }), undefined);
  assert.equal(calls.length, 5);
  assert.ok(calls.at(-1).endsWith("/history/2030-01-05.json"));
});

test("load: API error falls back to the cached copy, marked as cached", async () => {
  installFetch();
  await load(API);
  installFetch({ "rate.json": 500 });
  const view = await load(API);
  assert.equal(view.cached, true);
  assert.equal(view.rates.USD, 916.6477);
  assert.equal(view.previous.USD, 915.7476);
});

test("load: network error and invalid JSON also fall back; nothing cached throws", async () => {
  installFetch({
    "rate.json": () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(load(API), /Failed to fetch/);
  installFetch({ "rate.json": { hello: "world" } });
  await assert.rejects(load(API), /bad data/);
  localStorage.setItem(`bcv-today-widget:${API}`, JSON.stringify({ rates: day("2026-11-18") }));
  const view = await load(API);
  assert.equal(view.cached, true);
  assert.equal(view.previous, undefined);
});

test("load: blocked or corrupt storage never breaks the widget", async () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  installFetch();
  assert.equal((await load(API)).rates.USD, 916.6477);
  installFetch({ "rate.json": 500 });
  await assert.rejects(load(API));
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem(`bcv-today-widget:${API}`, "{not json");
  await assert.rejects(load(API));
});

test("load: a refresh with the same effective date reuses the previous rates (one request)", async () => {
  installFetch();
  const first = await load(API);
  const calls = installFetch();
  const second = await load(API, first);
  assert.deepEqual(calls, [`${API}/api/v1/rate.json`]);
  assert.equal(second.previous.USD, 915.7476);
});

test("subscribe: many elements, one fetch", async () => {
  const calls = installFetch();
  const seen = [];
  let resolveAll;
  const done = new Promise((r) => {
    resolveAll = r;
  });
  const unsubs = [];
  for (let i = 0; i < 5; i++) {
    unsubs.push(
      subscribe(API, (store) => {
        seen.push(store.view.rates.USD);
        if (seen.length === 5) resolveAll();
      }),
    );
  }
  await done;
  assert.deepEqual(seen, [916.6477, 916.6477, 916.6477, 916.6477, 916.6477]);
  assert.equal(calls.filter((u) => u.endsWith("rate.json")).length, 1);
  // A late subscriber gets the known data immediately, without a new request.
  let late;
  unsubs.push(
    subscribe(API, (s) => {
      late = s.view.rates.USD;
    }),
  );
  assert.equal(late, 916.6477);
  assert.equal(calls.filter((u) => u.endsWith("rate.json")).length, 1);
  for (const u of unsubs) u();
});

test("subscribe: error state when the API fails and nothing is cached", async () => {
  installFetch({ "rate.json": 503 });
  const store = await new Promise((resolve) => {
    const off = subscribe(API, (s) => {
      off();
      resolve(s);
    });
  });
  assert.equal(store.error, true);
  assert.equal(store.view, undefined);
});
