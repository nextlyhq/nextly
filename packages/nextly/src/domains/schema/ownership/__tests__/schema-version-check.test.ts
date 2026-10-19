/**
 * Refusing a boot the plugin's schema cannot support.
 *
 * A plugin expecting a column the database does not have fails on its first
 * query, and the error says nothing about migrations. Refusing at boot names
 * the command that fixes it instead.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { SchemaEventRow } from "../../events/schema-events-repository";
import {
  assertPluginSchemaVersionsUsable,
  assertSchemaVersionDeclarable,
  assertSchemaVersionUsable,
  judgeSchemaVersion,
} from "../schema-version-check";

const state = (over: Record<string, unknown> = {}) => ({
  name: "auth",
  declaredVersion: 2,
  appliedVersion: 2,
  ...over,
});

describe("judgeSchemaVersion", () => {
  it("is ok when the applied version has caught up", () => {
    expect(judgeSchemaVersion(state())).toEqual({ kind: "ok" });
  });

  it("is ok when the applied version is ahead", () => {
    // A newer database with older plugin code is not this check's problem:
    // the columns the plugin expects are all present.
    expect(judgeSchemaVersion(state({ appliedVersion: 5 }))).toEqual({
      kind: "ok",
    });
  });

  it("is behind when nothing has been applied", () => {
    expect(judgeSchemaVersion(state({ appliedVersion: null }))).toMatchObject({
      kind: "behind",
    });
  });

  it("never checks a plugin that declared no version", () => {
    // It has made no claim about the schema, so there is nothing to be
    // behind — and checking would refuse every plugin that does not opt in.
    expect(
      judgeSchemaVersion(
        state({ declaredVersion: undefined, appliedVersion: null })
      )
    ).toEqual({ kind: "ok" });
  });
});

describe("assertSchemaVersionUsable", () => {
  it("refuses in production when behind", () => {
    expect(() =>
      assertSchemaVersionUsable(state({ appliedVersion: 1 }), {
        production: true,
        warn: () => undefined,
      })
    ).toThrow(NextlyError);
  });

  it("only warns in development, where push owns the schema", () => {
    // Dev push reconciles from config on every reload, so "behind" resolves
    // itself moments later. Refusing would break the edit loop.
    const warn = vi.fn();
    expect(() =>
      assertSchemaVersionUsable(state({ appliedVersion: 1 }), {
        production: false,
        warn,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("names the command that fixes it", () => {
    try {
      assertSchemaVersionUsable(state({ appliedVersion: 1 }), {
        production: true,
        warn: () => undefined,
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).publicMessage).toMatch(/nextly migrate/);
    }
  });
});

describe("assertSchemaVersionDeclarable", () => {
  it("refuses a version with no migrations to apply it", () => {
    // Such a plugin would refuse boot forever: nothing can ever raise the
    // applied version. Caught at the manifest rather than in production.
    expect(() =>
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: 2,
        migrationVersions: [],
      })
    ).toThrow(NextlyError);
  });

  it("refuses a version its newest migration disagrees with", () => {
    expect(() =>
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: 3,
        migrationVersions: [1, 2],
      })
    ).toThrow(NextlyError);
  });

  it("accepts a version its newest migration declares", () => {
    expect(() =>
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: 2,
        migrationVersions: [1, 2],
      })
    ).not.toThrow();
  });

  it("ignores a plugin that declares no version", () => {
    expect(() =>
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: undefined,
        migrationVersions: [],
      })
    ).not.toThrow();
  });

  it("refuses versions that go down in the order the modules run", () => {
    // The highest is 2, as declared, but the module that runs last carries
    // 1: every module applies and the database ends at 1, behind for good.
    let refusal: unknown;
    try {
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: 2,
        migrationVersions: [2, 1],
      });
    } catch (error) {
      refusal = error;
    }
    expect(NextlyError.is(refusal)).toBe(true);
    expect(JSON.stringify((refusal as NextlyError).publicData)).toMatch(
      /no lower than the one before/
    );
  });

  it("accepts a later module that keeps the version, as a data module does", () => {
    expect(() =>
      assertSchemaVersionDeclarable({
        pluginName: "auth",
        declaredVersion: 2,
        migrationVersions: [1, 2, 2],
      })
    ).not.toThrow();
  });
});

/** One `file_apply` ledger row. */
function applied(
  filename: string,
  startedAtMs: number,
  status: SchemaEventRow["status"] = "applied"
): SchemaEventRow {
  return {
    id: `${filename}-${status}-${startedAtMs}`,
    eventType: "file_apply",
    status,
    source: "cli-migrate",
    filename,
    sha256: null,
    scopeKind: null,
    scopeSlug: null,
    startedAt: new Date(startedAtMs),
    endedAt: new Date(startedAtMs),
    durationMs: null,
    note: null,
    statementsExecuted: null,
    supersededEventIds: null,
    supersededBy: null,
  };
}

describe("assertPluginSchemaVersionsUsable", () => {
  /** A plugin whose only module backfills data: it owns no table. */
  const backfill = {
    name: "backfill",
    schemaVersion: 1,
    migrations: [{ name: "001_backfill", schemaVersion: 1 }],
  };

  it("passes a plugin that owns no table once its modules are in the ledger", async () => {
    // Read from owner rows, a plugin with none had no applied version at all,
    // and production refused it as behind after its module had applied.
    await expect(
      assertPluginSchemaVersionsUsable({
        plugins: [backfill],
        readLedger: async () => [applied("plugin:backfill/001_backfill", 1)],
        ledgerExists: async () => true,
        production: true,
        warn: () => {},
      })
    ).resolves.toBeUndefined();
  });

  it("refuses in production once the module is rolled back", async () => {
    // The control: the same plugin, its module's newest event a rollback.
    await expect(
      assertPluginSchemaVersionsUsable({
        plugins: [backfill],
        readLedger: async () => [
          applied("plugin:backfill/001_backfill", 1),
          applied("plugin:backfill/001_backfill", 2, "rolled_back"),
        ],
        ledgerExists: async () => true,
        production: true,
        warn: () => {},
      })
    ).rejects.toMatchObject({ code: "PLUGIN_SCHEMA_BEHIND" });
  });

  it("reads a missing ledger as nothing applied, and says so", async () => {
    const warn = vi.fn();
    await expect(
      assertPluginSchemaVersionsUsable({
        plugins: [backfill],
        readLedger: () => Promise.reject(new Error("no such table")),
        ledgerExists: async () => false,
        production: true,
        warn,
      })
    ).rejects.toMatchObject({ code: "PLUGIN_SCHEMA_BEHIND" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/ledger not found/)
    );
  });

  it("does not turn a ledger it cannot read into nothing applied", async () => {
    const fault = new Error("connection reset");
    await expect(
      assertPluginSchemaVersionsUsable({
        plugins: [backfill],
        readLedger: () => Promise.reject(fault),
        ledgerExists: async () => true,
        production: false,
        warn: () => {},
      })
    ).rejects.toBe(fault);
  });
});
