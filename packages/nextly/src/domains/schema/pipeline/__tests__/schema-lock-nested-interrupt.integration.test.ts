/**
 * An interrupt that arrives while a run inside another's claim is working, on each dialect.
 *
 * `nextly migrate:fresh` holds the schema lock and runs `nextly migrate` inside it, which opens an
 * adapter of its own and asks for the lock again: it is recognised as work inside the outer claim
 * and runs in it. Both ask for the lock to be released on an interrupt. The process may stop only
 * once the outer claim has been given back, because a claim left behind holds every later run
 * until its lease lapses.
 *
 * The signal is emitted rather than sent, and `process.kill` is stubbed, so the test process lives
 * on: the moment the lock would end the process is the moment `process.kill` is called, and the
 * lock row is read there. The read is issued at that call, on an adapter of its own that no run
 * uses, before anything after it runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withSchemaLock } from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "./helpers/schema-lock-world";

/** A no-op logger, so a run's notices do not reach the test output. */
const quiet = { warn: () => {}, info: () => {} };

describe.each(LOCK_DIALECTS)(
  "an interrupt inside a nested schema lock run on %s",
  dialect => {
    let world: LockWorld;
    /** The outer run's adapter, as `migrate:fresh` opens it. */
    let outerAdapter: DrizzleAdapter;
    /** The nested run's adapter, as `nextly migrate` opens its own. */
    let innerAdapter: DrizzleAdapter;
    /** Reads the lock row, and takes part in no run. */
    let observer: DrizzleAdapter;

    beforeEach(async () => {
      world = await lockWorld(dialect);
      outerAdapter = await world.connect();
      innerAdapter = await world.connect();
      observer = await world.connect();
      await world.reset(observer);
    }, 60_000);

    afterEach(async () => {
      await world.reset(observer);
      await outerAdapter.disconnect();
      await innerAdapter.disconnect();
      await observer.disconnect();
      await world.dispose();
    }, 60_000);

    /** Who the lock row names as its holder, null when it is free. */
    async function owner(): Promise<string | null> {
      const rows = (await observer.executeQuery(
        "SELECT owner FROM nextly_schema_lock WHERE id = 1"
      )) as Array<{ owner: string | null }>;
      return rows[0]?.owner ?? null;
    }

    it("gives the outer claim back before the process is stopped", async () => {
      const listenersBefore = process.listenerCount("SIGINT");
      const stops: Array<{ signal: string; owner: Promise<string | null> }> =
        [];
      let stopped: () => void = () => {};
      const processStopped = new Promise<void>(resolve => {
        stopped = resolve;
      });
      const kill = vi
        .spyOn(process, "kill")
        .mockImplementation((_pid: number, signal?: string | number) => {
          stops.push({ signal: String(signal), owner: owner() });
          stopped();
          return true;
        });

      let ownerInside: string | null = null;
      try {
        await withSchemaLock(
          {
            adapter: outerAdapter,
            command: "nextly migrate:fresh",
            whenHeld: "refuse",
            releaseOnInterrupt: true,
            logger: quiet,
          },
          async () => {
            const nested = await withSchemaLock(
              {
                adapter: innerAdapter,
                command: "nextly migrate",
                whenHeld: "refuse",
                releaseOnInterrupt: true,
                logger: quiet,
              },
              async () => {
                ownerInside = await owner();
                process.emit("SIGINT");
                // A real stop ends the process here; the work goes no further until then.
                await processStopped;
                return "ran";
              }
            );
            // The control: the nested run ran inside the outer claim rather than being refused.
            expect(nested).toEqual({ ran: true, value: "ran" });
          }
        );
        // Every stop the interrupt causes is asked for once the releases have ended, so the stub
        // stays until the row is free: a stop asked for after it would end the test process.
        await vi.waitFor(async () => expect(await owner()).toBeNull(), {
          timeout: 10_000,
          interval: 50,
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      } finally {
        kill.mockRestore();
      }

      // The control: the outer run held the lock while the nested run worked.
      expect(ownerInside).not.toBeNull();
      // Stopped once, for the interrupt, and with the lock row already free at that moment.
      const atStop = await Promise.all(
        stops.map(async stop => ({
          signal: stop.signal,
          owner: await stop.owner,
        }))
      );
      expect(atStop).toEqual([{ signal: "SIGINT", owner: null }]);
      expect(await owner()).toBeNull();
      // Nothing is left listening for the next interrupt.
      expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
    }, 60_000);
  }
);
