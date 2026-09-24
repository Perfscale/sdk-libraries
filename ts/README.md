# perfscale SDK libraries

Tooling for authoring **perfscale libraries** — WASM components that provide
value-generating functions to `${alias.fn(...)}` tokens in
[perfscale](https://github.com/Perfscale/perfscale) test payloads (RFC 005):

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
[`ts/wit/library.wit`](ts/wit/library.wit), mirrored from the main repo's
single source of truth.

## Languages

| Language | Status | Where |
|---|---|---|
| **TypeScript / JavaScript** | SDK + build tooling | [`ts/`](ts) (`@perfscale/library-sdk`) |
| **Go** | Documented recipe (experimental, no SDK yet) | [`go/README.md`](go/README.md) |
| **Rust** | Full SDK, lives in the main repo | [`crates/perfscale-library-sdk`](https://github.com/Perfscale/perfscale/tree/main/crates/perfscale-library-sdk) |

