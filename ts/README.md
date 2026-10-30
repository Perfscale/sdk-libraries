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
capability model; the ABI contract (`perfscale:library@0.3.0`) is
[`wit/library.wit`](wit/library.wit), mirrored from the main repo's single
source of truth.

The same package authors **WASM end-of-run reporters** (issue #9) — components
that receive the canonical `report@v1` document once per run and write output
files through the host's `emit-file` (no WASI fs/net). The reporter ABI
(`perfscale:reporter@0.1.0`) is [`wit/reporter/reporter.wit`](wit/reporter/reporter.wit).
See [Reporters](#reporters).

It also authors **custom steps** (RFC 009) — components whose steps run as
test actions via `use: lib/<alias>/<step>` and return an `ActionOutput`
(outputs, logs, metrics, an HTTP sample). The step ABI
(`perfscale:step@0.1.0`) is [`wit/step/step.wit`](wit/step/step.wit).
See [Steps](#steps-rfc-009).

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
  snapshot (`vus`/`duration_ms` or `stages`/`arrival`, `seed`, `variables`
  with env resolved — WIT 0.2 `settings-json`) plus `extensions` — validated
  config-extension blocks keyed by each library's `configSchema.key`
  (WIT 0.3, see [Config extensions](#config-extensions-issue-10)),
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

## Config extensions (issue #10)

A library can claim one top-level `config.yaml` key with a JSON Schema —
the engine validates the user's block at lint/run start and hands it to the
guest via `ctx.settings.extensions[key]`:

```ts
import { defineLibrary } from "@perfscale/library-sdk";

export default defineLibrary({
  name: "configlib",
  configSchema: {
    key: "configlib",
    schema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        pool_size: { type: "integer", minimum: 1 },
      },
      required: ["endpoint"],
      additionalProperties: false,
    },
  },
  functions: {
    endpoint: {
      description: "The configured endpoint (from the configlib: config block)",
      call(_argv, ctx) {
        const block = (ctx.settings.extensions ?? {})["configlib"] as
          | { endpoint?: string; pool_size?: number }
          | undefined;
        return block?.endpoint ?? "https://localhost";
      },
    },
  },
});
```

The `config-schema` export serializes that declaration as this JSON string:

```json
{
  "key": "configlib",
  "schema": {
    "type": "object",
    "properties": {
      "endpoint": { "type": "string" },
      "pool_size": { "type": "integer", "minimum": 1 }
    },
    "required": ["endpoint"],
    "additionalProperties": false
  }
}
```

```yaml
libraries:
  - use: ./configlib.wasm
    capabilities: []
configlib:                  # validated against the schema above
  endpoint: https://api.test
  pool_size: 16
```

The extension block is optional; when omitted, `extensions` has no
`configlib` entry. When present, it is validated at lint/run start — here
`endpoint` is required, `pool_size` must be at least 1, and unknown fields
are rejected. The key must match `[a-z][a-z0-9_]*` and must not collide with
a built-in config key or another loaded library's claim.

`perfscale-library-build` builds against the `perfscale-library-config`
world automatically when the entry declares `configSchema` (WIT 0.3.0).
Example: [`examples/configlib`](examples/configlib)
(`npm run example:build:configlib`).

## Steps (RFC 009)

A step component is a library whose manifest also lists **steps** — actions
dispatched from a test's `use:` slot as `lib/<alias>/<step>`, alongside the
built-in `std/*` actions. Define one with `defineSteps` (a superset of
`defineLibrary`: `functions` may be omitted for a steps-only component, or
kept for a combined one):

```ts
import { defineSteps } from "@perfscale/library-sdk";

export default defineSteps({
  name: "echo",
  steps: {
    echo: {
      description: "Echo the `message` param into outputs and the log",
      run(params, ctx) {
        const message = String(params.message ?? "");
        return {
          output: { message },                              // → the step's `outputs:`
          logs: [{ tag: "out", line: `${ctx.stepName}: ${message}` }],
          metrics: { echo_len: message.length },            // custom series, [a-z0-9_]
        };
      },
    },
  },
});
```

The step's `run(params, ctx)` receives the `with:` block (`${{ }}`
interpolation already applied by the engine) and a `StepCtx` —
`iterationSeq`/`vuId`/`timeMs` as `bigint` (0 for one-shot `before:`/`after:`
steps), `stepName`, and the run's frozen `settings`. The returned
`StepResult` serializes to the RFC 008 `ActionOutput`: `success` (default
`true`), `output` (stored under the name given by the step's `outputs:` for
later `${{ <name>.<field> }}` references and inline `check:` assertions),
`logs`, `metrics` (number or `[ms, …]` series), `httpSample`, and
`secretOutputPaths` (output keys the engine log-masks). Throw to fail the
step — the error message becomes the failure cause.

Build and use:

```console
$ npx perfscale-library-build --kind steps echo.ts -o echo.wasm
```

The config file carries the profile, gates, libraries and one-shot `before:`
setup:

```yaml
# config.yaml
vus: 1
duration: 10s
libraries:
  - use: ./echo.wasm
    capabilities: []
before:
  - name: setup
    use: lib/echo/echo          # one-shot: vu/iteration = 0
    with: { message: "starting" }
    outputs: setup              # → ${{ config.setup.message }} in test steps
```

The test file carries the `steps:`; `outputs` is the variable name the step
output is stored under, and inline `check` is an assertion map over it:

```yaml
# test.yaml
steps:
  - name: say
    use: lib/echo/echo
    with: { message: "hello from vu ${{ __vu__ }}" }
    outputs: said
    check:
      message_contains: hello
```

### The `process` capability (double opt-in)

Steps can spawn host processes through `ctx.exec(request)` — a bounded,
host-mediated spawn (no shell, replacement environment, host-capped timeout,
captured stdout/stderr). This is a capability the run must grant **twice**:
the component declares `capabilities: [process]` AND the run config sets
`allow_process_actions: true` (plus the `allow_library_capabilities: true`
gate every non-empty grant needs). Build such components with `--process`,
which selects the `perfscale-steps-exec` world whose `host-exec` import the
host only connects when the grant is present — otherwise the component fails
to even load (fail-closed, like `net`):

```console
$ npx perfscale-library-build --kind steps --process exec.ts -o exec.wasm
```

`ctx.exec` is only ever the bound WIT host function — Node's
`child_process` does not exist inside the component; the runtime-free
harness takes a fake: `new StepCtx((req) => ({ exitCode: 0, stdout: "", stderr: "" }))`.
Examples: [`examples/steps`](examples/steps) (`npm run example:build:steps`,
`npm run example:build:exec`).

Unit-test steps without a WASM runtime via `testStep(def, ctx, name, params)`:

```ts
import assert from "node:assert/strict";
import { StepCtx, testStep } from "@perfscale/library-sdk";
import steps from "./echo.ts";

const res = testStep(steps, new StepCtx(), "echo", { message: "hi" });
assert.equal(res.success, true);
assert.deepEqual(res.output, { message: "hi" });
```

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

## License

Dual-licensed under [MIT](../LICENSE-MIT) or
[Apache-2.0](../LICENSE-APACHE), same as the main perfscale repo.
