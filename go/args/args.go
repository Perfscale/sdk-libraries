// Package args converts JSON token arguments into typed Go values.
package args

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

func got(argv []any, i int) string {
	if i < 0 || i >= len(argv) {
		return "missing"
	}
	encoded, err := json.Marshal(argv[i])
	if err != nil {
		return fmt.Sprintf("%v", argv[i])
	}
	return string(encoded)
}

func String(argv []any, i int, fn string) (string, error) {
	if i >= 0 && i < len(argv) {
		if value, ok := argv[i].(string); ok {
			return value, nil
		}
	}
	return "", fmt.Errorf("%s: argument %d must be a string, got %s", fn, i+1, got(argv, i))
}

func Int(argv []any, i int, fn string) (int64, error) {
	if i >= 0 && i < len(argv) {
		var value int64
		var ok bool
		switch v := argv[i].(type) {
		case json.Number:
			value, ok = integerString(v.String())
		case string:
			value, ok = integerString(strings.TrimSpace(v))
		case float64:
			if math.Trunc(v) == v && v >= -9223372036854775808.0 && v < 9223372036854775808.0 {
				return int64(v), nil
			}
		case int:
			return int64(v), nil
		case int8:
			return int64(v), nil
		case int16:
			return int64(v), nil
		case int32:
			return int64(v), nil
		case int64:
			return v, nil
		case uint:
			if uint64(v) <= math.MaxInt64 {
				return int64(v), nil
			}
		case uint8:
			return int64(v), nil
		case uint16:
			return int64(v), nil
		case uint32:
			return int64(v), nil
		case uint64:
			if v <= math.MaxInt64 {
				return int64(v), nil
			}
		}
		if ok {
			return value, nil
		}
	}
	return 0, fmt.Errorf("%s: argument %d must be an integer, got %s", fn, i+1, got(argv, i))
}

func integerString(value string) (int64, bool) {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil
}

func Float(argv []any, i int, fn string) (float64, error) {
	if i >= 0 && i < len(argv) {
		var value float64
		var err error
		switch v := argv[i].(type) {
		case json.Number:
			value, err = v.Float64()
		case string:
			value, err = strconv.ParseFloat(strings.TrimSpace(v), 64)
		case float64:
			value = v
		case float32:
			value = float64(v)
		case int:
			value = float64(v)
		case int64:
			value = float64(v)
		case uint64:
			value = float64(v)
		default:
			err = fmt.Errorf("not a number")
		}
		if err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value, nil
		}
	}
	return 0, fmt.Errorf("%s: argument %d must be a number, got %s", fn, i+1, got(argv, i))
}

// OptionalString returns false only when the argument is absent. Non-string
// values are JSON-encoded, matching the other perfscale SDKs.
func OptionalString(argv []any, i int) (string, bool) {
	if i < 0 || i >= len(argv) {
		return "", false
	}
	if value, ok := argv[i].(string); ok {
		return value, true
	}
	return got(argv, i), true
}
