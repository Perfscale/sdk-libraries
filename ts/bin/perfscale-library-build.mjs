#!/usr/bin/env node
// Build a perfscale library entry (TS/JS) into a WASM component.
//
//   perfscale-library-build <entry.ts> -o mylib.wasm [--wit <dir>]
//
// Uses `jco componentize` (ComponentizeJS embeds a JS engine — that is how
// TS becomes a component). The entry's default export must be a
// `defineLibrary({...})` definition; this script generates the thin wrapper
// that adapts it to the `perfscale:library/library` WIT export.
//
// WASI features are disabled to match the perfscale engine's fail-closed
// capability model: `wasi:random` is never provided to guests (draw from
// `ctx.rng()` instead), and `fetch`/timers would trap anyway. StarlingMonkey
// still always imports `wasi:filesystem/*` and `wasi:clocks/wall-clock` (its
// base engine links them unconditionally), so the YAML `libraries:` entry
// needs `capabilities: [fs]` (one `fs` grant also satisfies the wall clock)
// plus `allow_library_capabilities: true` in the config. stdio stays
// enabled — the engine connects wasi:cli/* in sink form.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage(code) {
  console.error(
    "usage: perfscale-library-build <entry.ts|entry.js> -o <out.wasm> [--wit <wit-dir>] [--jco <path-to-jco>]",
  );
  process.exit(code);
}

const argv = process.argv.slice(2);
const positional = [];
let out;
let witDir;
let jcoBin;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") usage(0);
  else if (a === "-o" || a === "--out") out = argv[++i];
  else if (a === "--wit") witDir = argv[++i];
  else if (a === "--jco") jcoBin = argv[++i];
  else if (a.startsWith("-")) {
    console.error(`unknown option: ${a}`);
    usage(1);
  } else positional.push(a);
}
const entry = positional[0];
if (!entry || !out) usage(1);

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "..");

// The SDK module the generated wrapper imports: built dist when present
// (published package), else the TS source (repo checkout; componentize-js
// compiles TS itself).
const sdkEntry = existsSync(path.join(sdkRoot, "dist", "index.js"))
  ? path.join(sdkRoot, "dist", "index.js")
  : path.join(sdkRoot, "src", "index.ts");

witDir ??= path.join(sdkRoot, "wit");
if (!existsSync(path.join(witDir, "library.wit"))) {
  console.error(`error: no library.wit under ${witDir} (run scripts/sync-wit.sh)`);
  process.exit(1);
}

jcoBin ??= path.join(sdkRoot, "node_modules", ".bin", "jco");
if (!existsSync(jcoBin)) jcoBin = "jco"; // fall back to PATH

const entryAbs = path.resolve(entry);
const fallbackName = path.basename(entryAbs).replace(/\.[^.]+$/, "");

const tmp = mkdtempSync(path.join(tmpdir(), "perfscale-library-build-"));
const wrapper = path.join(tmp, `${fallbackName}.component.ts`);
writeFileSync(
  wrapper,
  `import def from ${JSON.stringify(entryAbs)};
import { __exportLibrary } from ${JSON.stringify(sdkEntry)};
export const library = __exportLibrary(def, ${JSON.stringify(fallbackName)});
`,
);

mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const disable = ["random", "clocks", "http", "fetch-event"];
const cmd = [
  "componentize",
  wrapper,
  "--wit",
  witDir,
  "--world-name",
  "perfscale-library",
  "--out",
  path.resolve(out),
  ...disable.flatMap((f) => ["--disable", f]),
];
const res = spawnSync(jcoBin, cmd, { stdio: "inherit" });
if (res.error) {
  console.error(`error: failed to run jco (${jcoBin}): ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
