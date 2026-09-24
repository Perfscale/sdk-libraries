# Go recipe for perfscale libraries (experimental)

There is **no Go SDK yet** — this is a documented recipe for building a
perfscale library component in Go by hand. If you follow it, expect rough
edges and please report what breaks.

The contract is [`../ts/wit/library.wit`](../ts/wit/library.wit)
(`perfscale:library@0.1.0`) — the single source of truth, shared with the
engine and the Rust/TS SDKs. The engine loads any component exporting
`perfscale:library/library@0.1.x`, so Go works as long as the component:

- exports `info()` / `init(config-json)` / `call(ctx, func-name, args-json)`
  exactly as the WIT specifies,
- imports **only** WASI interfaces the engine can grant: `wasi:filesystem/*`
  and `wasi:clocks/*` (plus their `wasi:io/*` plumbing and the `wasi:cli/*`
  sinks). `wasi:random/*` and `wasi:http/*` are hard load errors today.

## Ingredients

- **TinyGo** with the `wasip2` target (`tinygo build -target=wasip2 -o mylib.wasm .`).
  Go 1.24+ can also emit `GOOS=wasip2 GOARCH=wasm` core modules, but then you
  must componentize with an adapter yourself — TinyGo is the smoother path.
- **wit-bindgen-go** (`go.bytecodealliance.org/cmd/wit-bindgen-go`) to generate
  guest bindings from `library.wit`:

  ```console
  $ wit-bindgen-go generate --world perfscale-library --out internal/gen ../ts/wit
  ```

  Implement the generated `Exports` interface (the `library` interface's
  `Info` / `Init` / `Call`), then build:

  ```console
  $ tinygo build -target=wasip2 -o mylib.wasm .
  ```

## Semantics to mirror (from the Rust SDK / TS SDK)

- Keep one long-lived context per instance; refresh `message-seq` etc. before
  every `call`. `memo(key)` caches by `(message-seq, key)` and clears when
  `message-seq` changes.
- Seed a xorshift64 PRNG from `ctx.seed` (`seed|1`; shifts 13/7/17, wrapping
  u64 arithmetic) so values agree with Rust/TS libraries under `seed:` runs.
  Do **not** use `crypto/rand` or `math/rand`'s global source — they pull in
  `wasi:random`, which the engine rejects.
- `info()` returns JSON
  `{"name","version","functions":[{"name","description","secret"}]}`; the
  name becomes the default token alias and must match `[a-z][a-z0-9_]*`.

## Tracked issues / why this is not an SDK

- No `defineLibrary`-style ergonomics, args helpers, or test harness —
  contributions welcome; the TS SDK in [`../ts`](../ts) is the shape to port.
- Component output from TinyGo needs the same import audit as jco output:
  check with `wasm-tools component wit mylib.wasm` (or `jco wit`) that only
  grantable WASI interfaces appear.
- Follow the main repo's RFC 005 phase-3 work; when the ABI stabilizes past
  `0.1.x` this recipe becomes a real `go/` module.
