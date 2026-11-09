package perfscale

import (
	"errors"
	"math"
	"testing"
)

func TestPrngMatchesCrossSDKVector(t *testing.T) {
	prng := NewPrng(42)
	want := []uint64{46537075435, 12685210767805585150, 1156789259011059539}
	for i, expected := range want {
		if got := prng.NextU64(); got != expected {
			t.Fatalf("draw %d = %d, want %d", i, got, expected)
		}
	}
	if NewPrng(0).state != 1 {
		t.Fatal("zero seed must be forced to one")
	}
}

func TestPrngHelpersStayInRange(t *testing.T) {
	prng := NewPrng(7)
	for range 1000 {
		if got := prng.Below(10); got >= 10 {
			t.Fatalf("Below(10) = %d", got)
		}
		if got := prng.Range(-5, 5); got < -5 || got > 5 {
			t.Fatalf("Range(-5, 5) = %d", got)
		}
		if got := prng.F64(); got < 0 || got >= 1 {
			t.Fatalf("F64() = %f", got)
		}
	}
	if got := prng.Below(0); got != 0 {
		t.Fatalf("Below(0) = %d", got)
	}
	if got := prng.Range(4, 4); got != 4 {
		t.Fatalf("Range(4, 4) = %d", got)
	}
	_ = prng.Range(math.MinInt64, math.MaxInt64)
}

func TestMemoScopesValuesToMessage(t *testing.T) {
	ctx := NewCtx(1)
	ctx.MessageSeq = 1
	calls := 0
	next := func(*Ctx) (string, error) {
		calls++
		return "value", nil
	}
	for range 2 {
		if _, err := ctx.Memo("key", next); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatalf("same message called factory %d times", calls)
	}
	ctx.MessageSeq = 2
	_, _ = ctx.Memo("key", next)
	if calls != 2 {
		t.Fatalf("next message did not refresh memo: %d", calls)
	}
}

func TestMemoDoesNotCacheErrors(t *testing.T) {
	ctx := NewCtx(1)
	calls := 0
	_, err := ctx.Memo("key", func(*Ctx) (string, error) {
		calls++
		return "", errors.New("no")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	_, _ = ctx.Memo("key", func(*Ctx) (string, error) {
		calls++
		return "ok", nil
	})
	if calls != 2 {
		t.Fatalf("error was cached, calls = %d", calls)
	}
}
