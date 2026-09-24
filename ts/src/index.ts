//! TypeScript/JavaScript SDK for authoring perfscale WASM value-generator
//! libraries (RFC 005). Mirrors `crates/perfscale-library-sdk` in the main
//! perfscale repo — same semantics, idiomatic TS.
//!
//! Authors define a library with {@link defineLibrary}, build it to a WASM
//! component with `perfscale-library-build entry.ts -o mylib.wasm` (jco
//! componentize), and reference the `.wasm` from YAML:
//! `libraries: [{ use: ./mylib.wasm }]`.

const MASK64 = (1n << 64n) - 1n;
const TWO53 = 2 ** 53;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Library error: the message the engine surfaces as the step failure cause. */
export class LibraryError extends Error {}

// ---------------------------------------------------------------------------
// Seeded PRNG — xorshift64, bit-identical to the Rust SDK and the engine's
// built-in generator (@std/random)
// ---------------------------------------------------------------------------

/**
 * xorshift64 PRNG seeded per instance from {@link Ctx.seed}. Not
 * cryptographic; plenty for load data. Draws are bit-identical to the Rust
 * SDK's `Prng` for the same seed, so TS and Rust libraries agree under
 * `seed:` runs.
 */
export class Prng {
  #state: bigint;

  /** `seed` is forced non-zero (xorshift degenerates at 0). */
  constructor(seed: bigint | number) {
    this.#state = (BigInt(seed) | 1n) & MASK64;
  }

  nextU64(): bigint {
    let x = this.#state;
    x ^= (x << 13n) & MASK64;
    x ^= x >> 7n;
    x ^= (x << 17n) & MASK64;
    this.#state = x & MASK64;
    return this.#state;
  }

  /** Uniform draw in `[0, n)` (0 for `n == 0`). */
  below(n: bigint | number): bigint {
    const b = BigInt(n);
    if (b <= 0n) return 0n;
    return this.nextU64() % b;
  }

  /** Uniform integer in `[lo, hi]` inclusive (`lo` if the range is empty). */
  range(lo: bigint | number, hi: bigint | number): bigint {
    const l = BigInt(lo);
    const h = BigInt(hi);
    if (h <= l) return l;
    const span = h - l + 1n;
    return l + (this.nextU64() % span);
  }

  /** Uniform float in `[0, 1)`. */
  f64(): number {
    return Number(this.nextU64() >> 11n) / TWO53;
  }
}

// ---------------------------------------------------------------------------
// Call context
// ---------------------------------------------------------------------------

/**
 * The context every library call receives (RFC 005 "Call context").
 *
 * The SDK keeps one `Ctx` per component instance and refreshes the public
 * fields before every call, so {@link Ctx.memo} state persists across calls
 * of one message and resets when `messageSeq` moves on. `u64` ABI fields are
 * exposed as `bigint` (they can exceed `Number.MAX_SAFE_INTEGER`).
 */
export class Ctx {
  /** Same counter as the `${seq}` token; bumped per message send. */
  messageSeq: bigint = 0n;
  /** VU loop iteration. */
  iterationSeq: bigint = 0n;
  /** Virtual-user id, for per-VU partitioning (id ranges, comp ids). */
  vuId: bigint = 0n;
  /** Per-instance deterministic seed: `hash(config.seed, vu_id, conn_seq)`. */
  seed: bigint;
  /** Wall clock, unix milliseconds — the only time source a library gets. */
  timeMs: bigint = 0n;

  // SDK-managed state (not part of the ABI). A Map is safe here: JS Maps
  // are not seeded through wasi:random the way Rust's HashMap is.
  #memoSeq = 0n;
  #memo = new Map<string, string>();
  #prng: Prng | undefined;

  /** A fresh context for unit tests / harness use (see {@link testCall}). */
  constructor(seed: bigint | number = 0) {
    this.seed = BigInt(seed) & MASK64;
  }

