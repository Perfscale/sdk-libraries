// Command hello is the Go example perfscale library — the same semantics as
// ts/examples/hello (greet + deterministic, memoizable token), built with
// TinyGo's wasip2 target:
//
//	tinygo build -target=wasip2 -o hello.wasm .
//
// Bindings under internal/gen are generated from ../../ts/wit with
// wit-bindgen-go (see go/README.md); do not edit them.
package main

import (
	"encoding/json"
	"fmt"
	"strconv"

	"go.bytecodealliance.org/cm"

	"github.com/Perfscale/sdk-libraries/go/examples/hello/internal/gen/perfscale/library/library"
)

// xorshift64 PRNG, bit-identical to the Rust SDK, the TS SDK's Prng, and the
// engine's built-in generator (@std/random) for the same seed. u64 shifts
// wrap naturally in Go — no masking needed.
type prng struct{ state uint64 }

// newPrng forces a zero seed non-zero (xorshift degenerates at 0).
func newPrng(seed uint64) *prng { return &prng{state: seed | 1} }

func (p *prng) nextU64() uint64 {
	x := p.state
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	p.state = x
	return x
}

// instanceCtx mirrors the TS SDK's Ctx: one long-lived context per component
// instance, refreshed before every call; memo state is keyed by
// (messageSeq, key) and clears when messageSeq changes.
type instanceCtx struct {
	messageSeq uint64
	seed       uint64

	memoSeq uint64
	memo    map[string]string
	rng     *prng
}

func (c *instanceCtx) refresh(w library.Context) {
	c.messageSeq = w.MessageSeq
	c.seed = w.Seed
}

func (c *instanceCtx) next() uint64 {
	if c.rng == nil {
		c.rng = newPrng(c.seed)
	}
	return c.rng.nextU64()
}

func (c *instanceCtx) memoized(key string, fn func() string) string {
	if c.messageSeq != c.memoSeq {
		c.memoSeq = c.messageSeq
		c.memo = map[string]string{}
	}
	if v, ok := c.memo[key]; ok {
		return v
	}
	v := fn()
	c.memo[key] = v
	return v
}

var ctx = &instanceCtx{memo: map[string]string{}}

type functionDef struct {
	Description string `json:"description"`
	Secret      bool   `json:"secret"`
}

type functionEntry struct {
	Name string `json:"name"`
	functionDef
}

type info struct {
	Name      string          `json:"name"`
	Version   string          `json:"version"`
	Pure      bool            `json:"pure"`
	Functions []functionEntry `json:"functions"`
}

// got mirrors the TS args helpers' error rendering ("missing" or the JSON).
func got(argv []any, i int) string {
	if i >= len(argv) {
		return "missing"
	}
	b, _ := json.Marshal(argv[i])
	return string(b)
}

// argString mirrors args.string: argument i must be a string.
func argString(argv []any, i int, fn string) (string, error) {
	if i < len(argv) {
		if s, ok := argv[i].(string); ok {
			return s, nil
		}
	}
	return "", fmt.Errorf("%s: argument %d must be a string, got %s", fn, i+1, got(argv, i))
}

// optionalString mirrors args.optionalString: absent → no key; a non-string
// argument is JSON-encoded, like the TS helper does.
func optionalString(argv []any, i int) (string, bool) {
	if i >= len(argv) {
		return "", false
	}
	if s, ok := argv[i].(string); ok {
		return s, true
	}
	return got(argv, i), true
}

func greet(argv []any, _ *instanceCtx) (string, error) {
	name, err := argString(argv, 0, "hello.greet")
	if err != nil {
		return "", err
	}
	return "hello, " + name + "!", nil
}

// token mirrors the TS example: `tok-<hex>` from the seeded PRNG, memoized
// by (messageSeq, memoKey) when a key argument is passed.
func token(argv []any, _ *instanceCtx) (string, error) {
	mint := func() string { return "tok-" + strconv.FormatUint(ctx.next(), 16) }
	if key, ok := optionalString(argv, 0); ok {
		return ctx.memoized(key, mint), nil
	}
	return mint(), nil
}

var functions = map[string]struct {
	def  functionDef
	call func(argv []any, c *instanceCtx) (string, error)
}{
	"greet": {
		def:  functionDef{Description: "Say hello: greet(name) → `hello, <name>!`"},
		call: greet,
	},
	"token": {
		def:  functionDef{Description: "Deterministic token from the seeded PRNG; optional memo key reuses it within one message"},
		call: token,
	},
}

func init() {
	library.Exports.Info = func() string {
		entries := make([]functionEntry, 0, len(functions))
		// Stable order matching the TS example's info() output.
		for _, name := range []string{"greet", "token"} {
			entries = append(entries, functionEntry{Name: name, functionDef: functions[name].def})
		}
		b, err := json.Marshal(info{
			Name:      "hello",
			Version:   "0.1.0",
			Pure:      true,
			Functions: entries,
		})
		if err != nil {
			panic(err)
		}
		return string(b)
	}

	library.Exports.Init = func(configJSON string) cm.Result[string, struct{}, string] {
		var result cm.Result[string, struct{}, string]
		var config any
		if configJSON != "" {
			if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
				result.SetErr("hello: invalid `with:` config JSON: " + err.Error())
				return result
			}
		}
		if config != nil {
			if _, ok := config.(map[string]any); !ok {
				result.SetErr("hello: `with:` config must be a mapping")
				return result
			}
		}
		result.SetOK(struct{}{})
		return result
	}

	library.Exports.Call = func(w library.Context, funcName string, argsJSON string) cm.Result[string, string, string] {
		var result cm.Result[string, string, string]
		var argv []any
		if err := json.Unmarshal([]byte(argsJSON), &argv); err != nil {
			result.SetErr(funcName + ": invalid args JSON: " + err.Error())
			return result
		}
		if argv == nil {
			result.SetErr(funcName + ": args JSON must be an array")
			return result
		}
		ctx.refresh(w)
		f, ok := functions[funcName]
		if !ok {
			result.SetErr("unknown function '" + funcName + "'")
			return result
		}
		out, err := f.call(argv, ctx)
		if err != nil {
			result.SetErr(err.Error())
			return result
		}
		result.SetOK(out)
		return result
	}
}

func main() {}
