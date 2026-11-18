import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // One browser ESM file, minified, with type declarations and zero dependencies.
  entry: { "bcv-rate": "src/index.ts" },
  format: ["esm"],
  dts: true,
  target: "es2022",
  platform: "browser",
  minify: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: `/*! bcv-today-widget ${version} | Apache-2.0 | https://bcv.today */` },
  esbuildPlugins: [
    {
      // `import css from "./style.css?text"` -> the stylesheet, minified, as a string (the `?text` suffix keeps
      // tsup's own CSS handling, which would emit a separate .css file, out of the way).
      name: "css-text",
      setup(build) {
        build.onResolve({ filter: /\.css\?text$/ }, ({ path, resolveDir }) => ({
          path: join(resolveDir, path),
          namespace: "css-text",
        }));
        build.onLoad({ filter: /.*/, namespace: "css-text" }, async ({ path }) => {
          const { code } = await transform(readFileSync(path.slice(0, -5), "utf8"), { loader: "css", minify: true });
          return { contents: `export default ${JSON.stringify(code.trim())}`, loader: "js" };
        });
      },
    },
  ],
});
