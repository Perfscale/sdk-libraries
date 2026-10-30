import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineSteps,
  StepCtx,
  StepError,
  testStep,
  __exportLibrary,
  __exportSteps,
  type StepsDefinition,
  type WitStepContext,
} from "../src/index.ts";
import echo from "../examples/steps/echo.ts";
import execSteps from "../examples/steps/exec.ts";

function witCtx(overrides: Partial<WitStepContext> = {}): WitStepContext {
  return {
    iterationSeq: 3n,
    vuId: 7n,
    timeMs: 1_700_000_000_000n,
    settingsJson: '{"vus": 2, "variables": {"env": "test"}}',
    stepName: "say",
    ...overrides,
  };
}

describe("defineSteps", () => {
  it("requires steps with run()", () => {
    assert.throws(() => defineSteps({} as never), /`steps` is required/);
    assert.throws(() => defineSteps({ steps: { bad: {} } } as never), /needs a run\(\)/);
  });

  it("accepts hyphenated step names like install-exec / exec-file", () => {
    const def = defineSteps({
      steps: {
        "install-exec": { run: () => {} },
        "exec-file": { run: () => {} },
        under_score: { run: () => {} },
      },
    });
    assert.deepEqual(Object.keys(def.steps), ["install-exec", "exec-file", "under_score"]);
    const res = testStep(def, new StepCtx(), "install-exec");
    assert.equal(res.success, true);
  });

  it("rejects invalid step names", () => {
    for (const name of ["Bad", "-leading", "1digit", "has space", "dot.name", ""]) {
      assert.throws(
        () => defineSteps({ steps: { [name]: { run: () => {} } } }),
        new RegExp(`step name '${name.replace(/[.*]/g, "\\$&")}' must match \\[a-z\\]\\[a-z0-9_-\\]\\*`),
        name,
      );
    }
  });

  it("accepts steps-only (no functions) and validates configSchema", () => {
    const def = defineSteps({ steps: { s: { run: () => {} } } });
    assert.equal(def.functions, undefined);
    assert.throws(
      () =>
        defineSteps({
          steps: { s: { run: () => {} } },
          configSchema: { key: "Bad-Key", schema: {} },
        }),
      StepError,
    );
  });
});

