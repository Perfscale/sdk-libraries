//! The canonical `report@v1` document (issue #9) — hand-written mirror of
//! `crates/perfscale-core/src/report/v1.rs` in the main perfscale repo.
//!
//! `report@v1` is a public, stable contract: evolution is additive-only
//! within the major version. All duration values are **seconds**.

/** The canonical run report, as handed to a reporter's `onReport`. */
export interface ReportV1 {
  /** Always `"report@v1"`. */
  schemaVersion: "report@v1";
  run: RunIdentity;
  /** Per-step aggregates, in the test's declaration order. Omitted when empty. */
  steps?: StepReport[];
  /** Threshold/SLO verdicts: every evaluated expression, pass or fail. Omitted when empty. */
  verdicts?: Verdict[];
  /** Every registered metric family, recorded or not. Omitted when empty. */
  metrics?: MetricFamilyReport[];
  /** Reserved for future streaming snapshots; always `null` here. */
  seq: number | null;
  /** Reserved for future streaming snapshots; always empty here. */
  samples: unknown[];
}

/** Run identity: engine-generated `run_id` plus user labels. */
export interface RunIdentity {
  run_id: string;
  /** Engine that ran the test: `"native"`, `"k6"`, `"locust"`, `"jmeter"`. */
  engine: string;
  /** perfscale version that produced the report. */
  perfscale_version: string;
  /** Virtual users; absent where the load shape lives outside the CLI. */
  vus?: number;
  /** Run start, UTC ISO 8601. */
  started_at: string;
  /** Wall-clock run length, seconds. */
  duration_s: number;
  /** User labels (config `report.labels` / CLI `--label`). */
  labels?: Record<string, unknown>;
}

/** Per-step aggregates. Duration values are seconds. */
export interface StepReport {
  /** Step `name:`, or the action id when the step has no name. */
  name: string;
  /** Action id, e.g. `std/http@v1`. */
  action: string;
  /** Invocations over the whole run. */
  count: number;
  /** Failed invocations. */
  failed: number;
  /** Invocations per second of wall-clock run time. */
  rate: number;
  duration: DurationAgg;
  /** Raw duration samples (seconds), present when the reporter opted in. */
  samples?: RawSamples;
}

/** Quantile block for a step (or a sample-kind series). Seconds. */
export interface DurationAgg {
  avg: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

/** Raw samples block: included values plus the truncation marker. */
export interface RawSamples {
  /** Included duration samples, seconds, in record order. */
  values: number[];
  /** True when the step recorded more samples than `values` holds. */
  truncated: boolean;
  /** Total samples recorded (including any dropped past the cap). */
  recorded: number;
}

/** One threshold verdict: an expression, its outcome, the observed value. */
export interface Verdict {
  /** The metric the expression evaluated over, e.g. `http_req_duration`. */
  threshold: string;
  /** The expression as written, e.g. `p95<500`. */
  expression: string;
  pass: boolean;
  /** The aggregate's actual value. */
  observed: number;
}

/** One metric family: registry metadata plus its recorded series. */
export interface MetricFamilyReport {
  name: string;
  /** Owning family (`http`, `llm`, …), `custom` for unregistered names. */
  family: string;
  /** `sample` | `counter` | `rate` | `gauge`. */
  kind: string;
  unit: string;
  description: string;
  /** False when the family was declared but nothing was recorded. */
  recorded: boolean;
  /** Omitted when empty. */
  series?: MetricSeries[];
}

/**
 * One series of a family: a `(labels, value)` pair. Which fields are set
 * depends on the family kind (see the engine's report@v1 docs).
 */
export interface MetricSeries {
  labels?: Record<string, unknown>;
  quantiles?: Record<string, number>;
  count?: number;
  sum?: number;
  value?: number;
  total?: number;
  failed?: number;
  ts?: string;
}
