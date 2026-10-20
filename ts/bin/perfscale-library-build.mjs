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
// base engine links them unconditionally), but those are toolchain noise: the
// SDK reports `"pure": true` in `info()` (no fs/clock APIs are exposed to
// authors), so engines honoring the pure marker waive the `capabilities:
// [fs]` grant — provide no preopens. Engines older than the pure-marker
// release still require `capabilities: [fs]` plus
// `allow_library_capabilities: true` (fail-closed). stdio stays enabled —
// the engine connects wasi:cli/* in sink form.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage(code) {
  console.error(
    "usage: perfscale-library-build <entry.ts|entry.js> -o <out.wasm> [--kind library|reporter] [--wit <wit-dir>] [--jco <path-to-jco>]",
  );
  process.exit(code);
}

const argv = process.argv.slice(2);
const positional = [];
let out;
let witDir;
let jcoBin;
let kind = "library";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") usage(0);
  else if (a === "-o" || a === "--out") out = argv[++i];
  else if (a === "--wit") witDir = argv[++i];
  else if (a === "--jco") jcoBin = argv[++i];
  else if (a === "--kind") kind = argv[++i];
  else if (a.startsWith("-")) {
    console.error(`unknown option: ${a}`);
    usage(1);
  } else positional.push(a);
}
const entry = positional[0];
if (!entry || !out) usage(1);
if (kind !== "library" && kind !== "reporter") {
  console.error(`error: --kind must be 'library' or 'reporter', got '${kind}'`);
  usage(1);
}
// Reporters implement `perfscale:reporter@0.1.0` (wit/reporter/reporter.wit):
// a single `on-report(report-json, config-json)` export plus the host import
// `emit-file`. Everything else (jco componentize, disabled WASI features) is
// identical to the library build.
const worldName = kind === "reporter" ? "perfscale-reporter" : "perfscale-library";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "..");

// The SDK module the generated wrapper imports: built dist when present
// (published package), else the TS source (repo checkout; componentize-js
// compiles TS itself).
const sdkEntry = existsSync(path.join(sdkRoot, "dist", "index.js"))
  ? path.join(sdkRoot, "dist", "index.js")
  : path.join(sdkRoot, "src", "index.ts");

witDir ??= path.join(sdkRoot, kind === "reporter" ? "wit/reporter" : "wit");
const witFile = kind === "reporter" ? "reporter.wit" : "library.wit";
const witPath = path.join(witDir, witFile);
if (!existsSync(witPath)) {
  console.error(`error: no ${witFile} under ${witDir} (run scripts/sync-wit.sh)`);
  process.exit(1);
}

// Reporter wrappers import the host's `emit-file` as
// `perfscale:reporter/host@<version>` — componentize-js exposes world
// imports as builtin modules under their fully-versioned WIT id, so the
// version must come from the WIT package line.
function witPackageVersion(file) {
  const m = readFileSync(file, "utf8").match(/^package\s+\S+@([^;]+);/m);
  return m?.[1] ?? null;
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
let wrapperSource;
let bundleConfigPath;
if (kind === "reporter") {
  const version = witPackageVersion(witPath);
  if (!version) {
    console.error(`error: could not parse the package version from ${witPath}`);
    process.exit(1);
  }
  wrapperSource = `import def from ${JSON.stringify(entryAbs)};
import { __exportReporter } from ${JSON.stringify(sdkEntry)};
import { emitFile } from "perfscale:reporter/host@${version}";
export const reporter = __exportReporter(def, emitFile);
`;
  // The `perfscale:reporter/host@…` import is a component builtin, not a
  // file: keep it external when rolldown bundles the TS sources.
  bundleConfigPath = path.join(tmp, "bundle.config.mjs");
  writeFileSync(bundleConfigPath, `export default { external: [/^perfscale:/] };\n`);
} else {
  wrapperSource = `import def from ${JSON.stringify(entryAbs)};
import { __exportLibrary } from ${JSON.stringify(sdkEntry)};
export const library = __exportLibrary(def, ${JSON.stringify(fallbackName)});
`;
}
writeFileSync(wrapper, wrapperSource);

mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const disable = ["random", "clocks", "http", "fetch-event"];
const cmd = [
  "componentize",
  wrapper,
  "--wit",
  witDir,
  "--world-name",
  worldName,
  ...(bundleConfigPath ? ["--bundle-config", bundleConfigPath] : []),
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
