/**
 * How a try's watch counts the time a session waits, on a stand-in PostgreSQL adapter whose session
 * is always seen waiting: the wait between the last sighting of a statement and the runner moving
 * past it counts too.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { prepareTryWatchdog } from "../watchdog";

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

describe("prepareTryWatchdog", () => {
  it("counts the wait after a statement's last sighting once the runner moves past it", async () => {
    let polls = 0;
    const adapter = {
      // The session is seen waiting for a lock at every ask.
      queryStatement: () => {
        polls += 1;
        return Promise.resolve([{ state: "Lock" }]);
      },
    } as unknown as DrizzleAdapter;
    // One poll only in this test: the next would come after it ends.
    const watch = prepareTryWatchdog(adapter, "postgresql", 60_000, {
      pollMs: 60_000,
    });
    watch.moveTo(0);
    watch.watch("4242");
    while (polls === 0) await sleep(5);

    await sleep(80);
    watch.moveTo(1);

    expect(watch.waited()).toBeGreaterThanOrEqual(70);
    await watch.stop();
  });
});
