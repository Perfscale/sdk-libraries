import { defineSteps } from "../../src/index.ts";

/**
 * `echo` — the example step component (RFC 009): a combined component with
 * one custom step dispatched as `lib/echo/echo` and one value function
 * `${echo.shout(...)}` (the `info()` manifest lists both).
 *
 * Build:  npm run example:build:steps
 */
export default defineSteps({
  name: "echo",
  version: "0.1.0",
  steps: {
    echo: {
      description: "Echo the `message` param into outputs and the log",
      run(params, ctx) {
        const message = String(params.message ?? "");
        return {
          output: { message, vu: Number(ctx.vuId), iteration: Number(ctx.iterationSeq) },
          logs: [{ tag: "out" as const, line: `${ctx.stepName}: ${message}` }],
          metrics: { echo_len: message.length },
        };
      },
    },
  },
  functions: {
    shout: {
      description: "Upper-case the argument",
      call(argv) {
        const v = argv[0];
        return String(v ?? "").toUpperCase();
      },
    },
  },
});
