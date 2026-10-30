//! Custom WASM steps (RFC 009) — author-facing API.
//!
//! A step component is a perfscale library (RFC 005) whose `info()` manifest
//! additionally lists `steps`; each step becomes dispatchable from a test's
//! `use:` slot as `lib/<alias>/<step>` and returns a serialized `ActionOutput`
//! (RFC 008). The ABI contract (`perfscale:step@0.1.0`) is
//! [`wit/step/step.wit`](../wit/step/step.wit).
//!
//! Build with `perfscale-library-build --kind steps entry.ts -o s.wasm`
//! (add `--process` for the `process` capability) and reference from YAML:
//!
//! ```yaml
//! libraries:
//!   - use: ./s.wasm
//!     capabilities: []
//! steps:
//!   - name: prepare
//!     use: lib/s/prepare
//!     with: { path: /tmp/data }
//! ```

import {
  EMPTY_SETTINGS,
  parseRunSettings,
  type LibraryDefinition,
  type RunSettings,
} from "./index.ts";

/** Step error: the message the engine surfaces as the step failure cause. */
export class StepError extends Error {}

// ---------------------------------------------------------------------------
// Step context
// ---------------------------------------------------------------------------

/**
 * The context every step invocation receives (RFC 009 `step-context`): the
 * library call context minus the value-generation fields (`messageSeq`,
 * `seed` — a step is not a token), plus the step's identity. `u64` ABI
 * fields are exposed as `bigint`. One-shot `before:`/`after:` steps run with
 * `vuId`/`iterationSeq` = 0.
 */
export class StepCtx {
  /** VU loop iteration (0 in `before:`/`after:`). */
  iterationSeq: bigint = 0n;
  /** Virtual-user id (0 in `before:`/`after:`). */
  vuId: bigint = 0n;
  /** Wall clock, unix milliseconds — the only time source a step gets. */
  timeMs: bigint = 0n;
  /** The YAML step's `name:` (for log lines). */
  stepName: string = "";
  /**
   * The run's settings, frozen once at run start — same shape as the library
   * context's `settings`. Identical for every invocation of the run.
   */
  settings: RunSettings = EMPTY_SETTINGS;

  /**
   * The bound host `exec` function (`process` capability), or `undefined`
   * when the component was not built with `--process` (or the harness was
   * not given a fake). Only ever the WIT host import — Node's
   * `child_process` does not exist inside the component.
   */
  #exec: HostExec | undefined;

  /** A fresh context for unit tests / harness use (see {@link testStep}). */
  constructor(exec?: HostExec) {
    this.#exec = exec;
  }

  /**
   * Run a host process (RFC 009 "process" capability): one explicit,
   * bounded, host-mediated spawn — no shell, a replacement environment, a
   * timeout the host caps. Requires the component to declare
   * `capabilities: [process]` AND the run config to set
   * `allow_process_actions: true` (plus the `allow_library_capabilities`
   * gate); otherwise the host refuses to even load the component. Throws
   * {@link StepError} when the capability is not connected.
   */
  exec(request: ExecRequest): ExecResult {
    if (!this.#exec) {
      throw new StepError(
        "exec: the process capability is not connected — build with `--process` " +
          "and grant `capabilities: [process]` + `allow_process_actions: true`",
      );
    }
    // WIT boundary adaptation: the ABI's `env` is `list<tuple<string,
    // string>>` — componentize-js passes values through verbatim, so the
    // ergonomic public Record must become entry pairs here. argv/stdin/cwd/
    // timeoutMs pass through unchanged (camelCase ↔ kebab-case is the
    // binding generator's job, not ours).
    return this.#exec({
      executable: request.executable,
      argv: request.argv,
      env: Object.entries(request.env ?? {}),
      cwd: request.cwd,
      stdin: request.stdin,
      timeoutMs: request.timeoutMs,
    });
  }
}

// ---------------------------------------------------------------------------
// Host process (perfscale:step/host-exec)
// ---------------------------------------------------------------------------

/** One host-mediated spawn (RFC 009 `exec-request`). */
export interface ExecRequest {
  /** Program to spawn (resolved against the host PATH or absolute). */
  executable: string;
  /** Arguments, passed through verbatim (no shell). */
  argv?: string[];
  /**
   * The child's FULL environment — host variables are never inherited.
   * Default empty.
   */
  env?: Record<string, string>;
  /** Working directory; host default when absent. */
  cwd?: string;
  /** Bytes piped to the child's stdin; closed immediately when absent. */
  stdin?: string;
  /** Wall-clock budget in ms; absent/0 → host default (30s, host-capped). */
  timeoutMs?: number | bigint;
}

