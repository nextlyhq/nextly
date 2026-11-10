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
import { dispatchDurableEvents } from "../dispatch";
import {
  createDurableEventRecorder,
  durableEventNames,
} from "../durable-events";
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

interface DeliveryRow {
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
        options: { on?: DrizzleAdapter; maxAttempts?: number } = {}
      ) =>
        dispatchDurableEvents({
          adapter: options.on ?? first,
          subscribers,
          now,
          random: () => 0,
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

    it("a delivery whose subscriber is gone is kept, neither run nor given to another", async () => {
      const { events, dispatch, deliveries, eventRows } = await boot();
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
      // Kept as it was, owed to its own subscriber, its next try put off so it
      // is not read again on every pass.
      expect(award).toMatchObject({ status: "pending", attemptCount: 1 });
      expect(award?.lastError).toContain("not registered");
      expect(msOf(award?.nextAttemptAt)).toBeGreaterThan(clock.getTime());
      expect(receipts).toBe(1);
      const [event] = await eventRows();
      expect(event?.finishedAt ?? null).toBeNull();
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

    it("a delivery that runs out of attempts is kept as failed", async () => {
      const { events, dispatch, deliveries, eventRows } = await boot();
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
    });
  }
);
