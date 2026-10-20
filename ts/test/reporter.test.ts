import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineReporter,
  ReporterError,
  testReport,
  __exportReporter,
  type ReportV1,
} from "../src/index.ts";
import summaryReporter from "../examples/summary/summary.ts";

function report(overrides: Partial<ReportV1> = {}): ReportV1 {
  return {
    schemaVersion: "report@v1",
    run: {
      run_id: "run-1",
      engine: "native",
      perfscale_version: "0.0.0-test",
      started_at: "2026-10-20T00:00:00Z",
      duration_s: 5,
    },
    seq: null,
    samples: [],
    ...overrides,
  };
}

describe("defineReporter", () => {
  it("requires onReport", () => {
    assert.throws(() => defineReporter({} as never), /onReport/);
  });

  it("runs against the test harness, collecting emitted files", () => {
    const r = report({
      steps: [
        {
          name: "hit",
          action: "std/http@v1",
          count: 10,
          failed: 2,
          rate: 2,
          duration: { avg: 0.1, min: 0.05, p50: 0.09, p90: 0.2, p95: 0.25, p99: 0.3, max: 0.4 },
        },
      ],
      verdicts: [{ threshold: "http_req_failed", expression: "rate<0.05", pass: false, observed: 0.2 }],
    });
    const { summary, files } = testReport(summaryReporter, r, {});
    assert.equal(summary, "1 step(s), 1 failed verdict(s)");
    assert.match(files["summary.txt"] ?? "", /run run-1/);
    assert.match(files["summary.txt"] ?? "", /hit: 10 calls, 2 failed/);
    assert.match(files["summary.txt"] ?? "", /FAIL http_req_failed/);
  });

  it("tolerates omitted steps/verdicts (empty arrays are elided on the wire)", () => {
    const { summary, files } = testReport(summaryReporter, report());
    assert.equal(summary, "0 step(s), 0 failed verdict(s)");
    assert.ok(files["summary.txt"]);
  });

  it("testReport rejects traversal names like the host does", () => {
    const bad = defineReporter({
      onReport(_r, _c, emit) {
        emit("../evil.txt", "x");
      },
    });
    assert.throws(() => testReport(bad, report()), /not a safe relative path/);
  });
});

describe("__exportReporter (WIT glue)", () => {
  function drive(def: Parameters<typeof __exportReporter>[0], reportJson: string, configJson = "{}") {
    const files: Record<string, string> = {};
    const glue = __exportReporter(def, (name, contents) => {
      files[name] = contents;
    });
    const ret = glue.onReport(reportJson, configJson) as
      | string
      | { tag: "err"; val: string };
    return { ret, files };
  }

  it("returns a plain string for ok", () => {
    const { ret, files } = drive(summaryReporter, JSON.stringify(report()));
    assert.equal(ret, "0 step(s), 0 failed verdict(s)");
    assert.ok(files["summary.txt"]);
  });

  it("maps guest errors to the result err variant (never traps)", () => {
    const failing = defineReporter({
      onReport() {
        throw new ReporterError("boom");
      },
    });
    const { ret } = drive(failing, JSON.stringify(report()));
    assert.deepEqual(ret, { tag: "err", val: "boom" });
  });

  it("rejects a non-report@v1 document as err", () => {
    const { ret } = drive(summaryReporter, JSON.stringify({ schemaVersion: "nope" }));
    assert.ok(typeof ret === "object" && ret.tag === "err" && /report@v1/.test(ret.val));
  });

  it("parses the config block", () => {
    let seen: unknown;
    const def = defineReporter({
      onReport(_r, config) {
        seen = config;
      },
    });
    drive(def, JSON.stringify(report()), '{"style":"short"}');
    assert.deepEqual(seen, { style: "short" });
  });
});
