package perfscale

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func testLibrary(t *testing.T) *Library {
	t.Helper()
	return MustLibrary(Library{
		Name: "hello", Version: "1.2.3", Pure: true,
		Functions: map[string]Function{
			"token": {
				Description: "deterministic token",
				Call: func(_ []any, ctx *Ctx) (string, error) {
					return ctx.Memo("token", func(ctx *Ctx) (string, error) {
						return strconv.FormatUint(ctx.RNG().NextU64(), 16), nil
					})
				},
			},
			"greet": {Call: func(argv []any, _ *Ctx) (string, error) {
				return "hello, " + argv[0].(string) + "!", nil
			}},
			"panic": {Call: func([]any, *Ctx) (string, error) { panic("boom") }},
		},
	})
}

func TestInfoHasStableOrderAndMetadata(t *testing.T) {
	runtime, err := NewRuntime(testLibrary(t))
	if err != nil {
		t.Fatal(err)
	}
	got := runtime.Info()
	if !strings.Contains(got, `"name":"hello","version":"1.2.3","pure":true,"settings_once":true`) {
		t.Fatalf("Info = %s", got)
	}
	if strings.Index(got, `"name":"greet"`) > strings.Index(got, `"name":"token"`) {
		t.Fatalf("functions are not sorted: %s", got)
	}
}

func TestRuntimeParsesAndRetainsSettings(t *testing.T) {
	lib := testLibrary(t)
	lib.Functions["settings"] = Function{Call: func(_ []any, ctx *Ctx) (string, error) {
		if ctx.Settings.Vus == nil || *ctx.Settings.Vus != 2 {
			t.Fatalf("Vus = %v", ctx.Settings.Vus)
		}
		large := ctx.Settings.Variables["large"].(json.Number)
		if large.String() != "9007199254740993" {
			t.Fatalf("large number = %s", large)
		}
		if ctx.Settings.Extensions["hello"].(map[string]any)["enabled"] != true {
			t.Fatal("extension was not preserved")
		}
		return "ok", nil
	}}
	runtime, err := NewRuntime(lib)
	if err != nil {
		t.Fatal(err)
	}
	call := CallContext{
		MessageSeq: 1, IterationSeq: 3, VuID: 4, Seed: 42, TimeMs: 99,
		SettingsJSON: `{"vus":2,"variables":{"large":9007199254740993},"extensions":{"hello":{"enabled":true}}}`,
	}
	if got, err := runtime.Call(call, "settings", `[]`); err != nil || got != "ok" {
		t.Fatalf("Call = %q, %v", got, err)
	}
	call.SettingsJSON = ""
	if got, err := runtime.Call(call, "settings", `[]`); err != nil || got != "ok" {
		t.Fatalf("elided settings Call = %q, %v", got, err)
	}
	if err := runtime.Init(""); err != nil {
		t.Fatal(err)
	}
	call.SettingsJSON = `{"vus":2,"variables":{"large":9007199254740993},"extensions":{"hello":{"enabled":true}}}`
	if got, err := runtime.Call(call, "settings", `[]`); err != nil || got != "ok" {
		t.Fatalf("settings after re-init Call = %q, %v", got, err)
	}
}

func TestRuntimeRejectsMalformedBoundaryInput(t *testing.T) {
	runtime, err := NewRuntime(testLibrary(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{`null`, `{}`, `[`} {
		if _, err := runtime.Call(CallContext{}, "greet", input); err == nil {
			t.Fatalf("args %s were accepted", input)
		}
	}
	if _, err := runtime.Call(CallContext{SettingsJSON: `null`}, "greet", `["world"]`); err == nil {
		t.Fatal("null settings were accepted")
	}
	if _, err := runtime.Call(CallContext{}, "missing", `[]`); err == nil || !strings.Contains(err.Error(), "unknown function") {
		t.Fatalf("unknown function error = %v", err)
	}
	if err := runtime.Init(`{"broken":`); err == nil {
		t.Fatal("malformed init JSON was accepted")
	}
}

func TestRuntimeContainsPanicsAndInitConfig(t *testing.T) {
	lib := testLibrary(t)
	var configNumber json.Number
	lib.Init = func(config any) error {
		configNumber = config.(map[string]any)["count"].(json.Number)
		return nil
	}
	runtime, err := NewRuntime(lib)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.Init(`{"count":9007199254740993}`); err != nil {
		t.Fatal(err)
	}
	if configNumber.String() != "9007199254740993" {
		t.Fatalf("config number = %s", configNumber)
	}
	if _, err := runtime.Call(CallContext{}, "panic", `[]`); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("panic error = %v", err)
	}
}

func TestDefinitionAndConfigSchemaValidation(t *testing.T) {
	if _, err := DefineLibrary(Library{Name: "Bad-Name", Functions: map[string]Function{"f": {Call: func([]any, *Ctx) (string, error) { return "", nil }}}}); err == nil {
		t.Fatal("invalid name was accepted")
	}
	lib := testLibrary(t)
	lib.ConfigSchema = &ConfigSchemaDeclaration{Key: "hello", Schema: map[string]any{
		"type": "object", "required": []string{"prefix"},
	}}
	runtime, err := NewRuntime(lib)
	if err != nil {
		t.Fatal(err)
	}
	schema, err := runtime.ConfigSchema()
	if err != nil || !strings.Contains(schema, `"key":"hello"`) || !strings.Contains(schema, `"required":["prefix"]`) {
		t.Fatalf("ConfigSchema = %s, %v", schema, err)
	}
}
