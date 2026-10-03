# Go for perfscale libraries (experimental)

There is **no Go SDK yet**, but there is a **working example component** in
[`examples/hello`](examples/hello) — a TinyGo port of the TS `hello` library
(`greet` + a deterministic, memoizable `token`), bit-identical in output to
the TS/Rust examples under the same `seed:`. Expect rough edges and please
report what breaks.

The contract is [`../ts/wit/library.wit`](../ts/wit/library.wit)
(`perfscale:library@0.2.0`) — the single source of truth, shared with the
engine and the Rust/TS SDKs. The engine dispatches bindings by ABI major
version: this example still exports `perfscale:library/library@0.1.0`, which
the engine keeps accepting — 0.1 components simply never see the 0.2
`settings-json` field (the TS SDK has moved to 0.2). So Go works as long as
the component:

- exports `info()` / `init(config-json)` / `call(ctx, func-name, args-json)`
  exactly as the WIT specifies,
- imports **only** WASI interfaces the engine can grant: `wasi:filesystem/*`
  and `wasi:clocks/*` (plus their `wasi:io/*` plumbing and the `wasi:cli/*`
  sinks). `wasi:random/*` and `wasi:http/*` are hard load errors today. If
  `info()` reports `"pure": true` (the example does), engines honoring the
  pure marker waive the fs/wall-clock capability requirement and provide no
  preopens. The `libraries:` entry must still carry an explicit
  `capabilities:` key (`[]` = no grants) — perfscale ≥ the upcoming release
  rejects entries that omit it.

## Ingredients

- **TinyGo** with the `wasip2` target.
  Go 1.24+ can also emit `GOOS=wasip2 GOARCH=wasm` core modules, but then you
  must componentize with an adapter yourself — TinyGo is the smoother path.
- **wit-bindgen-go** (`go.bytecodealliance.org/cmd/wit-bindgen-go`) to generate
  guest bindings from `library.wit`. The example commits its generated code
  (`examples/hello/internal/gen`); regenerate with:

  ```console
  $ cd examples/hello
  $ go run go.bytecodealliance.org/cmd/wit-bindgen-go@latest generate \
      --world perfscale-library --out internal/gen "$PWD/../../../ts/wit"
  ```

  (Pass an absolute wit path — the embedded wasm-tools cannot open `../..`
  relative paths.) Implement the generated `Exports` (`Info` / `Init` /
  `Call`).
- **wasm-tools**, **wasm-opt** (binaryen) and **python3** for the build
  pipeline (see below).

## Building

Plain `tinygo build -target=wasip2 -o hello.wasm .` does **not** work, for
two reasons:

1. TinyGo always wraps the output in the `wasi:cli/command` world, so the
   component exports `wasi:cli/run` instead of `perfscale:library/library`.
2. TinyGo's wasip2 runtime unconditionally imports `wasi:random/random`
   (`get-random-u64` to seed its internal PRNG at startup, and
   `get-random-bytes` behind the never-called libc-compat export
   `arc4random_buf`). The engine hard-rejects `wasi:random` at load time.

So the example builds with [`examples/hello/build.sh`](examples/hello/build.sh):

```console
$ cd examples/hello && ./build.sh
```

The script:

1. `tinygo build -target=wasip2 -buildmode=c-shared` — emits a reactor
   component whose core module exports `perfscale:library/library@0.1.0#*`.
2. `tools/patch_component.py extract` — unwraps the core module and drops
   the unused `arc4random_buf` export.
3. `wasm-opt --remove-unused-module-elements` — with the export gone, DCE
   deletes `arc4random_buf` and the `get-random-bytes` import entirely.
4. `tools/patch_component.py rename-random` — rewrites the remaining
   `get-random-u64` import as `wasi:clocks/monotonic-clock now` (identical
   canonical signature `() -> u64`; a clock draw is a fine PRNG seed). Only
   import-section strings are rewritten — no function indices change.
5. `wasm-tools component embed` + `component new` — re-componentizes against
   [`examples/hello/wit/world.wit`](examples/hello/wit/world.wit), a
   build-only world declaring the WASI interfaces the TinyGo runtime links
   (deps vendored under `wit/deps/`, including the ABI contract copied from
   `ts/wit`) plus the `perfscale:library/library@0.1.0` export.

Audit the result with `wasm-tools component wit hello.wasm`: the component
must export `perfscale:library/library@0.1.0` and import **no**
`wasi:random/*` — `build.sh` prints the world for exactly this check.

## Semantics to mirror (see examples/hello/main.go)

- Keep one long-lived context per instance; refresh `message-seq` etc. before
  every `call`. `memo(key)` caches by `(message-seq, key)` and clears when
  `message-seq` changes.
- Seed a xorshift64 PRNG from `ctx.seed` (`seed|1`; shifts 13/7/17, wrapping
  u64 arithmetic) so values agree with Rust/TS libraries under `seed:` runs.
  Do **not** use `crypto/rand` or `math/rand`'s global source — they pull in
  `wasi:random`, which the engine rejects.
- `info()` returns JSON
  `{"name","version","pure","functions":[{"name","description","secret"}]}`;
  the name becomes the default token alias and must match `[a-z][a-z0-9_]*`.
  Set `"pure": true` when the library never touches the filesystem or the
  wall clock; engines older than the pure-marker release ignore the field
  and still demand `capabilities: [fs]` + `allow_library_capabilities: true`
  (fail-closed).

## Tracked issues / why this is not an SDK

- No `defineLibrary`-style ergonomics, args helpers, or test harness —
  contributions welcome; the TS SDK in [`../ts`](../ts) is the shape to port.
- Follow the main repo's RFC 005 phase-3 work; when the ABI stabilizes past
  `0.1.x` this example may grow into a real `go/` module.
