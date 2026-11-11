/**
 * Lending a command's own connection to the service container.
 *
 * Retiring cached permission answers reaches the database through the
 * container: it empties the stored answers and publishes the shared role
 * version every running instance watches. A CLI command starts no Nextly in
 * its process, so nothing has registered an adapter there; a command that
 * writes permissions or grants (`nextly upgrade`'s role conversion, `nextly
 * migrate`'s permission phase) lends its connection for the write, so running
 * instances stop answering from the grants before.
 *
 * @module cli/utils/with-adapter-lent
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { Container, container } from "../../di/container";

/**
 * Runs `run` with `adapter` lent to the service container, and takes it back
 * after, whether `run` resolved or threw. A process that already registered an
 * adapter keeps its own: `restore` lends only a name not already registered,
 * and `withdraw` takes out only what it lent.
 */
export async function withAdapterLent<T>(
  adapter: DrizzleAdapter,
  run: () => Promise<T>
): Promise<T> {
  const lent = container.restore(
    new Container().register("adapter", () => adapter)
  );
  try {
    return await run();
  } finally {
    container.withdraw(lent);
  }
}