describe("testStep", () => {
  it("runs a step with a plain context and defaults success", () => {
    const ctx = new StepCtx();
    ctx.stepName = "say";
    const res = testStep(echo, ctx, "echo", { message: "hi" });
    assert.equal(res.success, true);
    assert.deepEqual(res.output, { message: "hi", vu: 0, iteration: 0 });
    assert.deepEqual(res.metrics, { echo_len: 2 });
  });

  it("throws for unknown steps", () => {
    assert.throws(() => testStep(echo, new StepCtx(), "nope"), /unknown step 'nope'/);
  });

  it("StepCtx.exec requires the capability, or uses the injected host exec", () => {
    const ctx = new StepCtx();
    assert.throws(() => ctx.exec({ executable: "/bin/echo" }), /process capability/);
    const withExec = new StepCtx((req) => ({
      exitCode: 0,
      stdout: `ran ${req.executable}`,
      stderr: "",
    }));
    assert.equal(withExec.exec({ executable: "/bin/true" }).stdout, "ran /bin/true");
    const res = testStep(
      execSteps,
      withExec,
      "run",
      { executable: "/bin/echo", argv: ["hello"] },
    );
    assert.equal(res.success, true);
  });

  it("StepCtx.exec adapts env Record to WIT list<tuple> pairs at the boundary", () => {
    let got: unknown;
    const withExec = new StepCtx((req) => {
      got = req;
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    withExec.exec({
      executable: "/usr/bin/which",
      argv: ["bash"],
      env: { PATH: "/bin", X: "y" },
      cwd: "/tmp",
      stdin: "in",
      timeoutMs: 5000,
    });
    // The raw host import must see entry pairs, never a Record object.
    assert.deepEqual((got as { env: unknown }).env, [["PATH", "/bin"], ["X", "y"]]);
    // Everything else passes through unchanged.
    assert.deepEqual(got, {
      executable: "/usr/bin/which",
      argv: ["bash"],
      env: [["PATH", "/bin"], ["X", "y"]],
      cwd: "/tmp",
      stdin: "in",
      timeoutMs: 5000,
    });
  });
});

describe("__exportSteps (WIT glue)", () => {
  function drive(
    def: StepsDefinition,
    ctx: WitStepContext,
    stepId: string,
    paramsJson: string,
  ) {
    return __exportSteps(def).run(ctx, stepId, paramsJson);
  }

  it("serializes the ActionOutput, snake-casing http_sample", () => {
    const def = defineSteps({
      steps: {
        hit: {
          run: () => ({
            output: { id: 1 },
            httpSample: { durationMs: 12, status: 200, failed: false },
            secretOutputPaths: ["id"],
            logs: [{ tag: "sys", line: "done" }],
          }),
        },
      },
    });
    const ret = drive(def, witCtx(), "hit", "{}");
    assert.equal(typeof ret, "string");
    assert.deepEqual(JSON.parse(ret as string), {
      success: true,
      output: { id: 1 },
      logs: [{ tag: "sys", line: "done" }],
      http_sample: { duration_ms: 12, status: 200, failed: false },
      secret_output_paths: ["id"],
    });
  });

  it("maps ctx fields (bigint, step name, frozen settings)", () => {
    let seen: StepCtx | undefined;
    const def = defineSteps({
      steps: {
        probe: {
          run(_params, ctx) {
            seen = ctx;
          },
        },
      },
    });
    const ret = drive(def, witCtx(), "probe", '{"a": 1}');
    assert.equal(JSON.parse(ret as string).success, true);
    assert.equal(seen!.iterationSeq, 3n);
    assert.equal(seen!.vuId, 7n);
    assert.equal(seen!.timeMs, 1_700_000_000_000n);
    assert.equal(seen!.stepName, "say");
    assert.equal(seen!.settings.vus, 2);
    assert.throws(() => {
      (seen!.settings.variables as Record<string, unknown>).env = "mutated";
    }, TypeError);
  });

  it("maps guest errors to the result err variant (never traps)", () => {
    const def = defineSteps({
      steps: {
        boom: {
          run() {
            throw new StepError("kaboom");
          },
        },
      },
    });
    assert.deepEqual(drive(def, witCtx(), "boom", "{}"), { tag: "err", val: "kaboom" });
    assert.deepEqual(drive(def, witCtx(), "missing", "{}"), {
      tag: "err",
      val: "unknown step 'missing'",
    });
  });

  it("rejects non-object params as err", () => {
    const ret = drive(echo, witCtx(), "echo", "[1]");
    assert.ok(typeof ret === "object" && ret.tag === "err" && /must be an object/.test(ret.val));
    const bad = drive(echo, witCtx(), "echo", "{nope");
    assert.ok(typeof bad === "object" && bad.tag === "err" && /invalid params JSON/.test(bad.val));
  });

  it("rejects invalid metric names, naming the offender", () => {
    const def = defineSteps({
      steps: {
        m: { run: () => ({ metrics: { "Bad-Name": 1 } }) },
      },
    });
    const ret = drive(def, witCtx(), "m", "{}");
    assert.ok(typeof ret === "object" && ret.tag === "err" && /'Bad-Name'/.test(ret.val));
  });

  it("passes the bound host exec through to ctx.exec", () => {
    const glue = __exportSteps(execSteps, (req) => ({
      exitCode: 3,
      stdout: req.argv?.join(" ") ?? "",
      stderr: "warn",
    }));
    const ret = glue.run(witCtx(), "run", '{"executable": "/bin/echo", "argv": ["a", "b"]}');
    assert.equal(typeof ret, "string");
    const out = JSON.parse(ret as string);
    assert.equal(out.success, false);
    assert.equal(out.output.exit_code, 3);
    assert.equal(out.output.stdout, "a b");
  });
});

describe("step component manifest", () => {
  it("info() lists steps alongside functions exactly once (combined)", () => {
    const lib = __exportLibrary(echo, "echo");
    const info = JSON.parse(lib.info());
    assert.deepEqual(info.functions, [
      { name: "shout", description: "Upper-case the argument", secret: false },
    ]);
    assert.deepEqual(info.steps, [
      { name: "echo", description: "Echo the `message` param into outputs and the log", secret: false },
    ]);
  });

  it("info() reports empty functions for a steps-only component", () => {
    const def = defineSteps({ name: "only", steps: { s: { run: () => {} } } });
    const info = JSON.parse(__exportLibrary(def).info());
    assert.deepEqual(info.functions, []);
    assert.deepEqual(info.steps, [{ name: "s", description: "", secret: false }]);
  });

  it("plain libraries keep a steps-less manifest", () => {
    const info = JSON.parse(__exportLibrary({ name: "l", functions: {} }).info());
    assert.ok(!("steps" in info));
  });
});