  /**
   * The instance's seeded PRNG, created from `seed` on first use. All
   * randomness a library produces must come from here — that is what makes
   * `seed:` runs reproducible. (`wasi:random` is not provided to guests;
   * {@link Math.random} is disabled in the component build.)
   */
  rng(): Prng {
    this.#prng ??= new Prng(this.seed);
    return this.#prng;
  }

  /**
   * Keyed reuse within one message (RFC 005 "memo semantics"): returns the
   * cached value for `key`, computing and caching it via `fn` on first use.
   * The cache is keyed by `(messageSeq, key)` and resets as soon as
   * `messageSeq` changes, so a memoized value never leaks into the next
   * message.
   */
  memo(key: string, fn: (ctx: Ctx) => string): string {
    if (this.messageSeq !== this.#memoSeq) {
      this.#memoSeq = this.messageSeq;
      this.#memo.clear();
    }
    const cached = this.#memo.get(key);
    if (cached !== undefined) return cached;
    const v = fn(this);
    this.#memo.set(key, v);
    return v;
  }
}

// ---------------------------------------------------------------------------
// Author-facing definition
// ---------------------------------------------------------------------------

/** One exported function, as reported by `info()`. */
export interface FunctionDef {
  /** One-line description for docs/lint output. */
  description?: string;
  /** Results are secrets: the engine registers them for log masking. */
  secret?: boolean;
  /**
   * Invoke the function with the token's parsed JSON arguments. Throw
   * {@link LibraryError} (or any `Error`) to fail the step.
   */
  call(args: unknown[], ctx: Ctx): string;
}

/** The library definition passed to {@link defineLibrary}. */
export interface LibraryDefinition {
  /**
   * Library name — becomes the default token alias, so it must be a
   * lowercase identifier `[a-z][a-z0-9_]*` (dashes are not valid). Defaults
   * to the entry file's basename.
   */
  name?: string;
  /** Library version, surfaced by `info()`. Default `"0.0.0"`. */
  version?: string;
  /**
   * Initialize with the YAML `with:` block (already parsed from JSON; the
   * block may be absent, giving `null`). The default accepts and ignores any
   * config — override to validate. Throwing is fatal to the run.
   */
  init?(config: unknown): void;
  /** Exported functions, keyed by the name used in `${alias.name(...)}`. */
  functions: Record<string, FunctionDef>;
}

/** Define a perfscale library. The result is the default export of your entry. */
export function defineLibrary(def: LibraryDefinition): LibraryDefinition {
  if (!def.functions || typeof def.functions !== "object") {
    throw new LibraryError("defineLibrary: `functions` is required");
  }
  for (const [name, f] of Object.entries(def.functions)) {
    if (typeof f?.call !== "function") {
      throw new LibraryError(`defineLibrary: function '${name}' needs a call()`);
    }
  }
  return def;
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

/**
 * Token arguments arrive as a JSON array — these helpers extract and
 * convert, producing author-friendly errors the engine fails the step with.
 */
function got(v: unknown): string {
  return v === undefined ? "missing" : JSON.stringify(v);
}

export const args = {
  /** Argument `i` as a string. Throws when absent or not a string. */
  string(argv: unknown[], i: number, func: string): string {
    const v = argv[i];
    if (typeof v === "string") return v;
    throw new LibraryError(
      `${func}: argument ${i + 1} must be a string, got ${got(v)}`,
    );
  },

  /** Argument `i` as an integer; strings are parsed leniently. */
  int(argv: unknown[], i: number, func: string): number {
    const v = argv[i];
    if (typeof v === "number" && Number.isInteger(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.trim());
      if (v.trim() !== "" && Number.isInteger(n)) return n;
    }
    throw new LibraryError(
      `${func}: argument ${i + 1} must be an integer, got ${got(v)}`,
    );
  },

  /** Argument `i` as a float; strings are parsed leniently. */
  float(argv: unknown[], i: number, func: string): number {
    const v = argv[i];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v.trim());
      if (v.trim() !== "" && Number.isFinite(n)) return n;
    }
    throw new LibraryError(
      `${func}: argument ${i + 1} must be a number, got ${got(v)}`,
    );
  },

  /**
   * Argument `i` as an optional string — `undefined` when absent. Use for
   * trailing memo keys: `ctx.memo(args.optionalString(argv, 0) ?? "", ...)`.
   */
  optionalString(argv: unknown[], i: number): string | undefined {
    const v = argv[i];
    if (v === undefined) return undefined;
    return typeof v === "string" ? v : JSON.stringify(v);
  },
};

