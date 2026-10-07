/**
 * Public site build. Copies ONLY public-facing files into dist/.
 * The market-truth engine (src/) is never copied — it is compiled separately to build/engine.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const PUBLIC_ENTRIES = [
  ["index.html", "index.html"],
  ["styles", "styles"],
  ["js", "js"],
  ["public", "."], // public/* is served from the site root
];
for (const [from, to] of PUBLIC_ENTRIES) {
  const src = join(ROOT, from);
  if (!existsSync(src)) throw new Error(`build: missing ${from}`);
  cpSync(src, join(DIST, to), { recursive: true });
}
console.log("Built public site -> dist/");
