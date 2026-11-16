/**
 * The adapter `createCliAdapter` returns resolves the static system tables by name.
 *
 * Several commands (`migrate:resolve`, `migrate:baseline`, `migrate:down`, `upgrade`, plugin
 * install and uninstall) take the schema lock without installing a table resolver of their own,
 * and the lock seeds its field-group row through the adapter's transaction `insert`, which writes
 * only to a table its resolver holds. Read on a real SQLite adapter, so what is asserted is the
 * adapter the commands get, not a stand-in.
 *
 * @module cli/utils/__tests__/adapter-table-resolver.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCliAdapter, type CLIDatabaseAdapter } from "../adapter";

/** The resolver the adapter consults for a table named in a write. */
type WithResolver = {
  tableResolver?: { getTable(name: string): unknown } | null;
};

describe("the adapter createCliAdapter returns", () => {
  let dir: string;
  let adapter: CLIDatabaseAdapter | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-cli-adapter-resolver-"));
  });

  afterEach(async () => {
    await adapter?.disconnect();
    adapter = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the field-group lock table, which the schema lock seeds through it", async () => {
    adapter = await createCliAdapter({
      dialect: "sqlite",
      databaseUrl: `file:${join(dir, "site.db")}`,
    });
    const { tableResolver } = adapter as unknown as WithResolver;
    expect(tableResolver?.getTable("nextly_field_group_lock")).toBeTruthy();
  });
});
