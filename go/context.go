package perfscale

// Prng is the seeded xorshift64 generator used by every perfscale SDK.
// It is deterministic, not cryptographically secure.
type Prng struct {
	state uint64
}

func NewPrng(seed uint64) *Prng {
	return &Prng{state: seed | 1}
}

func (p *Prng) NextU64() uint64 {
	x := p.state
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	p.state = x
	return x
}

// Below returns a uniform value in [0, n), or zero when n is zero.
func (p *Prng) Below(n uint64) uint64 {
	if n == 0 {
		return 0
	}
	return p.NextU64() % n
}

// Range returns a uniform integer in [lo, hi]. It returns lo for an empty range.
func (p *Prng) Range(lo, hi int64) int64 {
	if hi <= lo {
		return lo
	}
	span := uint64(hi) - uint64(lo) + 1
	if span == 0 {
		return int64(p.NextU64())
	}
	return lo + int64(p.NextU64()%span)
}

// F64 returns a uniform float in [0, 1).
func (p *Prng) F64() float64 {
	return float64(p.NextU64()>>11) / float64(uint64(1)<<53)
}

type StageSettings struct {
	DurationMs uint64 `json:"duration_ms"`
	Target     uint32 `json:"target"`
}

type RateStageSettings struct {
	DurationMs uint64  `json:"duration_ms"`
	Rate       float64 `json:"rate"`
}

type ArrivalSettings struct {
	MaxVUs          uint32              `json:"max_vus"`
	PreAllocatedVUs uint32              `json:"pre_allocated_vus"`
	Stages          []RateStageSettings `json:"stages"`
}

// RunSettings is the immutable run snapshot supplied by ABI 0.2 and later.
type RunSettings struct {
	Vus        *uint64          `json:"vus"`
	DurationMs *uint64          `json:"duration_ms"`
	Seed       *uint64          `json:"seed"`
	Stages     []StageSettings  `json:"stages"`
	Arrival    *ArrivalSettings `json:"arrival"`
	Variables  map[string]any   `json:"variables"`
	Extensions map[string]any   `json:"extensions"`
}

func emptySettings() RunSettings {
	return RunSettings{Variables: map[string]any{}, Extensions: map[string]any{}}
}

// Ctx is the long-lived context of one component instance.
type Ctx struct {
	MessageSeq   uint64
	IterationSeq uint64
	VuID         uint64
	Seed         uint64
	TimeMs       uint64
	Settings     RunSettings

	memoSeq uint64
	memo    map[string]string
	prng    *Prng
}

func NewCtx(seed uint64) *Ctx {
	return &Ctx{Seed: seed, Settings: emptySettings(), memo: map[string]string{}}
}

// RNG returns the instance's deterministic PRNG, initialized from Seed on first use.
func (c *Ctx) RNG() *Prng {
	if c.prng == nil {
		c.prng = NewPrng(c.Seed)
	}
	return c.prng
}

// Memo reuses a value for key within one MessageSeq. Errors are not cached.
func (c *Ctx) Memo(key string, fn func(*Ctx) (string, error)) (string, error) {
	if c.memo == nil {
		c.memo = map[string]string{}
	}
	if c.MessageSeq != c.memoSeq {
		c.memoSeq = c.MessageSeq
		clear(c.memo)
	}
	if value, ok := c.memo[key]; ok {
		return value, nil
	}
	value, err := fn(c)
	if err != nil {
		return "", err
	}
	c.memo[key] = value
	return value, nil
}
