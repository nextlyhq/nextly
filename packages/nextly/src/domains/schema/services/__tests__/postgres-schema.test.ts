/**
 * The schema name is interpolated into SQL and read by four things that must
 * agree. Both facts are what these cover.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  activePostgresSchema,
  assertAdapterPostgresSchema,
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

  it("refuses any schema but public on PostgreSQL, for now", () => {
    // drizzle-kit reads every desired table as `public`; reconciling another
    // schema creates nothing and proposes dropping that schema. Refused with
    // the code that says it is unsupported, not that the name is malformed.
    for (const name of ["cms", "tenant_42"]) {
      let caught: unknown;
      try {
        resolvePostgresSchema(name, "postgresql");
      } catch (error) {
        caught = error;
      }
      expect(
        NextlyError.isCode(caught, "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED")
      ).toBe(true);
      expect((caught as NextlyError).publicMessage).toContain(`"${name}"`);
      expect((caught as NextlyError).publicMessage).toContain(
        "not supported yet"
      );
    }
    // Explicit `public` and absent are the two ways of saying the default.
    expect(resolvePostgresSchema("public", "postgresql")).toBe("public");
    expect(resolvePostgresSchema(undefined, "postgresql")).toBe("public");
  });

  it("names a malformed schema as invalid before calling it unsupported", () => {
    // The shape check runs first, so a name that could never be used is
    // reported as such rather than as merely not supported yet.
    expect(() => resolvePostgresSchema("Cms", "postgresql")).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
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

  it("is read by a second instance of this module", async () => {
    // First-run reaches the push through a dynamic import, which a bundler may
    // resolve to its own copy of this module. The value published at boot has
    // to be the one that copy reads, or first-run introspects `public`.
    setActivePostgresSchema("cms");
    vi.resetModules();
    const secondInstance = await import("../postgres-schema");
    expect(secondInstance.activePostgresSchema).not.toBe(activePostgresSchema);
    expect(secondInstance.activePostgresSchema()).toBe("cms");
  });
});

describe("an adapter the application supplied", () => {
  it.each([
    ["cms", "cms"],
    ["public", undefined],
    ["public", "public"],
  ])("is accepted when %s is also what it uses (%s)", (resolved, adapter) => {
    expect(() => assertAdapterPostgresSchema(resolved, adapter)).not.toThrow();
  });

  it.each([
    // Configured, adapter left at the server default.
    [
      "cms",
      undefined,
      ['"cms"', "sets no schema", "remove db.postgres.schema"],
    ],
    // Adapter configured, the config left at the default.
    [
      "public",
      "cms",
      [
        "is not set",
        'uses schema "cms"',
        "create the adapter without a schema option",
        'set db.postgres.schema to "cms"',
      ],
    ],
    // Both configured, differently.
    [
      "cms",
      "tenant",
      [
        'db.postgres.schema is "cms"',
        'uses schema "tenant"',
        'create the adapter with { schema: "cms" }',
        'set db.postgres.schema to "tenant"',
      ],
    ],
  ])(
    "is refused when the config resolves to %s and it uses %s",
    (resolved, adapter, mentions) => {
      // Refused rather than reconciled: either side followed silently leaves
      // drizzle-kit, the lock and the ledger in one schema and every service
      // query in the other.
      let caught: unknown;
      try {
        assertAdapterPostgresSchema(resolved, adapter);
      } catch (error) {
        caught = error;
      }
      expect(
        NextlyError.isCode(caught, "NEXTLY_POSTGRES_SCHEMA_MISMATCH")
      ).toBe(true);
      for (const mention of mentions) {
        expect((caught as NextlyError).publicMessage).toContain(mention);
      }
    }
  );
});
