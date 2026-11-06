/**
 * A seeder handed an adapter built straight from `@nextlyhq/adapter-sqlite`,
 * not by `createAdapter`, loads that adapter's dialect itself before reading
 * tables.
 *
 * The test removes the SQLite load the unit setup made, so the tables can only
 * be there afterwards because the seeder loaded them. The permissions table is
 * real, on an in-memory database, so "seeded" is read back from its rows.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDrizzleKitForDialect } from "../../drizzle-kit-lazy";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import { permissions } from "../../../schemas/rbac/sqlite";
import { loadedDialect } from "../../dialect-tables";
import { seedPermissions } from "../permissions";

/** The loaded-dialect cache `dialect-tables.ts` keeps on `globalThis`. */
const cache = (
  globalThis as unknown as { __nextly_dialectTables: Map<string, unknown> }
).__nextly_dialectTables;
let earlierLoad: unknown;
let adapter: DrizzleAdapter;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true }) as unknown as DrizzleAdapter;
  await adapter.connect();
  const kit = await getDrizzleKitForDialect("sqlite");
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({ permissions })
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }
  earlierLoad = cache.get("sqlite");
  cache.delete("sqlite");
});

afterEach(async () => {
  if (earlierLoad === undefined) cache.delete("sqlite");
  else cache.set("sqlite", earlierLoad);
  await adapter.disconnect();
});

describe("seeding through an adapter built directly", () => {
  it("loads the adapter's dialect and seeds", async () => {
    expect(() => loadedDialect("sqlite")).toThrow();

    const result = await seedPermissions(adapter, {
      resources: ["posts"],
      actions: ["read"],
      silent: true,
    });

    expect(result).toMatchObject({ success: true, created: 1, errors: 0 });
    const rows = await adapter.executeQuery<{ slug: string }>(
      "SELECT slug FROM permissions"
    );
    expect(rows.map(row => row.slug)).toEqual(["read-posts"]);
    expect(loadedDialect("sqlite").dialect).toBe("sqlite");
  });
});
