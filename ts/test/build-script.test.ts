import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error plain JS module, no type declarations
import { selectBuild } from "../bin/select-build.mjs";

describe("perfscale-library-build mode selection", () => {
  it("library and reporter kinds keep their existing mapping", () => {
    assert.deepEqual(selectBuild({ kind: "library" }), {
      witSubdir: "wit",
      witFile: "library.wit",
      worldName: "perfscale-library",
      hostExecImport: null,
    });
    assert.deepEqual(selectBuild({ kind: "library", hasConfigSchema: true }).worldName,
      "perfscale-library-config");
    assert.deepEqual(selectBuild({ kind: "reporter" }), {
      witSubdir: "wit/reporter",
      witFile: "reporter.wit",
      worldName: "perfscale-reporter",
      hostExecImport: null,
    });
  });

  it("--kind steps selects perfscale-steps under wit/step", () => {
    assert.deepEqual(selectBuild({ kind: "steps" }), {
      witSubdir: "wit/step",
      witFile: "step.wit",
      worldName: "perfscale-steps",
      hostExecImport: null,
    });
  });

  it("composes config and process variants", () => {
    assert.equal(selectBuild({ kind: "steps", hasConfigSchema: true }).worldName,
      "perfscale-steps-config");
    assert.deepEqual(selectBuild({ kind: "steps", process: true }), {
      witSubdir: "wit/step",
      witFile: "step.wit",
      worldName: "perfscale-steps-exec",
      hostExecImport: "perfscale:step/host-exec",
    });
    assert.equal(
      selectBuild({ kind: "steps", process: true, hasConfigSchema: true }).worldName,
      "perfscale-steps-config-exec",
    );
  });

  it("rejects unknown kinds and --process outside steps", () => {
    assert.throws(() => selectBuild({ kind: "wat" }), /--kind must be/);
    assert.throws(() => selectBuild({ kind: "library", process: true }), /requires --kind steps/);
    assert.throws(() => selectBuild({ kind: "reporter", process: true }), /requires --kind steps/);
  });
});
