/**
 * Two instances on one database, for tests of what must hold across instances:
 * a write only one caller can win, a budget a burst on several instances may
 * not exceed.
 *
 * One instance is a full boot (`createTestNextly`); the second is a separate
 * adapter, with connections of its own, on the same database. That is what a
 * second server instance amounts to for the database: the in-process state the
 * two would not share (caches, the limit store's memory) is the first boot's
 * alone, and anything the test runs through the second adapter meets the first
 * only in the database.
 *
 * On PostgreSQL and MySQL the database is the boot's throwaway one, reached
 * through the `DATABASE_URL` the boot sets while it lives, and the second
 * adapter is given the boot's schema registry, as a booted instance has one.
 *
 * SQLite serves one process. Two connections to one file from one process
 * cannot hold concurrent transactions with its synchronous driver (the second
 * meets SQLITE_BUSY at once, where a second process would wait), so on SQLite
 * "the second instance" is the boot's own adapter: the two flows a test runs
 * at once still race, through that adapter's one connection.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { createAdapter } from "../../../database/factory";
import { installRegistryResolver } from "../../../cli/commands/migrate";
import {
  createTestNextly,
  type CreateTestNextlyOptions,
  type TestNextly,
} from "../../test-nextly";

/** A boot, a second adapter on its database, and the teardown of both. */
export interface TwoInstances {
  first: TestNextly;
  /** A second adapter on the first boot's database (on SQLite, the boot's own). */
  second: DrizzleAdapter;
  destroy(): Promise<void>;
}

/** Boot one instance on `dialect` and open a second on the same database. */
export async function bootTwoInstances(
  dialect: "sqlite" | "postgresql" | "mysql",
  options: Omit<CreateTestNextlyOptions, "dialect" | "adapter"> = {}
): Promise<TwoInstances> {
  if (dialect === "sqlite") {
    const first = await createTestNextly(options);
    return {
      first,
      second: first.adapter as unknown as DrizzleAdapter,
      destroy: () => first.destroy(),
    };
  }

  const first = await createTestNextly({ ...options, dialect });
  const url = process.env.DATABASE_URL;
  if (!url) {
    await first.destroy();
    throw new Error("the boot set no DATABASE_URL to open a second adapter on");
  }
  const second = (await createAdapter({
    type: dialect,
    url,
  })) as unknown as DrizzleAdapter;
  // A booted instance resolves tables by name through its schema registry.
  installRegistryResolver(second);
  return {
    first,
    second,
    async destroy() {
      await second.disconnect();
      await first.destroy();
    },
  };
}
