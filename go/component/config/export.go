// Package config exports a perfscale library with a config-schema declaration.
package config

import (
	perfscale "github.com/Perfscale/sdk-libraries/go"
	configschema "github.com/Perfscale/sdk-libraries/go/internal/gen/config/perfscale/library/config-schema"
	"github.com/Perfscale/sdk-libraries/go/internal/gen/config/perfscale/library/library"
	"go.bytecodealliance.org/cm"
)

// Export registers lib through the perfscale-library-config WIT world.
func Export(lib *perfscale.Library) {
	runtime, err := perfscale.NewRuntime(lib)
	if err != nil {
		panic(err)
	}
	if lib == nil || lib.ConfigSchema == nil {
		panic("config component export requires Library.ConfigSchema")
	}
	library.Exports.Info = runtime.Info
	configschema.Exports.ConfigSchema = func() string {
		encoded, err := runtime.ConfigSchema()
		if err != nil {
			panic(err)
		}
		return encoded
	}
	library.Exports.Init = func(configJSON string) cm.Result[string, struct{}, string] {
		var result cm.Result[string, struct{}, string]
		if err := runtime.Init(configJSON); err != nil {
			result.SetErr(err.Error())
		} else {
			result.SetOK(struct{}{})
		}
		return result
	}
	library.Exports.Call = func(ctx library.Context, name, argsJSON string) cm.Result[string, string, string] {
		var result cm.Result[string, string, string]
		output, err := runtime.Call(perfscale.CallContext{
			MessageSeq: ctx.MessageSeq, IterationSeq: ctx.IterationSeq,
			VuID: ctx.VuID, Seed: ctx.Seed, TimeMs: ctx.TimeMs,
			SettingsJSON: ctx.SettingsJSON,
		}, name, argsJSON)
		if err != nil {
			result.SetErr(err.Error())
		} else {
			result.SetOK(output)
		}
		return result
	}
}
