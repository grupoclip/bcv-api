import { defineConfig } from "tsup";

export default defineConfig([
  // The library: dual ESM + CommonJS with type declarations, zero dependencies.
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    target: "es2020",
    platform: "neutral",
    sourcemap: false,
    clean: true,
    treeshake: true,
  },
  // The CLI (ESM, Node >= 18). The optional MCP SDK stays external and is only
  // imported by `bcv-today mcp`, from a lazily loaded chunk.
  {
    entry: { cli: "src/bin.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    splitting: true,
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@modelcontextprotocol/sdk"],
  },
]);
