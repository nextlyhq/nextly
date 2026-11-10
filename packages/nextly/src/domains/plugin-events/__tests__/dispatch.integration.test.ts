/**
 * Dispatching durable plugin events, on every dialect: one delivery per event
 * and subscriber registered when it is dispatched, each run until it succeeds
 * with backoff, across a restart and under two dispatchers at once; a
 * delivery whose subscriber is gone kept rather than given to another; one
 * that runs out of attempts kept as failed.
 *
 * Two instances share the database where the dialect allows it (on SQLite the
 * second is the boot's own adapter), so "at once" means two connections, and a
 * "restart" is a fresh registry of subscribers on the other instance: what a
 * delivery is owed lives only in the database.
 *
 * @module domains/plugin-events/__tests__/dispatch.integration.test
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import {
  bootTwoInstances,
  type TwoInstances,
} from "../../../plugins/__tests__/helpers/two-instances";
import { definePlugin } from "../../../plugins/plugin-context";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { abandonDurableDeliveries } from "../abandon";
import { dispatchDurableEvents } from "../dispatch";
import {
  createDurableEventRecorder,
  durableEventNames,
} from "../durable-events";
import { prunePluginEvents } from "../prune";
import { createStuckWarnings, reportStuckDeliveries } from "../report";
import {
  createDurableSubscribers,
  getDurableSubscribers,
  type DurableSubscribers,
} from "../subscribers";

let current: TwoInstances | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "@test/orders";
const PAID = "test-orders.paid";
const EVENTS = [{ name: PAID, durable: true as const }];
/** A whole second, as SQLite keeps it. */
const T0 = new Date("2026-10-15T00:00:00.000Z");
const SECOND = 1000;
const DAY = 24 * 3600 * SECOND;

interface DeliveryRow {
  id: string;
  eventId: string;
  subscriber: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: unknown;
  lastError: string | null;
}

interface EventRow {
  id: string;
  fannedOutAt: unknown;
  finishedAt: unknown;
}

/** A stored time as milliseconds: SQLite hands back seconds, the others a date. */
function msOf(value: unknown): number {
  return typeof value === "number"
    ? value * 1000
    : new Date(value as string | Date).getTime();
}

