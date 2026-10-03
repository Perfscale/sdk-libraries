# perfscale SDK libraries

Tooling for authoring **perfscale libraries** — WASM components that provide
value-generating functions to `${alias.fn(...)}` tokens in
[perfscale](https://github.com/Perfscale/perfscale) test payloads (RFC 005):

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
[`ts/wit/library.wit`](ts/wit/library.wit), mirrored from the main repo's
single source of truth.

## Languages

| Language | Status | Where |
|---|---|---|
| **TypeScript / JavaScript** | SDK + build tooling | [`ts/`](ts) (`@perfscale/library-sdk`) |
| **Go** | Example component (TinyGo + wit-bindgen-go, no SDK yet) | [`go/examples/hello`](go/examples/hello) |
| **Rust** | Full SDK, lives in the main repo | [`crates/perfscale-library-sdk`](https://github.com/Perfscale/perfscale/tree/main/crates/perfscale-library-sdk) |

## TypeScript quickstart

```console
$ cd ts && npm install
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

Build it to a WASM component with [jco](https://www.npmjs.com/package/@bytecodealliance/jco)
(ComponentizeJS embeds a JS engine — that is how TS becomes a component):

```console
$ npx perfscale-library-build mylib.ts -o mylib.wasm
```

Reference it from your perfscale YAML (relative to the declaring file) and
call it from `${...}` tokens in payloads.

The SDK also gives you:

- **`Ctx`** — per-call context (`messageSeq`, `iterationSeq`, `vuId`,
  `seed`, `timeMs` as `bigint`), `ctx.settings` — the run's frozen settings
  snapshot (WIT 0.2 `settings-json`), `ctx.memo(key, fn)` (keyed reuse within one
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

### Sandboxing notes for TS authors

- jco (StarlingMonkey) components always import `wasi:filesystem/*` and
  `wasi:clocks/wall-clock`, but that is toolchain noise: the SDK reports
  `"pure": true` in `info()` (it exposes no fs/clock APIs to authors), so
  engines honoring the pure marker waive the capability requirement and
  provide no preopens — declare `capabilities: []` (explicit no-grants key,
  required by perfscale ≥ the upcoming release) and nothing more. On engines older
  than the pure-marker release the grant is still required
  (`capabilities: [fs]` on the `libraries:` entry, one `fs` grant satisfies
  both imports, plus `allow_library_capabilities: true` in the config) —
  old engines fail closed. The build already disables `wasi:random`,
  `wasi:http` and timers, which the engine never grants — draw all
  randomness from `ctx.rng()` and all time from `ctx.timeMs`.
- The WIT contract is vendored at `ts/wit/library.wit`;
  `ts/scripts/sync-wit.sh` re-fetches it pinned to a perfscale release tag
  (bump `PERFSCALE_TAG` deliberately).

## Docker

**Authoring (TS/JS)** — a hermetic toolchain image, no host Node required:

```console
$ docker build -t perfscale-library-build ts/docker
$ docker run --rm -v "$PWD:/src" -w /src perfscale-library-build mylib.ts -o mylib.wasm
```

The image is Node 24 + the published `@perfscale/library-sdk` (jco included);
pin the SDK with `--build-arg SDK_VERSION=0.2.0` (`ts/docker/Dockerfile`).

**Rust** — the SDK lives in the engine repo; any `rust:1.x` image with
`wasm32-wasip2` added (`rustup target add wasm32-wasip2`) builds components
with plain cargo. **Go** — the `tinygo/tinygo` image matches the recipe in
`go/README.md`.

**Running** libraries in Docker (engine images, mount layout, the install
cache, and burned standalone binaries) is covered in the engine's
[Docker guide](https://github.com/Perfscale/perfscale/blob/main/docs/core/docker.md#wasm-libraries).

## Layout

```
ts/            @perfscale/library-sdk — defineLibrary, Ctx, Prng, testCall,
               perfscale-library-build (jco componentize glue), example
go/            Go guidance (README) + examples/hello — a working TinyGo
               example component with committed wit-bindgen-go bindings
```

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE),
same as the main perfscale repo.
