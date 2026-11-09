package main

import (
	"fmt"
	"strconv"

	perfscale "github.com/Perfscale/sdk-libraries/go"
	"github.com/Perfscale/sdk-libraries/go/args"
	"github.com/Perfscale/sdk-libraries/go/component"
)

var hello = perfscale.MustLibrary(perfscale.Library{
	Name: "hello", Version: "0.1.0", Pure: true,
	Init: func(config any) error {
		if config == nil {
			return nil
		}
		if _, ok := config.(map[string]any); !ok {
			return fmt.Errorf("hello: `with:` config must be a mapping")
		}
		return nil
	},
	Functions: map[string]perfscale.Function{
		"greet": {
			Description: "Say hello: greet(name) → `hello, <name>!`",
			Call: func(argv []any, _ *perfscale.Ctx) (string, error) {
				name, err := args.String(argv, 0, "hello.greet")
				if err != nil {
					return "", err
				}
				return "hello, " + name + "!", nil
			},
		},
		"token": {
			Description: "Deterministic token from the seeded PRNG; optional memo key reuses it within one message",
			Call: func(argv []any, ctx *perfscale.Ctx) (string, error) {
				mint := func(ctx *perfscale.Ctx) (string, error) {
					return "tok-" + strconv.FormatUint(ctx.RNG().NextU64(), 16), nil
				}
				if key, ok := args.OptionalString(argv, 0); ok {
					return ctx.Memo(key, mint)
				}
				return mint(ctx)
			},
		},
	},
})

func init() {
	component.Export(hello)
}

func main() {}
