# @perfscale/library-sdk

TypeScript/JavaScript SDK for authoring **perfscale libraries** — WASM
components that provide value-generating functions to `${alias.fn(...)}`
tokens in [perfscale](https://github.com/Perfscale/perfscale) test payloads
(RFC 005):

```yaml
libraries:
  - use: ./hello.wasm
    capabilities: []   # explicit no-grants declaration; required by perfscale ≥ the upcoming release (pure component needs no grants)
steps:
  - use: std/file-write@v1
    with:
      path: out.txt
      content: "greeting: ${hello.greet(world)}"   # → "greeting: hello, world!"
```

The engine runs each library in a wasmtime sandbox under a fail-closed
capability model; the ABI contract (`perfscale:library@0.2.0`) is
[`wit/library.wit`](wit/library.wit), mirrored from the main repo's single
source of truth.

The same package authors **WASM end-of-run reporters** (issue #9) — components
that receive the canonical `report@v1` document once per run and write output
files through the host's `emit-file` (no WASI fs/net). The reporter ABI
(`perfscale:reporter@0.1.0`) is [`wit/reporter/reporter.wit`](wit/reporter/reporter.wit).
See [Reporters](#reporters).

## Quickstart

```console
$ npm install @perfscale/library-sdk
```

Write a library (`mylib.ts`):

```ts
import { args, defineLibrary } from "@perfscale/library-sdk";

export default defineLibrary({
  name: "mylib",
  functions: {
    token: {
      description: "Deterministic per-instance token; memo key reuses it within one message",
      call(argv, ctx) {
        const mint = () => `tok-${ctx.rng().nextU64().toString(16)}`;
        const key = args.optionalString(argv, 0);
        return key === undefined ? mint() : ctx.memo(key, mint);
      },
    },
  },
});
```

Build it to a WASM component with the bundled CLI (ComponentizeJS embeds a JS
engine — that is how TS becomes a component):

```console
$ npx perfscale-library-build mylib.ts -o mylib.wasm
```

Reference the component from your perfscale YAML (path relative to the
declaring file) and call it from `${...}` tokens in payloads.

## What the SDK gives you

- **`defineLibrary`** — declares the library name and its functions; the
  default export is what the build wires to the `perfscale:library` ABI.
- **`Ctx`** — per-call context (`messageSeq`, `iterationSeq`, `vuId`,
  `seed`, `timeMs` as `bigint`), `ctx.settings` — the run's frozen settings
  snapshot (WIT 0.2 `settings-json`: `vus`/`duration_ms` or
  `stages`/`arrival`, `seed`, `variables` with env resolved),
  `ctx.memo(key, fn)` (keyed reuse within one
  message), and `ctx.rng()` — a seeded xorshift64 PRNG **bit-identical to the
  Rust SDK and the engine's built-in generator**, so `seed:` runs reproduce.
- **Args helpers** (`args.string/int/float/optionalString`) with
  author-friendly errors.
- **`testCall`** — a runtime-free harness for `node:test` unit tests; no WASM
  needed:

  ```ts
  import assert from "node:assert/strict";
  import { Ctx, testCall } from "@perfscale/library-sdk";
  import lib from "./mylib.ts";

  const ctx = new Ctx(42);
  assert.equal(testCall(lib, ctx, "token", []), testCall(lib, ctx, "token", []));
  ```

A complete runnable example lives in
[`examples/hello`](examples/hello) (library, perfscale YAML, expected output).

## Sandboxing notes for TS authors

- jco (StarlingMonkey) components always import `wasi:filesystem/*` and
  `wasi:clocks/wall-clock`, but that is toolchain noise: the SDK reports
  `"pure": true` in `info()` (it exposes no fs/clock APIs to authors), so
  engines honoring the pure marker waive the capability requirement and
  provide no preopens — declare `capabilities: []` (explicit no-grants key,
  required by perfscale ≥ the upcoming release) and nothing more. On engines
  older
  than the pure-marker release the grant is still required
  (`capabilities: [fs]` on the `libraries:` entry, one `fs` grant satisfies
  both imports, plus `allow_library_capabilities: true` in the config) —
  old engines fail closed. The build already disables `wasi:random`,
  `wasi:http` and timers, which the engine never grants — draw all
  randomness from `ctx.rng()` and all time from `ctx.timeMs`.
- The WIT contract is vendored at `wit/library.wit`;
  `scripts/sync-wit.sh` re-fetches it pinned to a perfscale release tag
  (bump `PERFSCALE_TAG` deliberately).

## Requirements

Node.js ≥ 24 (the test harness relies on native type stripping). The build
CLI wraps [`@bytecodealliance/jco`](https://www.npmjs.com/package/@bytecodealliance/jco)
and needs no other toolchain.

## License

Dual-licensed under [MIT](../LICENSE-MIT) or
[Apache-2.0](../LICENSE-APACHE), same as the main perfscale repo.

## Reporters

A reporter is a component implementing `perfscale:reporter@0.1.0`: the engine
calls `onReport` once at end of run with the parsed `report@v1` document and
the reporter's `with.config` block; output goes through `emit(name, contents)`
into the reporter's output directory (`with.output`, path traversal refused).

```ts
import { defineReporter } from "@perfscale/library-sdk";

export default defineReporter({
  name: "summary",
  onReport(report, config, emit) {
    emit("summary.txt", `run ${report.run.run_id}: ${(report.steps ?? []).length} step(s)\n`);
    return "summary.txt written";
  },
});
```

Build and use:

```console
$ npx perfscale-library-build --kind reporter summary.ts -o summary.wasm
```

```yaml
report:
  reporters:
    - use: wasm:./summary.wasm   # path relative to the declaring file
      with:
        output: ./reports        # default ./perfscale-report-<module-stem>
        config: { style: short } # handed to onReport verbatim
```

Guest errors (a throw inside `onReport`) are reported as the `err` variant of
the WIT `result` — the engine logs and counts them (`engine_report_errors`)
and the run's exit code is never affected. Unit-test reporters without a WASM
runtime via `testReport(def, report, config)`; the `report@v1` document is
typed as `ReportV1` ([`src/report.ts`](src/report.ts), a hand-written mirror of
the engine's `report/v1.rs`). A runnable example lives in
[`examples/summary`](examples/summary) (`npm run example:build:reporter`).
