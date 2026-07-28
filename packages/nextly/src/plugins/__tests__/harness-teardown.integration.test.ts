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
