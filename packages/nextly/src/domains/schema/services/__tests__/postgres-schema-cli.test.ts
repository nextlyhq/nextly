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
  it("is the configured one once the config is loaded", () => {
    // What `loadConfig` does on every command that reads nextly.config.ts.
    setActivePostgresSchema(resolvePostgresSchema("cms", "postgresql"));

    // What `createCliAdapter` reads when it builds the adapter.
    expect(activePostgresSchema()).toBe("cms");
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