/** The spawn's outcome (RFC 009 `exec-result`). */
export interface ExecResult {
  /** Process exit code; -1 when the child died by signal. */
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * The raw WIT `exec-request` as the host import expects it: identical to
 * {@link ExecRequest} except `env` is entry pairs (the ABI's
 * `list<tuple<string, string>>`), not a Record. {@link StepCtx.exec} adapts
 * the public shape to this one; test fakes receive it.
 */
export interface WitExecRequest {
  executable: string;
  argv?: string[] | undefined;
  env?: [string, string][] | undefined;
  cwd?: string | undefined;
  stdin?: string | undefined;
  timeoutMs?: number | bigint | undefined;
}

/**
 * The bound WIT host import `perfscale:step/host-exec.exec`, as handed to
 * {@link __exportSteps} by the generated wrapper. The SDK never shells out
 * itself: this is the only way a component reaches a process.
 */
export type HostExec = (request: WitExecRequest) => ExecResult;

// ---------------------------------------------------------------------------
// Step results (ActionOutput, RFC 008)
// ---------------------------------------------------------------------------

/** One captured log line. */
export interface StepLog {
  tag: "out" | "err" | "sys";
  line: string;
}

/** One HTTP sample for the engine's request metrics. */
export interface HttpSample {
  durationMs: number;
  status: number;
  failed: boolean;
}

/**
 * What a step returns (serialized as the RFC 008 `ActionOutput`). `success`
 * defaults to `true`; `output` is stored under the step's `outputs:`;
 * `secretOutputPaths` names output keys the engine log-masks.
 */
export interface StepResult {
  success?: boolean;
  output?: unknown;
  logs?: StepLog[];
  /** Custom series: `name → value` or `name → [ms, …]`; `[a-z0-9_]` only. */
  metrics?: Record<string, number | number[]>;
  httpSample?: HttpSample;
  secretOutputPaths?: string[];
}

// ---------------------------------------------------------------------------
// Author-facing definition
// ---------------------------------------------------------------------------

/** One exported step, as reported by `info()` under `steps`. */
export interface StepDef {
  /** One-line description for docs/lint output. */
  description?: string;
  /**
   * Invoke the step with its `with:` block (`${{ }}` interpolation already
   * applied by the host). Return a {@link StepResult} (or nothing for a
   * bare success); throw {@link StepError} (or any `Error`) to fail the step.
   */
  run(params: Record<string, unknown>, ctx: StepCtx): StepResult | void;
}

/**
 * The step-library definition passed to {@link defineSteps}: a full
 * {@link LibraryDefinition} (its `info()` is the single manifest for both
 * functions and steps) plus `steps`. `functions` may be empty for a
 * steps-only component.
 */
export interface StepsDefinition extends Omit<LibraryDefinition, "functions"> {
  /** Value functions, keyed as in {@link LibraryDefinition}; may be empty. */
  functions?: LibraryDefinition["functions"];
  /**
   * Exported steps, keyed by the name used in `lib/<alias>/<step>`. Names
   * match `[a-z][a-z0-9_-]*` (hyphens allowed — unlike token aliases, step
   * names are never parsed as identifiers).
   */
  steps: Record<string, StepDef>;
}

/**
 * Define a perfscale step library. The result is the default export of your
 * entry; the build wires it to the `perfscale-steps*` worlds.
 */
export function defineSteps(def: StepsDefinition): StepsDefinition {
  if (!def.steps || typeof def.steps !== "object") {
    throw new StepError("defineSteps: `steps` is required");
  }
  for (const [name, s] of Object.entries(def.steps)) {
    // Hyphens are allowed: step names only ever appear as manifest strings
    // and in `lib/<alias>/<step>` refs — unlike token aliases and
    // configSchema keys, they are never parsed as identifiers.
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      throw new StepError(`defineSteps: step name '${name}' must match [a-z][a-z0-9_-]*`);
    }
    if (typeof s?.run !== "function") {
      throw new StepError(`defineSteps: step '${name}' needs a run()`);
    }
  }
  for (const [name, f] of Object.entries(def.functions ?? {})) {
    if (typeof f?.call !== "function") {
      throw new StepError(`defineSteps: function '${name}' needs a call()`);
    }
  }
  if (def.configSchema !== undefined) {
    if (!/^[a-z][a-z0-9_]*$/.test(def.configSchema.key)) {
      throw new StepError(
        `defineSteps: configSchema key '${def.configSchema.key}' must match [a-z][a-z0-9_]*`,
      );
    }
    if (typeof def.configSchema.schema !== "object" || def.configSchema.schema === null) {
      throw new StepError("defineSteps: configSchema.schema must be a JSON Schema object");
    }
  }
  return def;
}

// ---------------------------------------------------------------------------
// Result normalization (StepResult → ActionOutput JSON)
// ---------------------------------------------------------------------------

const METRIC_NAME = /^[a-z0-9_]+$/;

