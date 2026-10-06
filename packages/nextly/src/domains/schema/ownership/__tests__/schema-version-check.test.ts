/**
 * Refusing a boot the plugin's schema cannot support.
 *
 * A plugin expecting a column the database does not have fails on its first
 * query, and the error says nothing about migrations. Refusing at boot names
 * the command that fixes it instead.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertSchemaVersionDeclarable,
  assertSchemaVersionUsable,
  judgeSchemaVersion,
} from "../schema-version-check";

const state = (over: Record<string, unknown> = {}) => ({
  name: "auth",
  declaredVersion: 2,
  appliedVersion: 2,
  uninstalled: false,
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

  it("reports an uninstalled plugin before anything else", () => {
    expect(
      judgeSchemaVersion(state({ uninstalled: true, appliedVersion: 2 }))
    ).toEqual({ kind: "uninstalled" });
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

  it("refuses an uninstalled plugin in EVERY environment", () => {
    // No amount of dev push makes a deliberately removed plugin's tables
    // correct to recreate.
    const warn = vi.fn();
    expect(() =>
      assertSchemaVersionUsable(state({ uninstalled: true }), {
        production: false,
        warn,
      })
    ).toThrow(NextlyError);
    expect(warn).not.toHaveBeenCalled();
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
});
