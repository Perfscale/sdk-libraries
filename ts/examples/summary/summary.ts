import { defineReporter } from "../../src/index.ts";

/**
 * `summary` — the example perfscale WASM reporter. At the end of the run it
 * writes a human-readable `summary.txt` (run identity, per-step aggregates,
 * threshold verdicts) into its output directory via the host's `emit-file`.
 *
 * Build:  npm run example:build:reporter
 * Use:    report: { reporters: [{ use: wasm:./summary.wasm }] }
 */
export default defineReporter({
  name: "summary",
  onReport(report, _config, emit) {
    const steps = report.steps ?? [];
    const verdicts = report.verdicts ?? [];
    const lines = [
      `run ${report.run.run_id} (${report.run.engine}, ${report.run.duration_s}s)`,
      ...steps.map(
        (s) =>
          `${s.name}: ${s.count} calls, ${s.failed} failed, p95 ${(s.duration.p95 * 1000).toFixed(1)}ms`,
      ),
      ...verdicts.map(
        (v) =>
          `${v.pass ? "PASS" : "FAIL"} ${v.threshold} ${v.expression} (observed ${v.observed})`,
      ),
    ];
    emit("summary.txt", lines.join("\n") + "\n");
    const failed = verdicts.filter((v) => !v.pass).length;
    return `${steps.length} step(s), ${failed} failed verdict(s)`;
  },
});
