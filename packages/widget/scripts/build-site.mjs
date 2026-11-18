// Copy the minified bundle to the website, served as https://bcv.today/widget/v1.js.
// v1 is the stable URL: only backward-compatible 0.x/1.x releases are copied over it.
import { copyFileSync, mkdirSync } from "node:fs";

const from = new URL("../dist/bcv-rate.js", import.meta.url);
const dir = new URL("../../../site/widget/", import.meta.url);
mkdirSync(dir, { recursive: true });
copyFileSync(from, new URL("v1.js", dir));
console.log("site/widget/v1.js updated");
