// The built bundle (npm test builds it first): size budget, self-contained, safe to import without a DOM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

const BUNDLE = new URL("../../dist/bcv-rate.js", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const code = readFileSync(BUNDLE, "utf8");

test("bundle: at most 6 KB min+gzip", () => {
  const gz = gzipSync(code, { level: 9 }).length;
  assert.ok(gz <= 6 * 1024, `${gz} B gzip`);
});

test("bundle: one self-contained ESM file, no HTML parsing (Trusted Types safe)", () => {
  assert.doesNotMatch(code, /^\s*import\s|\bimport\(|\brequire\(/m);
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(code, /^\/\*! bcv-today-widget \d+\.\d+\.\d+ \| Apache-2\.0/);
  // The stylesheet is inlined (minified), not emitted as a separate file.
  assert.match(code, /--_bg: ?var\(--bcv-bg, ?#fdfbf7\)/);
});

test("bundle: importing without a DOM (SSR, Node) does not throw", async () => {
  const mod = await import(BUNDLE.href);
  assert.equal(mod.VERSION, pkg.version);
  assert.equal(typeof mod.BcvRate, "function");
});

test("package.json: exports, files and side effects", () => {
  assert.equal(pkg.name, "bcv-today-widget");
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.repository.directory, "packages/widget");
  assert.deepEqual(pkg.exports["."], { types: "./dist/bcv-rate.d.ts", default: "./dist/bcv-rate.js" });
  assert.deepEqual(pkg.sideEffects, ["./dist/bcv-rate.js"]);
  assert.ok(pkg.files.includes("dist"));
  assert.equal(pkg.dependencies, undefined, "no runtime dependencies");
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned`);
  }
});
