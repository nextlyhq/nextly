/**
 * A boot on one dialect must not leave the process answering for another.
 *
 * The validated environment is cached from its first read, so before the
 * harness invalidated it, the first boot in a process froze `DB_DIALECT` for
 * every boot after it. Everything reading the dialect through that proxy would
 * then answer for a database nobody was connected to any more — `toDialectBool`
 * returning SQLite's 0/1 against PostgreSQL, and the schema services falling
 * back to the wrong dialect when constructed without one.
 *
 * The dialect matrix guarantees the bad ordering: SQLite runs first in every
 * matrix suite, so this is the ordinary case rather than a corner of it.
 */
import { afterEach, expect, it } from "vitest";

import { toDialectBool } from "../../domains/auth/services/role/utils";
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

/** The non-SQLite dialects this machine is configured for. */
const SERVER_DIALECTS = getConfiguredTestDialects().filter(d => d !== "sqlite");

for (const dialect of SERVER_DIALECTS) {
  it(`reports ${dialect} to env readers after a SQLite boot`, async () => {
    // The boot that poisons the cache: SQLite reads the environment, and
    // whatever it validates is what every later read gets back.
    current = await createTestNextly({});
    expect(env.DB_DIALECT).toBe("sqlite");
    // SQLite has no boolean type, so `true` is stored as 1.
    expect(toDialectBool(true)).toBe(1);
    // Boot queues post-commit work (permission seeding, event recording). Let
    // it finish before tearing the connection down: a write that lands after
    // the pool closes is reported by the driver rather than by the caller.
    await current.events.settle();
    await current.destroy();
    current = undefined;

    current = await createTestNextly({ dialect });

    expect(env.DB_DIALECT).toBe(dialect);
    // PostgreSQL and MySQL take the boolean as it is; getting 1 here would
    // mean writes are still being converted for a database that is not this
    // one.
    expect(toDialectBool(true)).toBe(true);
  }, 60_000);

  it(`restores the previous dialect once the ${dialect} instance is destroyed`, async () => {
    // Captured rather than assumed: what this should return to depends on what
    // ran before, and asserting "anything but the boot's dialect" would pass by
    // accident whenever the two happened to differ.
    const before = env.DB_DIALECT;

    current = await createTestNextly({ dialect });
    expect(env.DB_DIALECT).toBe(dialect);
    await current.events.settle();
    await current.destroy();
    current = undefined;

    // The files that follow share this process, so the instance has to leave
    // the environment as it found it — including for readers that had already
    // cached it.
    expect(env.DB_DIALECT).toBe(before);
  }, 60_000);
}

// Nothing to assert on a machine with no server configured, but the file must
// still contain a test or the runner reports it as an empty suite.
it.skipIf(SERVER_DIALECTS.length > 0)(
  "has no server dialect configured to check",
  () => {
    expect(getConfiguredTestDialects()).toContain("sqlite");
  }
);
