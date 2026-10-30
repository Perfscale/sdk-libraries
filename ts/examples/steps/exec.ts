import { defineSteps } from "../../src/index.ts";

/**
 * `exec` — the `process`-capability example (RFC 009): steps that run host
 * processes through the bounded host import (`ctx.exec`). No shell, a
 * replacement environment, a host-capped timeout — and the component only
 * loads when the YAML grants the capability twice over:
 * `capabilities: [process]` on the library entry AND
 * `allow_process_actions: true` (plus `allow_library_capabilities: true`)
 * in the run config. See exec.test.yaml / exec.config.yaml.
 *
 * Build:  npm run example:build:exec   (note the `--process` flag)
 */
export default defineSteps({
  name: "exec",
  version: "0.1.0",
  steps: {
    run: {
      description: "Spawn `executable` once; fail the step on a non-zero exit",
      run(params, ctx) {
        const executable = String(params.executable ?? "");
        if (executable === "") throw new Error("exec.run: `executable` param is required");
        const argv = Array.isArray(params.argv) ? params.argv.map(String) : [];
        const res = ctx.exec({
          executable,
          argv,
          env: { PERFSCALE_STEP: ctx.stepName },
          timeoutMs: 10_000,
        });
        return {
          success: res.exitCode === 0,
          output: { exit_code: res.exitCode, stdout: res.stdout },
          logs: [
            { tag: "out" as const, line: res.stdout.trimEnd() },
            ...(res.stderr === "" ? [] : [{ tag: "err" as const, line: res.stderr.trimEnd() }]),
          ],
        };
      },
    },
  },
});
