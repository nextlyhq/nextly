/**
 * The CLI and the running application must resolve the same schema.
 *
 * Boot forwards `db.postgres.schema` to the adapter; the migration commands
 * load the same config and build their adapter through a different path. That
 * path passed no schema, so with `schema: "cms"` the application ran in `cms`
 * while `migrate`, `migrate:down` and the status commands worked through
 * `public` — a split lock, a split ledger, and DDL applied to a namespace
 * nothing reads.
 *
 * The value is published once, by whoever loads the config, and read by both.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  activePostgresSchema,
  clearActivePostgresSchema,
  DEFAULT_POSTGRES_SCHEMA,
  resolvePostgresSchema,
  setActivePostgresSchema,
} from "../postgres-schema";

afterEach(() => {
  clearActivePostgresSchema();
});

describe("the schema a CLI command resolves in", () => {
  it("refuses a schema other than public when the config is loaded", () => {
    // What `loadConfig` does on every command that reads nextly.config.ts, so
    // `migrate`, `migrate:create` and `plugins install` refuse exactly as the
    // server does: the push cannot yet create tables anywhere but `public`.
    expect(() =>
      setActivePostgresSchema(resolvePostgresSchema("cms", "postgresql"))
    ).toThrow(
      expect.objectContaining({ code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED" })
    );
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });

  it("accepts public named explicitly", () => {
    setActivePostgresSchema(resolvePostgresSchema("public", "postgresql"));
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });

  it("goes BACK to the default when a later config names no schema", () => {
    // The sequence a CLI process actually performs: `loadConfig` publishes on
    // every load, and watch mode (or a second command in one process) loads
    // more than once.
    //
    // `publishConfiguredPostgresSchema` used to return early when the key was
    // absent, which made the value sticky — a process that had published
    // another schema kept it, so the second config's migrations and ledger
    // targeted a schema its own settings never mentioned. Publishing
    // unconditionally is the fix, and `resolvePostgresSchema` already answers
    // the default for `undefined`.
    setActivePostgresSchema("cms");
    expect(activePostgresSchema()).toBe("cms");

    setActivePostgresSchema(resolvePostgresSchema(undefined, "postgresql"));
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });

  it("stays the default when nothing is configured", () => {
    // The control: a command must not start inventing a namespace for an
    // installation that never asked for one.
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });

  it("is the default again for a dialect that has no schemas", () => {
    // A config shared across dialects does not branch, so a MySQL command
    // reading a config that names one still works in the only namespace it
    // has.
    setActivePostgresSchema(resolvePostgresSchema("cms", "mysql"));
    expect(activePostgresSchema()).toBe(DEFAULT_POSTGRES_SCHEMA);
  });
});
