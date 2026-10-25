import { defineLibrary } from "../../src/index.ts";

/**
 * `configlib` — the config-extension example (issue #10): declares the
 * top-level `configlib:` config key (validated against `configSchema` at
 * lint/run start) and serves `${configlib.endpoint()}` from it.
 *
 * Build:  npm run example:build:configlib
 */
export default defineLibrary({
  name: "configlib",
  version: "0.1.0",
  configSchema: {
    key: "configlib",
    schema: {
      type: "object",
      properties: { endpoint: { type: "string" } },
      required: ["endpoint"],
      additionalProperties: false,
    },
  },
  functions: {
    endpoint: {
      description: "The configured endpoint (from the configlib: config block)",
      call(_argv, ctx) {
        const block = (ctx.settings.extensions ?? {})["configlib"] as
          | { endpoint?: string }
          | undefined;
        return block?.endpoint ?? "https://localhost";
      },
    },
  },
});