describe.each(getConfiguredTestDialects())(
  "dispatching durable events (%s)",
  dialect => {
    let clock = T0;
    const now = () => clock;

    async function boot() {
      clock = T0;
      current = await bootTwoInstances(dialect, {
        plugins: [
          definePlugin({
            name: OWNER,
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { events: EVENTS },
          }),
        ],
      });
      const first = current.first.adapter as unknown as DrizzleAdapter;
      const second = current.second;
      expect(first.dialect).toBe(dialect);
      const events = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => first,
        now,
      });
      const dispatch = (
        subscribers: DurableSubscribers,
        options: {
          on?: DrizzleAdapter;
          maxAttempts?: number;
          warnings?: ReturnType<typeof createStuckWarnings>;
        } = {}
      ) =>
        dispatchDurableEvents({
          adapter: options.on ?? first,
          subscribers,
          now,
          random: () => 0,
          ...(options.warnings ? { warnings: options.warnings } : {}),
          ...(options.maxAttempts === undefined
            ? {}
            : { maxAttempts: options.maxAttempts }),
        });
      return {
        first,
        second,
        events,
        dispatch,
        deliveries: () =>
          first.select<DeliveryRow>("nextly_plugin_event_deliveries", {}),
        eventRows: () => first.select<EventRow>("nextly_plugin_events", {}),
      };
    }

    it("one event and two subscribers make two deliveries, each run once", async () => {
      const { events, dispatch, deliveries, eventRows } = await boot();
      const calls: string[] = [];
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/loyalty", PAID, "award", event => {
        calls.push(`award:${event.id}:${event.attempt}`);
      });
      subscribers.register("@test/email", PAID, "receipt", event => {
        expect(event).toMatchObject({ name: PAID, payload: { order: "o-1" } });
        calls.push(`receipt:${event.id}:${event.attempt}`);
      });
      // Recorded outside any transaction, as from a job or a route.
      const { id } = await events.record(PAID, { order: "o-1" });

      expect(await dispatch(subscribers)).toMatchObject({
        fannedOut: 1,
        delivered: 2,
      });
      expect(calls.sort()).toEqual([`award:${id}:1`, `receipt:${id}:1`]);
      // Delivered: a second pass runs nothing again.
      await dispatch(subscribers);
      expect(calls).toHaveLength(2);
      expect((await deliveries()).map(row => row.status)).toEqual([
        "delivered",
        "delivered",
      ]);
      const [event] = await eventRows();
      expect(event?.finishedAt ?? null).not.toBeNull();
    });

    it("an event no one subscribes to is finished when it is dispatched", async () => {
      const { events, dispatch, deliveries, eventRows } = await boot();
      await events.record(PAID, { order: "o-2" });
      await dispatch(createDurableSubscribers());
      expect(await deliveries()).toEqual([]);
      const [event] = await eventRows();
      expect(event?.fannedOutAt ?? null).not.toBeNull();
      expect(event?.finishedAt ?? null).not.toBeNull();
    });

    it("a failing handler is retried with backoff across a restart, then succeeds", async () => {
      const { events, dispatch, deliveries, second } = await boot();
      let tries = 0;
      const before = createDurableSubscribers();
      before.register("@test/email", PAID, "receipt", () => {
        tries += 1;
        throw new Error("the mail server is down");
      });
      await events.record(PAID, { order: "o-3" });

      expect(await dispatch(before)).toMatchObject({ retried: 1 });
      const [failed] = await deliveries();
      expect(failed).toMatchObject({ status: "pending", attemptCount: 1 });
      expect(failed?.lastError).toContain("the mail server is down");
      expect(msOf(failed?.nextAttemptAt)).toBeGreaterThan(T0.getTime());

      // Before the backoff has passed: not tried again.
      clock = new Date(T0.getTime() + SECOND / 2);
      await dispatch(before);
      expect(tries).toBe(1);

      // A restart: a fresh registry on the other instance, with the same
      // subscriber, now working.
      const attempts: number[] = [];
      const after = createDurableSubscribers();
      after.register("@test/email", PAID, "receipt", event => {
        attempts.push(event.attempt);
      });
      clock = new Date(T0.getTime() + 2 * SECOND);
      await dispatch(after, { on: second });
      expect(attempts).toEqual([2]);
      expect((await deliveries())[0]).toMatchObject({ status: "delivered" });
    });

    it("two dispatchers at once make one delivery per event and subscriber", async () => {
      const { events, dispatch, deliveries, eventRows, second } = await boot();
      const runs = new Map<string, number>();
      const registry = () => {
        const subscribers = createDurableSubscribers();
        for (const [plugin, name] of [
          ["@test/loyalty", "award"],
          ["@test/email", "receipt"],
        ] as const) {
          subscribers.register(plugin, PAID, name, event => {
            const key = `${plugin}:${name}:${event.id}`;
            runs.set(key, (runs.get(key) ?? 0) + 1);
          });
        }
        return subscribers;
      };
      for (let order = 0; order < 6; order++) {
        await events.record(PAID, { order: `o-${order}` });
      }
      const a = registry();
      const b = registry();
      await Promise.all([dispatch(a), dispatch(b, { on: second })]);
      // Whatever either left undone, the next passes finish.
      await dispatch(a);
      await dispatch(b, { on: second });

      expect(runs.size).toBe(12);
      expect([...runs.values()].every(count => count === 1)).toBe(true);
      expect(await deliveries()).toHaveLength(12);
      // Every event is finished, however its two deliveries were shared out.
      expect(
        (await eventRows()).every(event => (event.finishedAt ?? null) !== null)
      ).toBe(true);
    });

    it("two deliveries of one event finishing at once still finish their event", async () => {
      const { events, dispatch, eventRows, second } = await boot();
      // Each dispatcher holds one of the event's two deliveries in its
      // handler until both are inside, then both finish at once: neither may
      // conclude the other is still open.
      let arrived = 0;
      let open!: () => void;
      const both = new Promise<void>(resolve => {
        open = resolve;
      });
      const meet = async () => {
        arrived += 1;
        if (arrived === 2) open();
        await Promise.race([
          both,
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
      };
      const registry = () => {
        const subscribers = createDurableSubscribers();
        subscribers.register("@test/loyalty", PAID, "award", meet);
        subscribers.register("@test/email", PAID, "receipt", meet);
        return subscribers;
      };
      await events.record(PAID, { order: "o-8" });
      // One fans the event out under its lock; the other, waiting on that
      // lock, finds it fanned out; then each takes the delivery the other has
      // not.
      await Promise.all([
        dispatch(registry()),
        dispatch(registry(), { on: second }),
      ]);
      expect(arrived).toBe(2);
      const [event] = await eventRows();
      expect(event?.finishedAt ?? null).not.toBeNull();
    });

    it("a pending delivery reaches its own subscriber after a restart that adds and reorders subscribers", async () => {
      const { events, dispatch, second, deliveries } = await boot();
      const before = createDurableSubscribers();
      before.register("@test/loyalty", PAID, "award", () => {
        throw new Error("the points service is down");
      });
      before.register("@test/email", PAID, "receipt", () => undefined);
      const { id } = await events.record(PAID, { order: "o-4" });
      await dispatch(before);

      // After the restart: a new subscriber first, the others reordered.
      const calls: string[] = [];
      const after = createDurableSubscribers();
      after.register("@test/audit", PAID, "trail", event => {
        calls.push(`trail:${event.id}`);
      });
      after.register("@test/email", PAID, "receipt", event => {
        calls.push(`receipt:${event.id}`);
      });
      after.register("@test/loyalty", PAID, "award", event => {
        calls.push(`award:${event.id}:${event.attempt}`);
      });
      clock = new Date(T0.getTime() + 2 * SECOND);
      await dispatch(after, { on: second });

      // The award reaches the award subscriber; the receipt, delivered
      // already, is not sent again; and the subscriber added after the event
      // was dispatched is owed nothing for it.
      expect(calls).toEqual([`award:${id}:2`]);
      expect(await deliveries()).toHaveLength(2);
    });

    it("a delivery whose subscriber was removed is kept and reported, then abandoned and pruned", async () => {
      const { first, events, dispatch, deliveries, eventRows } = await boot();
      const before = createDurableSubscribers();
      before.register("@test/loyalty", PAID, "award", () => {
        throw new Error("the points service is down");
      });
      let receipts = 0;
      before.register("@test/email", PAID, "receipt", () => {
        receipts += 1;
      });
      await events.record(PAID, { order: "o-5" });
      await dispatch(before);

      // The loyalty plugin is removed.
      const after = createDurableSubscribers();
      after.register("@test/email", PAID, "receipt", () => {
        receipts += 1;
      });
      clock = new Date(T0.getTime() + 2 * SECOND);
      expect(await dispatch(after)).toMatchObject({ held: 1 });

      const award = (await deliveries()).find(
        row => row.subscriber === "@test/loyalty:award"
      );
      // Held, owed to its own subscriber, its last failure kept as the record
      // of what went wrong, its next look put off a quarter of an hour, so it
      // is not read again on every pass.
      expect(award).toMatchObject({
        status: "held",
        attemptCount: 1,
        lastError: "the points service is down",
      });
      expect(msOf(award?.nextAttemptAt)).toBeGreaterThanOrEqual(
        clock.getTime() + 15 * 60 * SECOND
      );
      expect(receipts).toBe(1);
      const [event] = await eventRows();
      expect(event?.finishedAt ?? null).toBeNull();

      // Still put off after a while, however many passes it has been held.
      clock = new Date(T0.getTime() + 60 * SECOND);
      expect(await dispatch(after)).toMatchObject({ held: 0 });
      clock = new Date(T0.getTime() + 2 * SECOND + 15 * 60 * SECOND);
      expect(await dispatch(after)).toMatchObject({ held: 1 });
      clock = new Date(clock.getTime() + 60 * SECOND);
      expect(await dispatch(after)).toMatchObject({ held: 0 });

      // The report names it, as the CLI shows it.
      expect(await reportStuckDeliveries(first)).toEqual([
        {
          id: award?.id,
          eventId: award?.eventId,
          subscriber: "@test/loyalty:award",
          status: "held",
          attemptCount: 1,
          lastError: "the points service is down",
        },
      ]);

      // A subscriber named in other letters, which MySQL's default collation
      // would match, abandons nothing on any dialect.
      expect(
        await abandonDurableDeliveries(
          first,
          { subscriber: "@TEST/Loyalty:Award" },
          { now }
        )
      ).toEqual([]);

      // Abandoned: kept with its record, never looked at again, its event
      // finished.
      const abandonedAt = clock;
      expect(
        await abandonDurableDeliveries(
          first,
          { subscriber: "@test/loyalty:award" },
          { now }
        )
      ).toMatchObject([{ id: award?.id }]);
      const [gone] = (await deliveries()).filter(
        row => row.subscriber === "@test/loyalty:award"
      );
      expect(gone).toMatchObject({
        status: "abandoned",
        attemptCount: 1,
        lastError: "the points service is down",
      });
      expect(await reportStuckDeliveries(first)).toEqual([]);
      clock = new Date(clock.getTime() + DAY);
      expect(await dispatch(after)).toMatchObject({ held: 0 });
      const [finished] = await eventRows();
      expect(msOf(finished?.finishedAt)).toBe(abandonedAt.getTime());

      // Pruned after 30 days, with its deliveries.
      expect(
        await prunePluginEvents(first, new Date(abandonedAt.getTime() + 30 * DAY))
      ).toMatchObject({ removed: 0 });
      expect(
        await prunePluginEvents(
          first,
          new Date(abandonedAt.getTime() + 30 * DAY + SECOND)
        )
      ).toMatchObject({ removed: 1 });
      expect(await eventRows()).toEqual([]);
      expect(await deliveries()).toEqual([]);
    });

    it("a held delivery runs on its next due pass once its subscriber is back, and never goes to another", async () => {
      const { events, dispatch, deliveries, eventRows } = await boot();
      // Fanned out and tried once by an instance that has the subscriber,
      // then looked at by one that does not.
      const before = createDurableSubscribers();
      before.register("@test/loyalty", PAID, "award", () => {
        throw new Error("the points service is down");
      });
      await events.record(PAID, { order: "o-10" });
      expect(await dispatch(before)).toMatchObject({ retried: 1 });
      clock = new Date(T0.getTime() + 2 * SECOND);
      const without = createDurableSubscribers();
      let others = 0;
      without.register("@test/other", PAID, "award", () => {
        others += 1;
      });
      expect(await dispatch(without)).toMatchObject({ held: 1 });
      expect((await deliveries())[0]).toMatchObject({ status: "held" });

      // Its subscriber registered again: run on the pass it is next due.
      const calls: number[] = [];
      const back = createDurableSubscribers();
      back.register("@test/loyalty", PAID, "award", event => {
        calls.push(event.attempt);
      });
      clock = new Date(T0.getTime() + 15 * 60 * SECOND);
      expect(await dispatch(back)).toMatchObject({ held: 0, delivered: 0 });
      clock = new Date(T0.getTime() + 16 * 60 * SECOND);
      expect(await dispatch(back)).toMatchObject({ delivered: 1 });
      expect(calls).toEqual([2]);
      expect(others).toBe(0);
      const rows = await deliveries();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subscriber: "@test/loyalty:award",
        status: "delivered",
      });
      expect(msOf((await eventRows())[0]?.finishedAt)).toBe(clock.getTime());
    });

    it("a delivery being run under its lease is not abandoned until the lease ends", async () => {
      const { first, events, dispatch, deliveries } = await boot();
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        throw new Error("the address is refused");
      });
      await events.record(PAID, { order: "o-15" });
      await dispatch(subscribers);
      const [row] = await deliveries();
      // Another dispatcher holds it now, running its handler.
      const leaseEnds = new Date(clock.getTime() + 60 * SECOND);
      await first.transaction(tx =>
        tx.updateCount(
          "nextly_plugin_event_deliveries",
          { lockedBy: "another-dispatcher", lockedUntil: leaseEnds },
          { and: [{ column: "id", op: "=", value: row?.id }] }
        )
      );
      expect(
        await abandonDurableDeliveries(
          first,
          { subscriber: "@test/email:receipt" },
          { now }
        )
      ).toEqual([]);
      expect(
        await abandonDurableDeliveries(first, { deliveryId: row?.id }, { now })
      ).toEqual([]);
      // A dry run says the same.
      expect(
        await abandonDurableDeliveries(
          first,
          { deliveryId: row?.id },
          { now, dryRun: true }
        )
      ).toEqual([]);
      expect((await deliveries())[0]).toMatchObject({ status: "pending" });

      // Once the lease has ended, it can be.
      clock = new Date(leaseEnds.getTime() + SECOND);
      expect(
        await abandonDurableDeliveries(first, { deliveryId: row?.id }, { now })
      ).toMatchObject([{ id: row?.id }]);
    });

    it("the report lists every stuck delivery, past one page", async () => {
      const { first, events, dispatch } = await boot();
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        throw new Error("the address is refused");
      });
      for (let i = 0; i < 5; i++) {
        await events.record(PAID, { order: `o-page-${i}` });
      }
      await dispatch(subscribers, { maxAttempts: 1 });
      const all = await reportStuckDeliveries(first, { pageSize: 2 });
      expect(all).toHaveLength(5);
      expect(new Set(all.map(row => row.id)).size).toBe(5);

      // An operator abandons the first delivery the report read while it is
      // still reading: every delivery still stuck is listed all the same.
      let pages = 0;
      const reading = {
        select: async <T,>(
          table: string,
          options: Parameters<DrizzleAdapter["select"]>[1]
        ): Promise<T[]> => {
          const page = await first.select<T>(table, options);
          if (pages++ === 0) {
            const [earliest] = page as unknown as Array<{ id: string }>;
            await abandonDurableDeliveries(
              first,
              { deliveryId: earliest?.id },
              { now }
            );
          }
          return page;
        },
      };
      const whileSettling = await reportStuckDeliveries(reading, {
        pageSize: 2,
      });
      const stillStuck = await reportStuckDeliveries(first);
      expect(stillStuck).toHaveLength(4);
      for (const row of stillStuck) {
        expect(whileSettling.map(seen => seen.id)).toContain(row.id);
      }
    });

    it("a pass out of time still warns, and a logger that throws fails nothing and is tried again", async () => {
      const { first, events, dispatch } = await boot();
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        throw new Error("the address is refused");
      });
      await events.record(PAID, { order: "o-16" });
      await dispatch(subscribers, { maxAttempts: 1 });

      let throwing = true;
      const warned: string[] = [];
      const warnings = createStuckWarnings({
        warn: message => {
          if (throwing) throw new Error("the log is full");
          warned.push(message);
        },
      });
      // A pass whose deadline has passed before it starts still warns.
      clock = new Date(T0.getTime() + 60 * SECOND);
      await expect(
        dispatchDurableEvents({
          adapter: first,
          subscribers,
          now,
          deadline: Date.now() - 1,
          warnings,
        })
      ).resolves.toMatchObject({ failed: 0 });
      // The logger threw: nothing is counted as warned, so the next pass
      // warns, an hour sooner than it otherwise would.
      throwing = false;
      clock = new Date(T0.getTime() + 120 * SECOND);
      await dispatchDurableEvents({
        adapter: first,
        subscribers,
        now,
        deadline: Date.now() - 1,
        warnings,
      });
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("ran out of attempts");
    });

    it("a held delivery whose subscriber is back is not warned about", async () => {
      const { events, dispatch } = await boot();
      const before = createDurableSubscribers();
      before.register("@test/loyalty", PAID, "award", () => {
        throw new Error("the points service is down");
      });
      await events.record(PAID, { order: "o-17" });
      await dispatch(before);
      clock = new Date(T0.getTime() + 2 * SECOND);
      expect(await dispatch(createDurableSubscribers())).toMatchObject({
        held: 1,
      });

      // Its subscriber is registered again: the pass that delivers it says
      // nothing about it.
      const warned: string[] = [];
      const warnings = createStuckWarnings({
        warn: message => {
          warned.push(message);
        },
      });
      const back = createDurableSubscribers();
      back.register("@test/loyalty", PAID, "award", () => {});
      clock = new Date(T0.getTime() + 16 * 60 * SECOND);
      expect(await dispatch(back, { warnings })).toMatchObject({
        delivered: 1,
      });
      expect(warned).toEqual([]);
    });

    it("a stuck subscriber is warned about once, not on the next pass, and again an hour later", async () => {
      const { events, dispatch } = await boot();
      const warned: string[] = [];
      const warnings = createStuckWarnings({
        warn: message => {
          warned.push(message);
        },
      });
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        throw new Error("the address is refused");
      });
      await events.record(PAID, { order: "o-11" });
      // The warnings are read at the start of a pass: the pass that runs out
      // the delivery's attempts finds nothing stuck yet, and the next does.
      await dispatch(subscribers, { maxAttempts: 1, warnings });
      expect(warned).toEqual([]);
      clock = new Date(T0.getTime() + SECOND);
      await dispatch(subscribers, { maxAttempts: 1, warnings });
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('"@test/email:receipt"');
      expect(warned[0]).toContain("ran out of attempts");
      expect(warned[0]).not.toContain("held");
      expect(warned[0]).toContain("nextly events report");
      expect(warned[0]).toContain(
        "nextly events abandon --subscriber @test/email:receipt"
      );

      clock = new Date(T0.getTime() + 60 * SECOND);
      await dispatch(subscribers, { maxAttempts: 1, warnings });
      expect(warned).toHaveLength(1);
      clock = new Date(T0.getTime() + SECOND + 3600 * SECOND);
      await dispatch(subscribers, { maxAttempts: 1, warnings });
      expect(warned).toHaveLength(2);
    });

    it("finished events are pruned after 30 days, with their deliveries, and unfinished ones kept", async () => {
      const { first, events, dispatch, deliveries, eventRows } = await boot();
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", event => {
        if (event.payload.order === "o-13") throw new Error("still down");
      });
      // Finished at T0, by its delivery.
      await events.record(PAID, { order: "o-12" });
      // Never finished: its delivery keeps failing.
      await events.record(PAID, { order: "o-13" });
      await dispatch(subscribers);
      // Finished later, a day after.
      clock = new Date(T0.getTime() + DAY);
      await events.record(PAID, { order: "o-14" });
      await dispatch(subscribers);
      expect(await deliveries()).toHaveLength(3);

      expect(
        await prunePluginEvents(first, new Date(T0.getTime() + 30 * DAY + SECOND))
      ).toMatchObject({ removed: 1, started: true });
      const kept = await eventRows();
      expect(kept).toHaveLength(2);
      const keptDeliveries = await deliveries();
      expect(keptDeliveries).toHaveLength(2);
      expect(
        keptDeliveries.every(row => kept.some(e => e.id === row.eventId))
      ).toBe(true);
      // Still unfinished a year on: never pruned.
      await prunePluginEvents(first, new Date(T0.getTime() + 365 * DAY));
      expect(await eventRows()).toHaveLength(1);
      expect((await deliveries())[0]).toMatchObject({ status: "pending" });
    });

    it("a handler that fails slowly is tried again its backoff after it failed", async () => {
      const { events, dispatch, deliveries } = await boot();
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        // The failure comes a minute after the try began.
        clock = new Date(T0.getTime() + 60 * SECOND);
        throw new Error("the mail server timed out");
      });
      await events.record(PAID, { order: "o-8" });
      expect(await dispatch(subscribers)).toMatchObject({ retried: 1 });
      const [row] = await deliveries();
      expect(msOf(row?.nextAttemptAt)).toBeGreaterThan(
        T0.getTime() + 60 * SECOND
      );
    });

    it("a failure is kept with its credentials taken out and no NUL in it", async () => {
      const { events, dispatch, deliveries } = await boot();
      const token = "Zq8xR2mN5vL7tK3wP9yB4cH6";
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        throw new Error(
          // The NUL ahead of the credential, which redaction takes out with
          // the rest of its line.
          `the provider refused a\u0000b with Authorization: Bearer ${token}`
        );
      });
      await events.record(PAID, { order: "o-9" });
      // PostgreSQL's text refuses NUL: kept anyway, on every dialect.
      expect(await dispatch(subscribers)).toMatchObject({ retried: 1 });
      const [row] = await deliveries();
      expect(row).toMatchObject({ status: "pending", attemptCount: 1 });
      expect(row?.lastError).toContain("the provider refused a\uFFFDb with");
      expect(row?.lastError).not.toContain(token);
      expect(row?.lastError).not.toContain("\u0000");
    });

    it("the events:dispatch job delivers on a jobs run", async () => {
      const { events, first } = await boot();
      const calls: string[] = [];
      // The process's own subscribers, as a plugin registers into them.
      const process = getDurableSubscribers();
      process.register("@test/jobrun", PAID, "receipt", event => {
        calls.push(event.id);
      });
      try {
        const { id } = await events.record(PAID, { order: "o-7" });
        await runJobsPass(first, container.get<JobRegistry>("jobRegistry"), {
          maxDurationMs: 10_000,
        });
        expect(calls).toEqual([id]);
      } finally {
        process.removeOwner("@test/jobrun");
      }
    });

    it("a delivery that runs out of attempts is kept as failed and reported", async () => {
      const { first, events, dispatch, deliveries, eventRows } = await boot();
      let tries = 0;
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {
        tries += 1;
        throw new Error("the address is refused");
      });
      await events.record(PAID, { order: "o-6" });
      await dispatch(subscribers, { maxAttempts: 2 });
      clock = new Date(T0.getTime() + 2 * SECOND);
      expect(await dispatch(subscribers, { maxAttempts: 2 })).toMatchObject({
        failed: 1,
      });
      expect((await deliveries())[0]).toMatchObject({
        status: "failed",
        attemptCount: 2,
      });
      // Not run again, and its event not finished: it waits for an operator.
      clock = new Date(T0.getTime() + 3600 * SECOND);
      await dispatch(subscribers, { maxAttempts: 2 });
      expect(tries).toBe(2);
      const [event] = await eventRows();
      expect(event?.finishedAt ?? null).toBeNull();

      // Reported until abandoned, by its id.
      const [failed] = await deliveries();
      expect(await reportStuckDeliveries(first)).toMatchObject([
        {
          id: failed?.id,
          subscriber: "@test/email:receipt",
          status: "failed",
          attemptCount: 2,
          lastError: "the address is refused",
        },
      ]);
      // A dry run names it and changes nothing.
      expect(
        await abandonDurableDeliveries(
          first,
          { deliveryId: failed?.id },
          { dryRun: true, now }
        )
      ).toMatchObject([{ id: failed?.id, status: "failed" }]);
      expect(await reportStuckDeliveries(first)).toHaveLength(1);
      await abandonDurableDeliveries(
        first,
        { deliveryId: failed?.id },
        { now }
      );
      expect(await reportStuckDeliveries(first)).toEqual([]);
      expect((await deliveries())[0]).toMatchObject({
        status: "abandoned",
        attemptCount: 2,
        lastError: "the address is refused",
      });
      expect(msOf((await eventRows())[0]?.finishedAt)).toBe(clock.getTime());
    });
  }
);
