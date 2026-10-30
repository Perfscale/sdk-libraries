// Build-mode selection for perfscale-library-build, factored out so tests
// can pin the world/WIT mapping without spawning jco.

/**
 * Pick the WIT dir, package file and world for a build.
 *
 * - `library`   → wit/ (library.wit), world `perfscale-library`
 *                 (`-config` when the entry declares `configSchema`)
 * - `reporter`  → wit/reporter (reporter.wit), world `perfscale-reporter`
 * - `steps`     → wit/step (step.wit), world `perfscale-steps`
 *                 (`-config` / `-exec` / `-config-exec` variants)
 *
 * `process: true` (the CLI's `--process`) grants the RFC 009 "process"
 * capability: it selects the `-exec` world whose `host-exec` import the
 * generated wrapper binds. It is only valid for `--kind steps`.
 */
export function selectBuild({ kind, process: proc = false, hasConfigSchema = false }) {
  if (proc && kind !== "steps") {
    throw new Error(`--process requires --kind steps, got --kind ${kind}`);
  }
  switch (kind) {
    case "library":
      return {
        witSubdir: "wit",
        witFile: "library.wit",
        worldName: hasConfigSchema ? "perfscale-library-config" : "perfscale-library",
        hostExecImport: null,
      };
    case "reporter":
      return {
        witSubdir: "wit/reporter",
        witFile: "reporter.wit",
        worldName: "perfscale-reporter",
        hostExecImport: null,
      };
    case "steps":
      return {
        witSubdir: "wit/step",
        witFile: "step.wit",
        worldName:
          "perfscale-steps" + (hasConfigSchema ? "-config" : "") + (proc ? "-exec" : ""),
        // The generated wrapper imports the bound host exec function from
        // this builtin module (version parsed from the WIT package line).
        hostExecImport: proc ? "perfscale:step/host-exec" : null,
      };
    default:
      throw new Error(`--kind must be 'library', 'reporter' or 'steps', got '${kind}'`);
  }
}
