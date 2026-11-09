// Package perfscale defines deterministic value-generator libraries for perfscale.
package perfscale

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// LibraryError is an author-facing error returned as the step failure cause.
type LibraryError struct {
	Message string
}

func (e *LibraryError) Error() string { return e.Message }

func Errorf(format string, args ...any) *LibraryError {
	return &LibraryError{Message: fmt.Sprintf(format, args...)}
}

type CallFunc func(argv []any, ctx *Ctx) (string, error)

type Function struct {
	Description string
	Secret      bool
	Call        CallFunc
}

type ConfigSchemaDeclaration struct {
	Key    string
	Schema map[string]any
}

type InitFunc func(config any) error

type Library struct {
	Name         string
	Version      string
	Pure         bool
	Functions    map[string]Function
	Init         InitFunc
	ConfigSchema *ConfigSchemaDeclaration
}

func DefineLibrary(def Library) (*Library, error) {
	if !identifier.MatchString(def.Name) {
		return nil, Errorf("library name %q must match [a-z][a-z0-9_]*", def.Name)
	}
	if def.Version == "" {
		def.Version = "0.0.0"
	}
	if len(def.Functions) == 0 {
		return nil, Errorf("library %q must declare at least one function", def.Name)
	}
	for name, fn := range def.Functions {
		if !identifier.MatchString(name) {
			return nil, Errorf("function name %q must match [a-z][a-z0-9_]*", name)
		}
		if fn.Call == nil {
			return nil, Errorf("function %q needs a Call function", name)
		}
	}
	if def.ConfigSchema != nil {
		if !identifier.MatchString(def.ConfigSchema.Key) {
			return nil, Errorf("config schema key %q must match [a-z][a-z0-9_]*", def.ConfigSchema.Key)
		}
		if def.ConfigSchema.Schema == nil {
			return nil, Errorf("config schema for %q must be a JSON Schema object", def.ConfigSchema.Key)
		}
		if _, err := json.Marshal(def.ConfigSchema.Schema); err != nil {
			return nil, Errorf("config schema for %q is not JSON-serializable: %v", def.ConfigSchema.Key, err)
		}
	}
	return &def, nil
}

func MustLibrary(def Library) *Library {
	lib, err := DefineLibrary(def)
	if err != nil {
		panic(err)
	}
	return lib
}

// TestCall invokes a library directly without a WASM runtime.
func TestCall(lib *Library, ctx *Ctx, name string, argv []any) (string, error) {
	if lib == nil || ctx == nil {
		return "", Errorf("library and context are required")
	}
	fn, ok := lib.Functions[name]
	if !ok {
		return "", Errorf("unknown function %q", name)
	}
	return fn.Call(argv, ctx)
}

// CallContext is the ABI-neutral form of the WIT call context.
type CallContext struct {
	MessageSeq   uint64
	IterationSeq uint64
	VuID         uint64
	Seed         uint64
	TimeMs       uint64
	SettingsJSON string
}

// Runtime adapts a Library to the JSON/WIT boundary and is also useful in host tests.
type Runtime struct {
	lib         *Library
	ctx         *Ctx
	settingsRaw string
}

func NewRuntime(lib *Library) (*Runtime, error) {
	if lib == nil {
		return nil, Errorf("library is required")
	}
	validated, err := DefineLibrary(*lib)
	if err != nil {
		return nil, err
	}
	return &Runtime{lib: validated, ctx: NewCtx(0)}, nil
}

type functionInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Secret      bool   `json:"secret"`
}

type libraryInfo struct {
	Name         string         `json:"name"`
	Version      string         `json:"version"`
	Pure         bool           `json:"pure"`
	SettingsOnce bool           `json:"settings_once"`
	Functions    []functionInfo `json:"functions"`
}

func (r *Runtime) Info() string {
	names := make([]string, 0, len(r.lib.Functions))
	for name := range r.lib.Functions {
		names = append(names, name)
	}
	sort.Strings(names)
	functions := make([]functionInfo, 0, len(names))
	for _, name := range names {
		fn := r.lib.Functions[name]
		functions = append(functions, functionInfo{Name: name, Description: fn.Description, Secret: fn.Secret})
	}
	encoded, _ := json.Marshal(libraryInfo{
		Name: r.lib.Name, Version: r.lib.Version, Pure: r.lib.Pure,
		SettingsOnce: true, Functions: functions,
	})
	return string(encoded)
}

func (r *Runtime) ConfigSchema() (string, error) {
	decl := r.lib.ConfigSchema
	if decl == nil {
		return "", Errorf("library %q declares no config schema; use the standard component export", r.lib.Name)
	}
	encoded, err := json.Marshal(struct {
		Key    string         `json:"key"`
		Schema map[string]any `json:"schema"`
	}{Key: decl.Key, Schema: decl.Schema})
	if err != nil {
		return "", Errorf("encode config schema: %v", err)
	}
	return string(encoded), nil
}

func decodeJSON(input string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values")
		}
		return err
	}
	return nil
}

func (r *Runtime) Init(configJSON string) (err error) {
	configJSON = strings.Clone(configJSON)
	defer recoverAsError("init", &err)
	var config any
	if strings.TrimSpace(configJSON) != "" {
		if err := decodeJSON(configJSON, &config); err != nil {
			return Errorf("init: invalid config JSON: %v", err)
		}
	}
	r.ctx = NewCtx(0)
	r.settingsRaw = ""
	if r.lib.Init != nil {
		return r.lib.Init(config)
	}
	return nil
}

func recoverAsError(operation string, target *error) {
	if recovered := recover(); recovered != nil {
		*target = Errorf("%s panicked: %v", operation, recovered)
	}
}

func (r *Runtime) Call(w CallContext, name, argsJSON string) (result string, err error) {
	// WIT lifters may borrow linear-memory strings. Own them before JSON/GC work
	// so a collection cannot reuse the input buffer while the call is still live.
	name = strings.Clone(name)
	argsJSON = strings.Clone(argsJSON)
	w.SettingsJSON = strings.Clone(w.SettingsJSON)
	defer recoverAsError("function "+name, &err)
	var argv []any
	if err := decodeJSON(argsJSON, &argv); err != nil {
		return "", Errorf("%s: invalid args JSON: %v", name, err)
	}
	if argv == nil {
		return "", Errorf("%s: args JSON must be an array", name)
	}
	if w.SettingsJSON != "" && w.SettingsJSON != r.settingsRaw {
		raw := strings.TrimSpace(w.SettingsJSON)
		if !strings.HasPrefix(raw, "{") {
			return "", Errorf("settings-json must be a JSON object")
		}
		var settings RunSettings
		decoder := json.NewDecoder(bytes.NewBufferString(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&settings); err != nil {
			return "", Errorf("settings-json must be a JSON object: %v", err)
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			return "", Errorf("settings-json must contain exactly one JSON object")
		}
		if settings.Variables == nil {
			settings.Variables = map[string]any{}
		}
		if settings.Extensions == nil {
			settings.Extensions = map[string]any{}
		}
		r.settingsRaw = w.SettingsJSON
		r.ctx.Settings = settings
	}
	r.ctx.MessageSeq = w.MessageSeq
	r.ctx.IterationSeq = w.IterationSeq
	r.ctx.VuID = w.VuID
	r.ctx.Seed = w.Seed
	r.ctx.TimeMs = w.TimeMs
	return TestCall(r.lib, r.ctx, name, argv)
}
