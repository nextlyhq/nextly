import { describe, expect, it } from "vitest";

import { UnsupportedDialectVersionError } from "@revnixhq/adapter-drizzle/version-check";

import { classifyError } from "../errors";

describe("classifyError", () => {
  it("maps UnsupportedDialectVersionError to UNSUPPORTED_DIALECT_VERSION", () => {
    const err = new UnsupportedDialectVersionError({
      dialect: "postgresql",
      detectedVersion: "13.5",
      requiredVersion: "15.0",
      message: "PostgreSQL 15.0+ required; detected 13.5",
    });

    const result = classifyError(err);

    expect(result.code).toBe("UNSUPPORTED_DIALECT_VERSION");
    expect(result.message).toContain("PostgreSQL");
    expect(result.details).toBe(err);
  });

  it("maps drizzle-kit shaped errors to PUSHSCHEMA_FAILED", () => {
    // drizzle-kit throws plain Error objects whose .stack contains
    // drizzle-kit/api.js. We use that as the signal because drizzle-kit
    // does not expose a typed error hierarchy.
    const err = new Error("snapshot mismatch");
    err.stack =
      "Error: snapshot mismatch\n    at pushSchema (/node_modules/drizzle-kit/api.js:42:1)";

    const result = classifyError(err);

    expect(result.code).toBe("PUSHSCHEMA_FAILED");
    expect(result.message).toBe("snapshot mismatch");
  });

  it("maps unknown thrown values to INTERNAL_ERROR with message in details", () => {
    const result = classifyError("a plain string thrown");

    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("a plain string thrown");
    expect(result.details).toBe("a plain string thrown");
  });

  it("maps generic Error without drizzle-kit signature to INTERNAL_ERROR", () => {
    const err = new Error("some generic failure");

    const result = classifyError(err);

    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("some generic failure");
    expect(result.details).toBe(err);
  });
});
