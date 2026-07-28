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
