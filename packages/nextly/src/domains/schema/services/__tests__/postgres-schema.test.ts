/**
 * The schema name is interpolated into SQL and read by four things that must
 * agree. Both facts are what these cover.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  activePostgresSchema,
  clearActivePostgresSchema,
  createSchemaSql,
  DEFAULT_POSTGRES_SCHEMA,
  resolvePostgresSchema,
  setActivePostgresSchema,
  validatePostgresSchema,
} from "../postgres-schema";

afterEach(() => {
  clearActivePostgresSchema();
});

describe("the configured PostgreSQL schema", () => {
  it("defaults to public when nothing is configured", () => {
    expect(resolvePostgresSchema(undefined, "postgresql")).toBe("public");
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });

  it("is published for every later consumer", () => {
    // The adapter sets `search_path` and drizzle-kit filters introspection;
    // two answers means the pipeline compares a namespace nothing is in and
    // proposes creating every table, forever.
    setActivePostgresSchema("cms");
    expect(activePostgresSchema()).toBe("cms");
  });

  it.each([["cms"], ["_private"], ["tenant_42"]])("accepts %s", name => {
    expect(validatePostgresSchema(name)).toBe(name);
  });

  it.each([
    ["my schema", "a space needs quoting"],
    ["Cms", "upper case folds unpredictably"],
    ['x"; DROP SCHEMA public; --', "the reason this is checked at all"],
    ["pg_temp", "PostgreSQL reserves the pg_ prefix"],
    ["", "empty is not a name"],
    ["1st", "an identifier cannot start with a digit"],
  ])("refuses %s", name => {
    expect(() => validatePostgresSchema(name)).toThrow(NextlyError);
  });

  it("refuses a name too long for an identifier", () => {
    expect(() => validatePostgresSchema("a".repeat(64))).toThrow(NextlyError);
    expect(validatePostgresSchema("a".repeat(63))).toHaveLength(63);
  });

  it("ignores the setting on MySQL and SQLite, and says so", () => {
    // A config shared across dialects is the ordinary case, so refusing would
    // make one setting stop an app that runs perfectly. Warning is the
    // difference between ignored and ignored-silently.
    for (const dialect of ["mysql", "sqlite"]) {
      const warn = vi.fn();
      expect(resolvePostgresSchema("cms", dialect, warn)).toBe("public");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("cms");
    }
  });

  it("does not warn when nothing was configured", () => {
    // The control: warning on every MySQL boot would train people to ignore it.
    const warn = vi.fn();
    expect(resolvePostgresSchema(undefined, "mysql", warn)).toBe("public");
    expect(warn).not.toHaveBeenCalled();
  });

  it("builds CREATE SCHEMA only from a validated name", () => {
    // `search_path` naming a schema that is not there does not fail — it falls
    // through — so the first migration would create its tables in `public` and
    // the option would appear to do nothing.
    expect(createSchemaSql("cms")).toBe("CREATE SCHEMA IF NOT EXISTS cms");
    expect(() => createSchemaSql("cms; DROP SCHEMA public")).toThrow(
      NextlyError
    );
  });
});
