package args

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestTypedHelpers(t *testing.T) {
	argv := []any{"42", json.Number("2.5"), true, json.Number("9007199254740993")}
	if got, err := String(argv, 0, "f"); err != nil || got != "42" {
		t.Fatalf("String = %q, %v", got, err)
	}
	if got, err := Int(argv, 0, "f"); err != nil || got != 42 {
		t.Fatalf("Int = %d, %v", got, err)
	}
	if got, err := Float(argv, 1, "f"); err != nil || got != 2.5 {
		t.Fatalf("Float = %f, %v", got, err)
	}
	if got, err := Int(argv, 3, "f"); err != nil || got != 9007199254740993 {
		t.Fatalf("large Int = %d, %v", got, err)
	}
	if got, ok := OptionalString(argv, 1); !ok || got != "2.5" {
		t.Fatalf("OptionalString = %q, %v", got, ok)
	}
	if _, ok := OptionalString(argv, 99); ok {
		t.Fatal("missing argument was present")
	}
}

func TestIntFloat64Boundaries(t *testing.T) {
	if got, err := Int([]any{float64(-9223372036854775808.0)}, 0, "f"); err != nil || got != math.MinInt64 {
		t.Fatalf("minimum Int = %d, %v", got, err)
	}
	if _, err := Int([]any{float64(9223372036854775808.0)}, 0, "f"); err == nil {
		t.Fatal("2^63 was accepted as int64")
	}
}

func TestHelperErrorsNameFunctionAndArgument(t *testing.T) {
	for name, err := range map[string]error{
		"string": func() error { _, err := String([]any{true}, 0, "hello.f"); return err }(),
		"int":    func() error { _, err := Int([]any{"2.5"}, 0, "hello.f"); return err }(),
		"float":  func() error { _, err := Float([]any{math.Inf(1)}, 0, "hello.f"); return err }(),
	} {
		if err == nil || !strings.Contains(err.Error(), "hello.f: argument 1") {
			t.Fatalf("%s error = %v", name, err)
		}
	}
}
