import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import { sanitizeConfig } from "../config";
import { perLanguageStorageWritten } from "../per-language-storage-written";

describe("sanitizeConfig — production migration db options", () => {
  it("defaults runMigrationsOnBoot=false and the schema lock's lease to 120 s", () => {
    const c = sanitizeConfig({});
    expect(c.db.runMigrationsOnBoot).toBe(false);
    expect(c.db.migrateLockTtlSeconds).toBe(120);
  });

  it("passes through overrides", () => {
    const c = sanitizeConfig({
      db: { runMigrationsOnBoot: true, migrateLockTtlSeconds: 300 },
    });
    expect(c.db.runMigrationsOnBoot).toBe(true);
    expect(c.db.migrateLockTtlSeconds).toBe(300);
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

describe("sanitizeConfig — admin.environment", () => {
  /** The paths and messages startup refuses `environment` with, or none. */
  function refusals(environment: unknown): { path: string; message: string }[] {
    try {
      sanitizeConfig({
        admin: { environment } as Parameters<typeof sanitizeConfig>[0]["admin"],
      });
      return [];
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      const { errors } = (error as NextlyError).publicData as {
        errors: { path: string; message: string }[];
      };
      return errors.map(({ path, message }) => ({ path, message }));
    }
  }

  it("accepts a label with a tone this version draws, or none", () => {
    expect(refusals({ label: "Production" })).toEqual([]);
    expect(refusals({ label: "Staging", tone: "warning" })).toEqual([]);
    expect(refusals({ label: "x".repeat(24), tone: "critical" })).toEqual([]);
    expect(
      sanitizeConfig({ admin: { environment: { label: "Local" } } }).admin
        ?.environment
    ).toEqual({ label: "Local" });
  });

  it("refuses an empty or blank label, a label past 24 characters and an unknown tone, naming each", () => {
    expect(refusals({ label: "  " })).toEqual([
      { path: "admin.environment.label", message: "Must be text, not empty." },
    ]);
    expect(refusals({ label: "x".repeat(25), tone: "loud" })).toEqual([
      {
        path: "admin.environment.label",
        message: "Must be at most 24 characters: it is drawn as a badge.",
      },
      {
        path: "admin.environment.tone",
        message: 'Must be one of "neutral", "warning", "critical".',
      },
    ]);
    expect(refusals("Production")).toEqual([
      { path: "admin.environment", message: "Must be { label, tone? }." },
    ]);
  });
});

// The setting chooses no layout any longer, but the sanitized config keeps the boolean the
// published type promises, and carries what the configuration wrote apart from it, so the start
// warns only a site that still sets it.
describe("sanitizeConfig — the deprecated per-language storage setting", () => {
  it("is always true, whatever the configuration writes", () => {
    expect(sanitizeConfig({}).perLanguageStorage).toBe(true);
    expect(
      sanitizeConfig({ experimental: { perLanguageStorage: false } })
        .perLanguageStorage
    ).toBe(true);
  });

  it("records what the configuration wrote off the published type, and nothing where it writes nothing", () => {
    const unset = sanitizeConfig({});
    expect(perLanguageStorageWritten(unset)).toBeUndefined();
    expect(Object.keys(unset)).not.toContain("perLanguageStorageSetting");
    const written = sanitizeConfig({
      experimental: { perLanguageStorage: false },
    });
    expect(perLanguageStorageWritten(written)).toBe(false);
    // A stray value from an untyped config is not taken for a written setting.
    expect(
      perLanguageStorageWritten(
        sanitizeConfig({
          experimental: { perLanguageStorage: "yes" as unknown as boolean },
        })
      )
    ).toBeUndefined();
    // A copy of it, and a sanitized config sanitized again as the CLI does, keep what was written.
    expect(perLanguageStorageWritten({ ...written })).toBe(false);
    expect(perLanguageStorageWritten(sanitizeConfig(written as never))).toBe(
      false
    );
  });
});
