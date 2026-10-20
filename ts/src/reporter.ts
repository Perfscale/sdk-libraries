//! WASM end-of-run reporters (issue #9) — author-facing API.
//!
//! A reporter is a WASM component implementing `perfscale:reporter@0.1.0`
//! (`wit/reporter/reporter.wit`): the engine calls `onReport` once at the
//! end of the run with the canonical `report@v1` document and the
//! reporter's own `with.config` block. Output files are written exclusively
//! through `emit(name, contents)` — the host confines them to the
//! reporter's output directory (`with.output`).
//!
//! Build with `perfscale-library-build --kind reporter entry.ts -o r.wasm`
//! and reference from YAML:
//!
//! ```yaml
//! report:
//!   reporters:
//!     - use: wasm:./r.wasm
//!       with:
//!         output: ./reports
//!         config: { style: short }
//! ```

import type { ReportV1 } from "./report.ts";

/** Reporter error: the message the engine logs as the reporter failure. */
export class ReporterError extends Error {}

/**
 * The `emit` channel handed to {@link ReporterDefinition.onReport}: write
 * `contents` to the file `name` inside the reporter's output directory.
 * `name` must be a relative, traversal-safe path (no absolute paths, no
 * `..`, no `\`); the host rejects anything else by throwing.
 */
export type EmitFile = (name: string, contents: string) => void;

/** The reporter definition passed to {@link defineReporter}. */
export interface ReporterDefinition {
  /** Reporter name — free-form metadata, defaults to the entry basename. */
  name?: string;
  /**
   * Called once at end of run. `report` is the parsed `report@v1` document;
   * `config` is the reporter's `with.config` block (or `{}`). Return a
   * human-readable one-line summary (the engine logs it); throw
   * {@link ReporterError} (or any `Error`) to report a failure — the run's
   * exit code is never affected.
   */
  onReport(report: ReportV1, config: unknown, emit: EmitFile): string | void;
}

/** Define a perfscale reporter. The result is the default export of your entry. */
export function defineReporter(def: ReporterDefinition): ReporterDefinition {
  if (typeof def?.onReport !== "function") {
    throw new ReporterError("defineReporter: `onReport` is required");
  }
  return def;
}

// ---------------------------------------------------------------------------
// Component export glue — used by `perfscale-library-build --kind reporter`;
// not public API.
// ---------------------------------------------------------------------------

/** The shape the `perfscale:reporter/reporter` world expects from the guest. */
export interface ReporterComponentExports {
  /**
   * componentize-js maps a plain return value to `ok` and an object
   * `{ tag: "err", val }` to the `err` variant of the WIT `result`
   * (a thrown `Error` would trap instead — `getErrorPayload` re-throws
   * `instanceof Error`), so guest failures are returned, never thrown.
   */
  onReport(reportJson: string, configJson: string): string | { tag: "err"; val: string };
}

/**
 * Wrap a {@link ReporterDefinition} into the WIT world's `reporter` export.
 * `emitFile` is the host import `perfscale:reporter/host.emit-file`, wired
 * up by the generated wrapper:
 *
 * ```js
 * import def from "./my-reporter.ts";
 * import { __exportReporter } from "@perfscale/library-sdk";
 * import { emitFile } from "perfscale:reporter/host@0.1.0";
 * export const reporter = __exportReporter(def, emitFile);
 * ```
 *
 * @internal
 */
export function __exportReporter(
  def: ReporterDefinition,
  emitFile: (name: string, contents: string) => void,
): ReporterComponentExports {
  const fail = (e: unknown): { tag: "err"; val: string } => ({
    tag: "err",
    val: e instanceof Error ? e.message : String(e),
  });
  return {
    onReport(reportJson: string, configJson: string) {
      let report: ReportV1;
      let config: unknown;
      try {
        report = JSON.parse(reportJson) as ReportV1;
        config = configJson.trim() === "" ? {} : JSON.parse(configJson);
      } catch (e) {
        return fail(e);
      }
      if (report?.schemaVersion !== "report@v1") {
        return fail(
          new ReporterError(
            `expected a report@v1 document, got schemaVersion ${JSON.stringify(report?.schemaVersion)}`,
          ),
        );
      }
      try {
        const summary = def.onReport(report, config, emitFile);
        return typeof summary === "string" ? summary : "";
      } catch (e) {
        return fail(e);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime-free test harness
// ---------------------------------------------------------------------------

/**
 * Run a reporter directly, with no WASM runtime — the unit-test harness for
 * authors. `emit` writes land in the returned `files` map:
 *
 * ```ts
 * const { summary, files } = testReport(myReporter, report, { style: "short" });
 * assert.ok(files["summary.txt"].includes("http"));
 * ```
 */
export function testReport(
  def: ReporterDefinition,
  report: ReportV1,
  config: unknown = {},
): { summary: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const emit: EmitFile = (name, contents) => {
    if (name === "" || name.includes("\\") || name.split("/").some((p) => p === "" || p === ".." || p === ".")) {
      throw new ReporterError(`emit: '${name}' is not a safe relative path`);
    }
    files[name] = contents;
  };
  const summary = def.onReport(report, config, emit);
  return { summary: typeof summary === "string" ? summary : "", files };
}
