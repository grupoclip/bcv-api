// Formatting and parsing helpers (imported from the TypeScript source; Node >= 22.18 strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, formatDate, formatNumber, parseAmount, toCurrency, toLang } from "../../src/format.ts";

test("rates: es-VE and en-US with 4 decimals", () => {
  assert.equal(formatNumber(916.6477, "es", 4), "916,6477");
  assert.equal(formatNumber(1007.38665582, "es", 4), "1.007,3867");
  assert.equal(formatNumber(1007.38665582, "en", 4), "1,007.3867");
  assert.equal(formatNumber(18.21021713, "es", 4), "18,2102");
});

test("converted amounts: 2 decimals with grouping", () => {
  assert.equal(formatNumber(100 * 916.6477, "es", 2), "91.664,77");
  assert.equal(formatNumber(100 * 916.6477, "en", 2), "91,664.77");
  assert.equal(formatNumber(1234.5 * 916.6477, "es", 2), "1.131.601,59");
});

test("signed changes", () => {
  assert.equal(formatNumber(0.9001, "es", 4, true), "+0,9001");
  assert.equal(formatNumber(-0.9246, "en", 4, true), "-0.9246");
  assert.equal(formatNumber(0, "es", 2, true), "0,00");
});

test("dates", () => {
  assert.equal(formatDate("2026-11-18", "es"), "18/11/2026");
  assert.equal(formatDate("2026-11-18", "en"), "2026-11-18");
  assert.equal(addDays("2026-11-18", -1), "2026-11-17");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("language and currency attributes", () => {
  assert.equal(toLang("en"), "en");
  assert.equal(toLang("en-US"), "en");
  assert.equal(toLang("EN"), "en");
  assert.equal(toLang("es-VE"), "es");
  assert.equal(toLang("fr"), "es");
  assert.equal(toLang(null), "es");
  assert.equal(toLang("eng"), "es");
  assert.equal(toCurrency("eur"), "EUR");
  assert.equal(toCurrency("RUB"), "RUB");
  assert.equal(toCurrency("GBP"), "USD");
  assert.equal(toCurrency(null), "USD");
});

test("parseAmount: both conventions", () => {
  const cases = [
    ["1.234,5", "es", 1234.5],
    ["1.234,5", "en", 1234.5],
    ["1234.5", "es", 1234.5],
    ["1234.5", "en", 1234.5],
    ["1,234.5", "es", 1234.5],
    ["1234,5", "en", 1234.5],
    ["1.234.567", "es", 1234567],
    ["1,234,567", "en", 1234567],
    ["1.234.567,89", "es", 1234567.89],
    ["1 234,5", "es", 1234.5],
    ["1 234,5", "es", 1234.5],
    ["100", "es", 100],
    [",5", "es", 0.5],
    ["0.125", "es", 0.125],
    ["0,125", "en", 0.125],
    // A single separator grouping three digits follows the page language.
    ["1.234", "es", 1234],
    ["1.234", "en", 1.234],
    ["1,234", "en", 1234],
    ["1,234", "es", 1.234],
    ["12.5", "es", 12.5],
  ];
  for (const [input, lang, expected] of cases) assert.equal(parseAmount(input, lang), expected, `${input} (${lang})`);
});

test("parseAmount: rejects malformed input", () => {
  for (const input of ["", " ", "-5", "abc", "1e3", "12a", ".", ",", "1..2", "1,,2", "$10"]) {
    assert.ok(Number.isNaN(parseAmount(input, "es")), JSON.stringify(input));
  }
});
