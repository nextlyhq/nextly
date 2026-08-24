import { describe, expect, it } from "vitest";

import { sanitizeConfig } from "../config";

describe("sanitizeConfig — production migration db options", () => {
  it("defaults runMigrationsOnBoot=false and migrateLockTtlSeconds=900", () => {
    const c = sanitizeConfig({});
    expect(c.db.runMigrationsOnBoot).toBe(false);
    expect(c.db.migrateLockTtlSeconds).toBe(900);
  });

  it("passes through overrides", () => {
    const c = sanitizeConfig({
      db: { runMigrationsOnBoot: true, migrateLockTtlSeconds: 120 },
    });
    expect(c.db.runMigrationsOnBoot).toBe(true);
    expect(c.db.migrateLockTtlSeconds).toBe(120);
  });
});

describe("sanitizeConfig — webhook audit seam", () => {
  it("defaults webhookAuditEnabled to false when unset", () => {
    expect(sanitizeConfig({}).webhookAuditEnabled).toBe(false);
  });

  it("resolves webhooks.audit true", () => {
    expect(
      sanitizeConfig({ webhooks: { audit: true } }).webhookAuditEnabled
    ).toBe(true);
  });
});

describe("preview config survives the boot pipeline", () => {
  // The unit test for the minting endpoint mocks the container directly, so it
  // proves the endpoint READS `config.preview` and says nothing about whether
  // anything ever puts it there. `sanitizeConfig` enumerates its result rather
  // than spreading, so an unnamed field is dropped silently — the option
  // typechecks, the application sets it, and the value never arrives.
  it("is carried through sanitizeConfig rather than dropped", () => {
    const sanitized = sanitizeConfig({
      preview: { route: "/next/preview" },
    });

    expect(sanitized.preview).toEqual({ route: "/next/preview" });
  });

  it("leaves preview undefined when the application sets none", () => {
    expect(sanitizeConfig({}).preview).toBeUndefined();
  });
});
