import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineLibrary,
  LibraryError,
  parseRunSettings,
  __exportConfigSchema,
} from "../src/index.ts";

describe("configSchema (issue #10)", () => {
  const base = {
    functions: {
      endpoint: { call: () => "x" },
    },
  };

  it("validates the declaration", () => {
    assert.throws(
      () =>
        defineLibrary({
          ...base,
          configSchema: { key: "Bad-Key", schema: {} },
        }),
      LibraryError,
    );
    assert.throws(
      () => defineLibrary({ ...base, configSchema: { key: "ok", schema: null as never } }),
      /JSON Schema/,
    );
  });

  it("exports the WIT config-schema shape", () => {
    const def = defineLibrary({
      ...base,
      configSchema: {
        key: "mylib",
        schema: { type: "object", properties: { endpoint: { type: "string" } } },
      },
    });
    const out = __exportConfigSchema(def);
    assert.deepEqual(JSON.parse(out.configSchema()), {
      key: "mylib",
      schema: { type: "object", properties: { endpoint: { type: "string" } } },
    });
    assert.throws(
      () => __exportConfigSchema(defineLibrary(base)),
      /no configSchema/,
    );
  });

  it("run settings carry extension blocks", () => {
    const settings = parseRunSettings(
      JSON.stringify({
        vus: 2,
        extensions: { mylib: { endpoint: "https://api.test" } },
      }),
    );
    assert.deepEqual(settings.extensions, { mylib: { endpoint: "https://api.test" } });
    assert.throws(() => {
      (settings.extensions!.mylib as Record<string, unknown>).endpoint = "mutated";
    }, TypeError);
  });
});