// ---------------------------------------------------------------------------
// Runtime-free test harness
// ---------------------------------------------------------------------------

/**
 * Call a library directly, with no WASM runtime — the unit-test harness for
 * authors. Build a {@link Ctx}, set the fields the test needs, and drive
 * calls. Memo state lives in the `Ctx`, so reuse it across calls to test
 * memo semantics; bump `ctx.messageSeq` to simulate the next message.
 *
 * ```ts
 * const ctx = new Ctx(42);
 * ctx.messageSeq = 1n;
 * assert.equal(testCall(myLib, ctx, "greet", ["world"]), "hello, world!");
 * ```
 */
export function testCall(
  lib: LibraryDefinition,
  ctx: Ctx,
  func: string,
  argv: unknown[],
): string {
  const f = lib.functions[func];
  if (!f) throw new LibraryError(`unknown function '${func}'`);
  return f.call(argv, ctx);
}

// ---------------------------------------------------------------------------
// Component export glue — used by `perfscale-library-build`; not public API.
// ---------------------------------------------------------------------------

/** The WIT `context` record as it arrives over the ABI (u64 → bigint). */
export interface WitContext {
  messageSeq: bigint;
  iterationSeq: bigint;
  vuId: bigint;
  seed: bigint;
  timeMs: bigint;
}

/** The shape the `perfscale:library/library` world expects from the guest. */
export interface ComponentExports {
  info(): string;
  init(configJson: string): void;
  call(ctx: WitContext, funcName: string, argsJson: string): string;
}

function infoJson(def: LibraryDefinition, fallbackName: string): string {
  return JSON.stringify({
    name: (def.name ?? fallbackName).replaceAll("-", "_"),
    version: def.version ?? "0.0.0",
    functions: Object.entries(def.functions).map(([name, f]) => ({
      name,
      description: f.description ?? "",
      secret: f.secret ?? false,
    })),
  });
}

/**
 * Wrap a {@link LibraryDefinition} into the WIT world's `library` export.
 * The build script generates an entry that does:
 *
 * ```js
 * import def from "./my-library.ts";
 * import { __exportLibrary } from "@perfscale/library-sdk";
 * export const library = __exportLibrary(def, "default_name");
 * ```
 *
 * @internal
 */
export function __exportLibrary(
  def: LibraryDefinition,
  fallbackName = "library",
): ComponentExports {
  // Instance state: one long-lived Ctx per component instance (memo state
  // lives here, so it must survive across calls). Components are
  // single-threaded; module scope is the instance.
  let ctx: Ctx | undefined;
  return {
    info: () => infoJson(def, fallbackName),
    init(configJson: string): void {
      const config: unknown = configJson.trim() === "" ? null : JSON.parse(configJson);
      ctx = new Ctx(0n);
      def.init?.(config);
    },
    call(wc: WitContext, funcName: string, argsJson: string): string {
      let argv: unknown;
      try {
        argv = JSON.parse(argsJson);
      } catch (e) {
        throw new LibraryError(`${funcName}: invalid args JSON: ${(e as Error).message}`);
      }
      if (!Array.isArray(argv)) {
        throw new LibraryError(`${funcName}: args JSON must be an array`);
      }
      ctx ??= new Ctx(0n);
      ctx.messageSeq = BigInt(wc.messageSeq);
      ctx.iterationSeq = BigInt(wc.iterationSeq);
      ctx.vuId = BigInt(wc.vuId);
      ctx.seed = BigInt(wc.seed);
      ctx.timeMs = BigInt(wc.timeMs);
      const f = def.functions[funcName];
      if (!f) throw new LibraryError(`unknown function '${funcName}'`);
      return f.call(argv, ctx);
    },
  };
}
