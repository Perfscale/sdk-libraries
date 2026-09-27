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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/// Find jco's bin by walking up from this file: jco is a runtime dependency
/// of this package, so it lives in some `node_modules/@bytecodealliance/jco`
/// above us — nested under the package, hoisted to the consumer's root, or
/// beside us in a global install. (require.resolve is unusable here: jco's
/// exports map does not expose its package.json.)
function resolveJcoBin() {
  let dir = here;
  for (;;) {
    const pkgDir = path.join(dir, "node_modules", "@bytecodealliance", "jco");
    const pkgJson = path.join(pkgDir, "package.json");
    if (existsSync(pkgJson)) {
      const binRel = JSON.parse(readFileSync(pkgJson, "utf8")).bin.jco;
      return path.join(pkgDir, binRel);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

jcoBin ??= resolveJcoBin();
if (!jcoBin) {
  console.error(
    "error: @bytecodealliance/jco not found next to this package — reinstall @perfscale/library-sdk (jco is a bundled dependency)",
  );
  process.exit(1);
}

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
// Run jco through the current node binary: no reliance on the npm bin shim,
// the shebang, or an executable bit.
const res = spawnSync(process.execPath, [jcoBin, ...cmd], { stdio: "inherit" });
if (res.error) {
  console.error(`error: failed to run jco (${jcoBin}): ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
