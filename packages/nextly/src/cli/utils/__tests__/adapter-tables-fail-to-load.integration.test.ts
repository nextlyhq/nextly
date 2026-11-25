/**
 * A command whose database opened, but whose tables' code then fails, gives the
 * connection up, on every dialect.
 *
 * The database is a real one, opened through the real factory, and the adapter
 * it made is kept so the test can ask whether it is still connected. Only the
 * step that loads the tables is made to fail.
 *
 * What would separate a correct open from a broken one:
 * - the connection left open behind the failure;
 * - the failure reported as a database that cannot be reached;
 * - an adapter that was never connected, which the control shows otherwise.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCliAdapter, type SupportedDialect } from "../adapter";

const run = vi.hoisted(() => ({
  fails: undefined as Error | undefined,
  connectedBeforeTables: undefined as boolean | undefined,
}));
/** Every adapter the factory made in the test, ended after it whatever happened. */
const made = vi.hoisted(() => [] as DrizzleAdapter[]);

vi.mock("../../../database/factory", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../../database/factory")>();
  return {
    ...original,
    createAdapter: async (
      ...args: Parameters<typeof original.createAdapter>
    ) => {
      const adapter = await original.createAdapter(...args);
      made.push(adapter);
      return adapter;
    },
  };
});
vi.mock("../registry-resolver", async importOriginal => {
  const original =
    await importOriginal<typeof import("../registry-resolver")>();
  return {
    ...original,
    installRegistryResolver: (adapter: DrizzleAdapter) => {
      run.connectedBeforeTables = adapter.isConnected();
      if (run.fails !== undefined) throw run.fails;
      return original.installRegistryResolver(adapter);
    },
  };
});

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "nextly-tables-fail-"));
  run.fails = undefined;
  run.connectedBeforeTables = undefined;
});
afterEach(async () => {
  for (const adapter of made.splice(0)) {
    await adapter.disconnect().catch(() => {});
  }
  rmSync(folder, { recursive: true, force: true });
});

/** The database of `dialect` this run was given, or undefined where it has none. */
function urlOf(dialect: SupportedDialect): string | undefined {
  if (dialect === "sqlite") return `file:${join(folder, "app.db")}`;
  return (
    (dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL) || undefined
  );
}

// SQLite's file is made for each test, so it is always there.
const configured = (["sqlite", "postgresql", "mysql"] as const).filter(
  dialect => dialect === "sqlite" || urlOf(dialect) !== undefined
);

describe.each(configured)("a %s database that opened", dialect => {
  const open = () => createCliAdapter({ dialect, databaseUrl: urlOf(dialect) });

  it("is given up when its tables cannot be loaded, and the failure is the tables' own", async () => {
    run.fails = new TypeError("the tables could not be read");

    await expect(open()).rejects.toBe(run.fails);

    expect(run.connectedBeforeTables).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].isConnected()).toBe(false);
  });

  it("stays open when they are", async () => {
    await open();

    expect(made).toHaveLength(1);
    expect(made[0].isConnected()).toBe(true);
  });
});
