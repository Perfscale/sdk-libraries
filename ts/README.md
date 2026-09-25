# @perfscale/library-sdk

TypeScript/JavaScript SDK for authoring **perfscale libraries** — WASM
components that provide value-generating functions to `${alias.fn(...)}`
tokens in [perfscale](https://github.com/Perfscale/perfscale) test payloads
(RFC 005):

```yaml
libraries:
  - use: ./hello.wasm
    capabilities: [fs]
steps:
  - use: std/file-write@v1
    with:
      path: out.txt
      content: "greeting: ${hello.greet(world)}"   # → "greeting: hello, world!"
```

The engine runs each library in a wasmtime sandbox under a fail-closed
capability model; the ABI contract (`perfscale:library@0.1.0`) is
[`wit/library.wit`](wit/library.wit), mirrored from the main repo's single
source of truth.

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
  `seed`, `timeMs` as `bigint`), `ctx.memo(key, fn)` (keyed reuse within one
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
  `wasi:clocks/wall-clock`; declare `capabilities: [fs]` on the `libraries:`
  entry (one `fs` grant satisfies both — a read-only preopen of the run's
  `fs_root`) and set `allow_library_capabilities: true` in the config. The
  build already disables `wasi:random`, `wasi:http` and timers, which the
  engine never grants — draw all randomness from `ctx.rng()` and all time
  from `ctx.timeMs`.
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
