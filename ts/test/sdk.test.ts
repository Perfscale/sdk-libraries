import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  args,
  Ctx,
  defineLibrary,
  LibraryError,
  Prng,
  testCall,
  __exportLibrary,
} from "../src/index.ts";

describe("Prng", () => {
  it("matches the Rust SDK / engine xorshift64 sequence for seed 42", () => {
    // Cross-checked against crates/perfscale-library-sdk Prng::new(42).
    const expected = [
      46537075435n,
      12685210767805585150n,
      1156789259011059539n,
      15956110530553476429n,
      14455781104615785191n,
    ];
    const p = new Prng(42);
    for (const e of expected) assert.equal(p.nextU64(), e);
    const q = new Prng(42);
    const r = new Prng(42);
    for (let i = 0; i < 100; i++) assert.equal(q.nextU64(), r.nextU64());
  });

  it("forces a zero seed non-zero", () => {
    const p = new Prng(0);
    assert.notEqual(p.nextU64(), 0n);
  });

  it("helpers stay in range", () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      assert.ok(p.below(10) < 10n);
      const r = p.range(-5, 5);
      assert.ok(r >= -5n && r <= 5n, `${r}`);
      const f = p.f64();
      assert.ok(f >= 0 && f < 1, `${f}`);
    }
    assert.equal(p.below(0), 0n);
    assert.equal(p.range(3, 3), 3n);
  });
});

const memoLib = defineLibrary({
  name: "memo",
  functions: {
    id: {
      description: "memoized counter",
      call(_args, ctx) {
        return ctx.memo("k", (c) => c.rng().nextU64().toString());
      },
    },
  },
});

describe("Ctx.memo", () => {
  it("repeats within a message and clears between", () => {
    const ctx = new Ctx(1);
    ctx.messageSeq = 1n;
    let n = 0;
    const next = () => String(++n);
    const a = ctx.memo("k", next);
    assert.equal(ctx.memo("k", next), a);
    assert.notEqual(ctx.memo("other", next), a);
    ctx.messageSeq = 2n;
    assert.notEqual(ctx.memo("k", next), a);
  });
});

describe("testCall", () => {
  it("drives the definition directly, with memo semantics", () => {
    const ctx = new Ctx(9);
    ctx.messageSeq = 1n;
    const a = testCall(memoLib, ctx, "id", []);
    assert.equal(testCall(memoLib, ctx, "id", []), a);
    ctx.messageSeq = 2n;
    assert.notEqual(testCall(memoLib, ctx, "id", []), a);
  });

  it("throws on unknown functions", () => {
    assert.throws(() => testCall(memoLib, new Ctx(1), "nope", []), LibraryError);
  });

  it("passes args through", () => {
    const lib = defineLibrary({
      functions: {
        greet: { call: (a) => `hello, ${args.string(a, 0, "greet")}!` },
      },
    });
    assert.equal(testCall(lib, new Ctx(0), "greet", ["world"]), "hello, world!");
  });
});

describe("args helpers", () => {
  const v: unknown[] = ["42", 2.5, true];
  it("convert and err", () => {
    assert.equal(args.string(v, 0, "f"), "42");
    assert.equal(args.int(v, 0, "f"), 42);
    assert.equal(args.float(v, 1, "f"), 2.5);
    assert.throws(() => args.string(v, 2, "f"), LibraryError);
    assert.throws(() => args.int(v, 5, "f"), /argument 6/);
    assert.equal(args.optionalString(v, 1), "2.5");
    assert.equal(args.optionalString(v, 9), undefined);
  });
});

describe("__exportLibrary (component glue)", () => {
  const witCtx = {
    messageSeq: 1n,
    iterationSeq: 0n,
    vuId: 0n,
    seed: 42n,
    timeMs: 0n,
  };

  it("info() emits the metadata JSON", () => {
    const c = __exportLibrary(
      defineLibrary({
        name: "my-lib",
        version: "1.2.3",
        functions: { tok: { description: "d", secret: true, call: () => "x" } },
      }),
    );
    assert.deepEqual(JSON.parse(c.info()), {
      name: "my_lib", // dashes → underscores (alias must be [a-z][a-z0-9_]*)
      version: "1.2.3",
      functions: [{ name: "tok", description: "d", secret: true }],
    });
  });

  it("init + call round-trip with memo across calls", () => {
    const c = __exportLibrary(memoLib);
    c.init("{}");
    const a = c.call(witCtx, "id", "[]");
    assert.equal(c.call(witCtx, "id", "[]"), a);
    assert.notEqual(c.call({ ...witCtx, messageSeq: 2n }, "id", "[]"), a);
  });

  it("init rejects invalid JSON", () => {
    const c = __exportLibrary(memoLib);
    assert.throws(() => c.init("{"));
  });
});
