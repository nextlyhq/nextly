/**
 * Destroying a harness instance twice is safe.
 *
 * A test that cleans up explicitly and also has an `afterEach` calling
 * `destroy()` is an ordinary pattern, and the in-memory SQLite harness has
 * always tolerated it. A server-backed instance has more to undo — it drops
 * its database through a server connection it then closes — so without a guard
 * the second call would drop a database that is already gone, through an
 * adapter that is already disconnected.
 */
import { afterEach, expect, it } from "vitest";

import { env } from "../../shared/lib/env";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

for (const dialect of getConfiguredTestDialects()) {
  it(`tolerates a repeated destroy on ${dialect}`, async () => {
    const instance = await createTestNextly({ dialect });
    // Held so the afterEach above is a genuine third call rather than a no-op.
    current = instance;

    await instance.destroy();
    // The second call is the one under test: it must resolve rather than
    // reject on a dropped database or a closed server connection.
    await expect(instance.destroy()).resolves.toBeUndefined();
  }, 60_000);
}

it("restores the environment after a SQLite instance is destroyed", async () => {
  // The SQLite path changes DB_DIALECT and provisions nothing, so it has no
  // `release()` to undo it. Left unrestored, every later read in this process
  // reports sqlite whatever the process was configured for.
  //
  // A distinct starting value is set here rather than assumed: another test in
  // this file boots SQLite, so inheriting whatever it left would make this
  // pass without restoring anything.
  const original = process.env.DB_DIALECT;
  process.env.DB_DIALECT = "postgresql";

  try {
    const instance = await createTestNextly({});
    current = instance;
    // Safe to read the proxy here: the boot has just configured SQLite, which
    // validates without a DATABASE_URL.
    expect(env.DB_DIALECT).toBe("sqlite");

    await instance.destroy();
    current = undefined;

    // Asserted on `process.env`, not the proxy: reading the proxy validates,
    // and "postgresql" with no DATABASE_URL is exactly what it rejects.
    expect(process.env.DB_DIALECT).toBe("postgresql");
  } finally {
    if (original === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = original;
  }
}, 60_000);

for (const dialect of getConfiguredTestDialects().filter(d => d !== "sqlite")) {
  it(`drops an abandoned ${dialect} database on the next boot`, async () => {
    // Never destroyed: the next boot's defensive reset is the only thing that
    // can reach this instance's database, because its closure is gone.
    const abandoned = await createTestNextly({ dialect });
    const abandonedName = await databaseNameOf(abandoned);

    current = await createTestNextly({ dialect });

    // The recovery boot dropped it rather than leaving it on the server.
    expect(await databaseExists(current, abandonedName)).toBe(false);
    // …and did not drop its own.
    expect(await databaseExists(current, await databaseNameOf(current))).toBe(
      true
    );
  }, 60_000);
}

/** The database the instance is connected to. */
async function databaseNameOf(instance: TestNextly): Promise<string> {
  const rows = await instance.adapter.executeQuery(
    instance.adapter.dialect === "mysql"
      ? "SELECT DATABASE() AS name"
      : "SELECT current_database() AS name"
  );
  const name = firstColumn(rows, "name");
  expect(typeof name, JSON.stringify(rows)).toBe("string");
  return String(name);
}

/** Whether a database still exists on the server this instance is on. */
async function databaseExists(
  instance: TestNextly,
  name: string
): Promise<boolean> {
  const rows = await instance.adapter.executeQuery(
    instance.adapter.dialect === "mysql"
      ? `SELECT COUNT(*) AS hits FROM information_schema.schemata WHERE schema_name = '${name}'`
      : `SELECT COUNT(*) AS hits FROM pg_database WHERE datname = '${name}'`
  );
  return Number(firstColumn(rows, "hits")) > 0;
}

/** Read one column from whichever row shape the driver returned. */
function firstColumn(result: unknown, column: string): unknown {
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? (result[0] as unknown[])
      : result
    : ((result as { rows?: unknown[] })?.rows ?? []);
  const row = rows[0] as Record<string, unknown> | undefined;
  return row?.[column];
}
