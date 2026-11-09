// Package component exports a perfscale library through the standard WIT world.
package component

import (
	perfscale "github.com/Perfscale/sdk-libraries/go"
	"github.com/Perfscale/sdk-libraries/go/internal/gen/library/perfscale/library/library"
	"go.bytecodealliance.org/cm"
)

// Export registers lib as a perfscale:library@0.3.0 component. Call it once
// from init or main. Libraries with ConfigSchema must use component/config.Export.
func Export(lib *perfscale.Library) {
	if lib != nil && lib.ConfigSchema != nil {
		panic("library declares ConfigSchema; use component/config.Export and the perfscale-library-config world")
	}
	runtime, err := perfscale.NewRuntime(lib)
	if err != nil {
		panic(err)
	}
	library.Exports.Info = runtime.Info
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