/** Serialize a {@link StepResult} to the RFC 008 `ActionOutput` JSON. */
function toActionOutput(res: StepResult | void): string {
  const r = res ?? {};
  const out: Record<string, unknown> = { success: r.success ?? true };
  if (r.output !== undefined) out.output = r.output;
  if (r.logs !== undefined) out.logs = r.logs;
  if (r.metrics !== undefined) {
    for (const name of Object.keys(r.metrics)) {
      if (!METRIC_NAME.test(name)) {
        throw new StepError(
          `invalid metric name '${name}' — must be lowercase [a-z0-9_] and not engine-reserved`,
        );
      }
    }
    out.metrics = r.metrics;
  }
  if (r.httpSample !== undefined) {
    out.http_sample = {
      duration_ms: r.httpSample.durationMs,
      status: r.httpSample.status,
      failed: r.httpSample.failed,
    };
  }
  if (r.secretOutputPaths !== undefined) out.secret_output_paths = r.secretOutputPaths;
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Runtime-free test harness
// ---------------------------------------------------------------------------

/**
 * Run a step directly, with no WASM runtime — the unit-test harness for
 * authors. Build a {@link StepCtx}, set the fields the test needs, and drive
 * invocations. `params` is the step's `with:` block. Pass a fake
 * {@link HostExec} to the `StepCtx` constructor to test `process` steps.
 *
 * ```ts
 * const ctx = new StepCtx();
 * const res = testStep(mySteps, ctx, "greet", { name: "world" });
 * assert.equal(res.success, true);
 * ```
 */
export function testStep(
  def: StepsDefinition,
  ctx: StepCtx,
  stepName: string,
  params: Record<string, unknown> = {},
): StepResult & { success: boolean } {
  const s = def.steps[stepName];
  if (!s) throw new StepError(`unknown step '${stepName}'`);
  const res = s.run(params, ctx);
  return { ...(res ?? {}), success: res?.success ?? true };
}

// ---------------------------------------------------------------------------
// Component export glue — used by `perfscale-library-build --kind steps`;
// not public API.
// ---------------------------------------------------------------------------

/** The WIT `step-context` record as it arrives over the ABI (u64 → bigint). */
export interface WitStepContext {
  iterationSeq: bigint;
  vuId: bigint;
  timeMs: bigint;
  settingsJson: string;
  stepName: string;
}

/** The shape the `perfscale:step/step` export expects from the guest. */
export interface StepComponentExports {
  /**
   * The `ok` payload is the serialized `ActionOutput`; an object
   * `{ tag: "err", val }` maps to the `err` variant of the WIT `result`
   * (a thrown `Error` would trap instead — see `__exportReporter`), so guest
   * failures are returned, never thrown.
   */
  run(
    ctx: WitStepContext,
    stepId: string,
    paramsJson: string,
  ): string | { tag: "err"; val: string };
}

/**
 * Wrap a {@link StepsDefinition} into the WIT world's `step` export.
 * `hostExec` is the bound host import `perfscale:step/host-exec.exec`,
 * wired up by the generated wrapper for `--process` builds:
 *
 * ```js
 * import def from "./my-steps.ts";
 * import { __exportLibrary, __exportSteps } from "@perfscale/library-sdk";
 * import { exec } from "perfscale:step/host-exec@0.1.0";   // --process only
 * export const library = __exportLibrary(def, "default_name");
 * export const step = __exportSteps(def, exec);
 * ```
 *
 * The `library` export carries the manifest — `info()` lists `steps`
 * alongside `functions` exactly once (see `__exportLibrary`).
 *
 * @internal
 */
export function __exportSteps(def: StepsDefinition, hostExec?: HostExec): StepComponentExports {
  const fail = (e: unknown): { tag: "err"; val: string } => ({
    tag: "err",
    val: e instanceof Error ? e.message : String(e),
  });
  // settings-json is frozen at run start, so the string is identical on
  // every call — parse once per unique string.
  let settingsRaw: string | undefined;
  let settingsParsed: RunSettings = EMPTY_SETTINGS;
  return {
    run(wc: WitStepContext, stepId: string, paramsJson: string) {
      let params: unknown;
      try {
        params = paramsJson.trim() === "" ? {} : JSON.parse(paramsJson);
        if (params === null || typeof params !== "object" || Array.isArray(params)) {
          throw new StepError(`step '${stepId}': params JSON must be an object`);
        }
      } catch (e) {
        return fail(e instanceof SyntaxError
          ? new StepError(`step '${stepId}': invalid params JSON: ${e.message}`)
          : e);
      }
      const s = def.steps[stepId];
      if (!s) return fail(new StepError(`unknown step '${stepId}'`));
      const sj = wc.settingsJson ?? "{}";
      if (sj !== settingsRaw) {
        try {
          settingsParsed = parseRunSettings(sj);
        } catch (e) {
          return fail(e);
        }
        settingsRaw = sj;
      }
      const ctx = new StepCtx(hostExec);
      ctx.iterationSeq = BigInt(wc.iterationSeq);
      ctx.vuId = BigInt(wc.vuId);
      ctx.timeMs = BigInt(wc.timeMs);
      ctx.stepName = wc.stepName;
      ctx.settings = settingsParsed;
      try {
        return toActionOutput(s.run(params as Record<string, unknown>, ctx));
      } catch (e) {
        return fail(e);
      }
    },
  };
}
