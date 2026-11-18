// Print the bundle size (raw, gzip, brotli) and fail above the 6 KB min+gzip budget.
import { readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

export const BUDGET = 6 * 1024;
const code = readFileSync(new URL("../dist/bcv-rate.js", import.meta.url));
const gz = gzipSync(code, { level: 9 }).length;
const br = brotliCompressSync(code).length;
console.log(`dist/bcv-rate.js: ${code.length} B min, ${gz} B min+gzip, ${br} B min+brotli (budget ${BUDGET} B gzip)`);
if (gz > BUDGET) {
  console.error("over budget");
  process.exit(1);
}
