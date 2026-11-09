# Go SDK for perfscale libraries

The Go SDK authors deterministic value-generator components for
`perfscale:library@0.3.0`. It provides the same PRNG, memoization, argument
conversion, settings, config-extension, and runtime-free testing semantics as
the Rust and TypeScript SDKs. The working [`examples/hello`](examples/hello)
component uses only the public SDK — no handwritten ABI glue.

## Packages

| Package | Purpose |
|---|---|
| `github.com/Perfscale/sdk-libraries/go` | `Library`, `Ctx`, `Prng`, settings, `Runtime`, `TestCall` |
| `github.com/Perfscale/sdk-libraries/go/args` | Typed JSON argument helpers |
| `github.com/Perfscale/sdk-libraries/go/component` | Standard `perfscale-library` component export |
| `github.com/Perfscale/sdk-libraries/go/component/config` | `perfscale-library-config` export with `config-schema` |

The public author API is stable. Breaking API changes require a new major Go
module version; WIT/ABI changes are explicit and versioned. Generated bindings
under `internal/gen` are an implementation detail and are not importable by
consumers outside this module.

## Quickstart

```go
package main

import (
    "strconv"

    perfscale "github.com/Perfscale/sdk-libraries/go"
    "github.com/Perfscale/sdk-libraries/go/args"
    "github.com/Perfscale/sdk-libraries/go/component"
)

var library = perfscale.MustLibrary(perfscale.Library{
    Name: "hello", Version: "1.0.0", Pure: true,
    Functions: map[string]perfscale.Function{
        "greet": {
            Description: "Return a greeting",
            Call: func(argv []any, ctx *perfscale.Ctx) (string, error) {
                name, err := args.String(argv, 0, "hello.greet")
                if err != nil { return "", err }
                return "hello, " + name + "!", nil
            },
        },
        "token": {
            Secret: true,
            Call: func(argv []any, ctx *perfscale.Ctx) (string, error) {
                mint := func(ctx *perfscale.Ctx) (string, error) {
                    return strconv.FormatUint(ctx.RNG().NextU64(), 16), nil
                }
                if key, ok := args.OptionalString(argv, 0); ok {
                    return ctx.Memo(key, mint)
                }
                return mint(ctx)
            },
        },
    },
})

func init() { component.Export(library) }
func main() {}
```

`DefineLibrary` returns validation errors; `MustLibrary` is the convenient
package-level form that panics on an invalid static definition. Function names
and the library name match `[a-z][a-z0-9_]*`. `info()` output is deterministic:
functions are sorted by name.

The full example also shows `Init` validation. Build and run it with:

```console
cd examples/hello
go test ./...
./build.sh
```

Then reference `hello.wasm` from perfscale YAML, as `hello.test.yaml` does.
Declare `capabilities: []` for a pure component.

## Determinism, memoization, and settings

- `Ctx.RNG()` returns a seeded xorshift64 PRNG. `NextU64`, `Below`, `Range`, and
  `F64` are bit-identical to the other SDKs. Do not use `crypto/rand` or the
  global `math/rand` source: real entropy imports `wasi:random`, which the
  engine rejects.
- `Ctx.Memo(key, fn)` caches within one `MessageSeq` and clears on the next
  message. Factory errors are not cached.
- `Ctx.Settings` exposes `Vus`, `DurationMs`, `Seed`, `Stages`, `Arrival`,
  `Variables`, and `Extensions`. Settings sent once by the engine are retained
  when later calls elide `settings-json`.
- JSON decoding uses `json.Number`, so integer arguments, config, variables,
  and extensions do not lose precision through a `float64` round trip.
- `TimeMs` is the library's wall-clock source. Set `Pure` only when the library
  performs no filesystem or wall-clock I/O.

## Unit tests without WASM

```go
func TestGreet(t *testing.T) {
    ctx := perfscale.NewCtx(42)
    got, err := perfscale.TestCall(library, ctx, "greet", []any{"world"})
    if err != nil || got != "hello, world!" {
        t.Fatalf("got %q, %v", got, err)
    }
}
```

`NewRuntime` additionally exercises the actual JSON boundary: `Info`, `Init`,
`Call`, and `ConfigSchema`. It converts malformed input and recovered callback
panics into errors rather than trapping the host call. Run the SDK's own suite
with `go test ./... && go vet ./...` from `go/`.

## Config extensions

A library claiming a top-level config key sets `Library.ConfigSchema` and uses
`component/config.Export` instead of `component.Export`:

```go
var library = perfscale.MustLibrary(perfscale.Library{
    Name: "hello",
    Functions: functions,
    ConfigSchema: &perfscale.ConfigSchemaDeclaration{
        Key: "hello",
        Schema: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "prefix": map[string]any{"type": "string"},
            },
            "required": []string{"prefix"},
        },
    },
})
```

The build world must export both `perfscale:library/library@0.3.0` and
`perfscale:library/config-schema@0.3.0` (`perfscale-library-config`). At run
start perfscale validates the config against this schema and exposes the block
as `ctx.Settings.Extensions["hello"]`. Use exactly one component-export
package per component; the standard and config worlds are separate by design.

## Building components

Requirements: Go 1.24+, TinyGo 0.42 with `wasip2`, `wasm-tools`, `wasm-opt`
(binaryen), and Python 3. `build.sh` performs the required pipeline:

1. `tinygo build -target=wasip2 -buildmode=c-shared -scheduler=none
   -gc=conservative` emits a reactor component. SDK calls are synchronous, so
   asyncify is unnecessary; conservative GC stays within the engine's 64 MiB
   instance cap under sustained calls. The wasip2 default (asyncify + precise
   GC) traps after a few iterations in this host integration.
2. `tools/patch_component.py extract` unwraps the core module and removes the
   unused `arc4random_buf` export.
3. `wasm-opt --remove-unused-module-elements` removes its random-bytes import.
4. `rename-random` maps TinyGo's startup `get-random-u64` import to the
   signature-compatible monotonic clock. No user randomness comes from it.
5. `wasm-tools component embed` and `component new` re-world the component to
   `perfscale:library/library@0.3.0`.

Plain `tinygo build -target=wasip2` is insufficient: it selects the
`wasi:cli/command` world and retains `wasi:random`, which perfscale rejects.
Audit the result:

```console
wasm-tools validate hello.wasm
wasm-tools component wit hello.wasm
```

The WIT output must show the 0.3 export and no `wasi:random/*`. WASI filesystem,
clock, network, and process access remains fail-closed under the engine's
capability gates.

## Regenerating internal bindings

Bindings are committed so normal builds do not need the generator. Regenerate
both worlds deliberately after syncing `../ts/wit/library.wit`:

```console
cd go
WIT="$(realpath ../ts/wit)"
go run go.bytecodealliance.org/cmd/wit-bindgen-go@v0.7.0 generate \
  --world perfscale-library --out internal/gen/library "$WIT"
go run go.bytecodealliance.org/cmd/wit-bindgen-go@v0.7.0 generate \
  --world perfscale-library-config --out internal/gen/config "$WIT"
go mod tidy
go test ./...
```

Use a normalized absolute WIT path; the generator's embedded wasm-tools cannot
traverse `..` path components.
