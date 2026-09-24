import { args, defineLibrary } from "../../src/index.ts";

/**
 * `hello` — the example perfscale library. Tokens: `${hello.greet(world)}`,
 * `${hello.token()}` (a deterministic per-instance token from the seeded PRNG;
 * pass a memo key, e.g. `${hello.token(order)}`, to reuse it within one
 * message).
 */
export default defineLibrary({
  name: "hello",
  version: "0.1.0",
  init(config) {
    if (config !== null && (typeof config !== "object" || Array.isArray(config))) {
      throw new Error("hello: `with:` config must be a mapping");
    }
  },
  functions: {
    greet: {
      description: "Say hello: greet(name) → `hello, <name>!`",
      call(argv) {
        return `hello, ${args.string(argv, 0, "hello.greet")}!`;
      },
    },
    token: {
      description:
        "Deterministic token from the seeded PRNG; optional memo key reuses it within one message",
      call(argv, ctx) {
        const mint = () => `tok-${ctx.rng().nextU64().toString(16)}`;
        const key = args.optionalString(argv, 0);
        return key === undefined ? mint() : ctx.memo(key, mint);
      },
    },
  },
});
