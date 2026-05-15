import { describe, expect, it } from "vitest";

import { sanitizeConfig } from "./config";

describe("sanitizeConfig", () => {
  // Regression: sanitizeConfig() returns an explicit allowlist object.
  // `openapi` was added to the NextlyConfig / SanitizedNextlyConfig types
  // and to buildServiceConfig() forwarding, but the runtime passthrough
  // here was missed — so `defineConfig({ openapi })` was silently dropped
  // before it ever reached the `nextly/api/openapi` handler. Every field
  // that downstream code reads MUST be copied into the returned object.
  it("preserves the openapi block verbatim", () => {
    const openapi = {
      info: { title: "Acme API", version: "2.0.0" },
      servers: [{ url: "https://api.acme.com" }],
      ui: "scalar" as const,
    };

    const sanitized = sanitizeConfig({
      collections: [],
      openapi,
    });

    expect(sanitized.openapi).toEqual(openapi);
  });

  it("leaves openapi undefined when not configured", () => {
    const sanitized = sanitizeConfig({ collections: [] });
    expect(sanitized.openapi).toBeUndefined();
  });
});
