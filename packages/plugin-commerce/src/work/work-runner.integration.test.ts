/**
 * The work table and job health over commerce's own tables, on every
 * configured dialect.
 *
 * What only a database can answer: that a step recorded in a transaction that
 * rolls back leaves nothing to run, that of two runners reaching one due step
 * exactly one claims it, that a runner whose lease ran out cannot record over
 * the attempt that replaced it, and that two first runs of a job leave one
 * health row.
 *
 * @module work/work-runner.integration.test
 */
import {
  NextlyError,
  type JobContext,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { commerce } from "../plugin";
import { jobHealth, work } from "../schema/tables";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

import { WORK_JOB } from "../checkout/checkout-service";

import { assertJobsRunning, lastJobRun, recordJobRun } from "./job-health";
import { workJob } from "./work-job";
import {
  recordWork,
  runDueWork,
  type WorkItem,
  type WorkRetry,
} from "./work-runner";

const RETRY: WorkRetry = {
  maxAttempts: 3,
  firstDelayMs: 1_000,
  maxDelayMs: 60_000,
  leaseMs: 30_000,
};

describe.each(getConfiguredTestDialects())(
  "the work table (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<PluginContext> {
      const plugin = commerce({
        currency: "USD",
        catalogue: createInMemoryCatalogueSource({ currency: "USD", items: [] })
          .source,
      });
      const init = plugin.init;
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          {
            ...plugin,
            init: async ctx => {
              captured = ctx;
              await init?.(ctx);
            },
          },
        ],
      });
      if (!captured) throw new Error("commerce's init did not run");
      return captured;
    }

    function clock(start = "2026-10-14T06:00:00.000Z") {
      const state = { now: new Date(start) };
      return {
        now: () => state.now,
        advance(ms: number) {
          state.now = new Date(state.now.getTime() + ms);
        },
      };
    }

    function noAlerts() {
      const abandoned: string[] = [];
      return {
        alerts: {
          abandoned: (item: WorkItem) => abandoned.push(item.operationId),
        },
        abandoned,
      };
    }

    it("runs a step recorded with its change once the change commits, and never one whose change rolled back", async () => {
      const ctx = await boot();
      const time = clock();
      await ctx.db.transaction(async tx => {
        await recordWork(tx, {
          kind: "greet",
          subjectId: "order-1",
          operationId: "greet:order-1",
          now: time.now(),
        });
      });
      await expect(
        ctx.db.transaction(async tx => {
          await recordWork(tx, {
            kind: "greet",
            subjectId: "order-2",
            operationId: "greet:order-2",
            now: time.now(),
          });
          throw new Error("the change failed after recording its step");
        })
      ).rejects.toThrow("the change failed");

      const ran: string[] = [];
      const { alerts } = noAlerts();
      const pass = await runDueWork({
        db: ctx.db,
        handlers: { greet: async item => void ran.push(item.operationId) },
        alerts,
        now: time.now,
        retry: RETRY,
      });
      expect(ran).toEqual(["greet:order-1"]);
      expect(pass).toEqual({ done: 1, retried: 0, abandoned: 0 });

      // Done is done: a second pass finds nothing to run.
      await runDueWork({
        db: ctx.db,
        handlers: { greet: async item => void ran.push(item.operationId) },
        alerts,
        now: time.now,
        retry: RETRY,
      });
      expect(ran).toEqual(["greet:order-1"]);
    });

    it("refuses to record one step twice", async () => {
      const ctx = await boot();
      const time = clock();
      const step = {
        kind: "greet",
        subjectId: "order-1",
        operationId: "greet:order-1",
        now: time.now(),
      };
      await ctx.db.transaction(tx => recordWork(tx, step));
      await expect(
        ctx.db.transaction(tx => recordWork(tx, step))
      ).rejects.toBeDefined();
      expect(await ctx.db.select(work).all()).toHaveLength(1);
    });

    it("retries a failing step later and later, then gives it up with an alert", async () => {
      const ctx = await boot();
      const time = clock();
      await ctx.db.transaction(tx =>
        recordWork(tx, {
          kind: "flaky",
          subjectId: "order-1",
          operationId: "flaky:order-1",
          now: time.now(),
        })
      );
      const { alerts, abandoned } = noAlerts();
      const attempts: number[] = [];
      const handlers = {
        flaky: async (item: WorkItem) => {
          attempts.push(item.attempt);
          throw new TypeError(
            "fetch failed: https://api.example/charge?key=sk_live_secret"
          );
        },
      };
      const run = () =>
        runDueWork({
          db: ctx.db,
          handlers,
          alerts,
          now: time.now,
          retry: RETRY,
        });

      expect(await run()).toMatchObject({ retried: 1 });
      // Not due again until its wait has passed.
      expect(await run()).toEqual({ done: 0, retried: 0, abandoned: 0 });
      time.advance(1_000);
      expect(await run()).toMatchObject({ retried: 1 });
      time.advance(1_999);
      expect(await run()).toEqual({ done: 0, retried: 0, abandoned: 0 });
      time.advance(1);
      expect(await run()).toMatchObject({ abandoned: 1 });
      expect(attempts).toEqual([1, 2, 3]);
      expect(abandoned).toEqual(["flaky:order-1"]);

      const [row] = await ctx.db.select(work).all();
      // Recorded by its kind: the message, and the key in it, are not kept.
      expect(row).toMatchObject({
        state: "abandoned",
        attempts: 3,
        lastError: "TypeError",
      });
      // An abandoned step is never picked up again.
      time.advance(10 * 60_000);
      expect(await run()).toEqual({ done: 0, retried: 0, abandoned: 0 });
    });

    it("lets exactly one of two runners take a due step", async () => {
      const ctx = await boot();
      const time = clock();
      await ctx.db.transaction(tx =>
        recordWork(tx, {
          kind: "slow",
          subjectId: "order-1",
          operationId: "slow:order-1",
          now: time.now(),
        })
      );
      let runs = 0;
      const handlers = {
        slow: async () => {
          runs += 1;
          await new Promise(resolve => setTimeout(resolve, 50));
        },
      };
      const { alerts } = noAlerts();
      const passes = await Promise.all(
        [1, 2, 3].map(() =>
          runDueWork({
            db: ctx.db,
            handlers,
            alerts,
            now: time.now,
            retry: RETRY,
          })
        )
      );
      expect(runs).toBe(1);
      expect(passes.reduce((n, pass) => n + pass.done, 0)).toBe(1);
    });

    it("hands a step whose runner stopped mid-step to the next runner once its lease runs out, and keeps the stale runner from recording over it", async () => {
      const ctx = await boot();
      const time = clock();
      await ctx.db.transaction(tx =>
        recordWork(tx, {
          kind: "charge",
          subjectId: "order-1",
          operationId: "charge:order-1",
          now: time.now(),
        })
      );
      const { alerts } = noAlerts();

      // The first runner claims the step and then hangs until released.
      let release: () => void = () => undefined;
      const hung = new Promise<void>(resolve => {
        release = resolve;
      });
      const seen: WorkItem[] = [];
      const first = runDueWork({
        db: ctx.db,
        handlers: {
          charge: async item => {
            seen.push(item);
            await hung;
            throw new Error("the stale runner's late failure");
          },
        },
        alerts,
        now: time.now,
        retry: RETRY,
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(seen).toHaveLength(1);

      // Within the lease nobody else takes it; past it, the next runner does.
      const quiet = await runDueWork({
        db: ctx.db,
        handlers: { charge: async () => undefined },
        alerts,
        now: time.now,
        retry: RETRY,
      });
      expect(quiet.done).toBe(0);
      time.advance(RETRY.leaseMs);
      const second = await runDueWork({
        db: ctx.db,
        handlers: { charge: async item => void seen.push(item) },
        alerts,
        now: time.now,
        retry: RETRY,
      });
      expect(second.done).toBe(1);
      // The same step and key, with the first attempt's time kept.
      expect(seen[1]).toMatchObject({
        operationId: "charge:order-1",
        attempt: 2,
        firstAttemptAt: seen[0]?.firstAttemptAt,
      });

      release();
      await first;
      const [row] = await ctx.db.select(work).all();
      expect(row).toMatchObject({
        state: "done",
        attempts: 2,
        lastError: null,
      });
    });

    it("runs as the work job: records that it ran, then runs what is due", async () => {
      const ctx = await boot();
      const now = new Date();
      await ctx.db.transaction(tx =>
        recordWork(tx, {
          kind: "greet",
          subjectId: "order-1",
          operationId: "greet:order-1",
          now,
        })
      );
      const ran: string[] = [];
      const job = workJob(() => ({
        db: ctx.db,
        dialect: ctx.dialect,
        handlers: { greet: async item => void ran.push(item.operationId) },
        alerts: { abandoned: () => undefined },
      }));
      expect(job).toMatchObject({ slug: WORK_JOB, sweep: true });
      await job.handler(null, {
        jobId: "test",
        attempt: 1,
        user: null,
        now,
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as unknown as JobContext);
      expect(ran).toEqual(["greet:order-1"]);
      // Within a second: MySQL keeps whole seconds, rounded, where
      // PostgreSQL keeps more, and a staleness measured in minutes reads
      // either the same.
      const lastRunAt = await lastJobRun(ctx.db, WORK_JOB);
      expect(
        Math.abs((lastRunAt?.getTime() ?? 0) - now.getTime())
      ).toBeLessThanOrEqual(1_000);
    });

    it("runs only one subject's steps when asked, and stops at the pass's deadline", async () => {
      const ctx = await boot();
      const time = clock();
      await ctx.db.transaction(async tx => {
        for (const subject of ["order-1", "order-2", "order-3"]) {
          await recordWork(tx, {
            kind: "greet",
            subjectId: subject,
            operationId: `greet:${subject}`,
            now: time.now(),
          });
        }
      });
      const ran: string[] = [];
      const handlers = {
        greet: async (item: WorkItem) => void ran.push(item.subjectId),
      };
      const { alerts } = noAlerts();

      await runDueWork({
        db: ctx.db,
        handlers,
        alerts,
        now: time.now,
        subjectId: "order-2",
        retry: RETRY,
      });
      expect(ran).toEqual(["order-2"]);

      await runDueWork({
        db: ctx.db,
        handlers,
        alerts,
        now: time.now,
        deadline: time.now(),
        retry: RETRY,
      });
      expect(ran).toEqual(["order-2"]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "job health (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<PluginContext> {
      const plugin = commerce({ currency: "USD" });
      const init = plugin.init;
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          {
            ...plugin,
            init: async ctx => {
              captured = ctx;
              await init?.(ctx);
            },
          },
        ],
      });
      if (!captured) throw new Error("commerce's init did not run");
      return captured;
    }

    it("keeps one row per job, moved forward by every run, racing first runs included", async () => {
      const ctx = await boot();
      const at = (iso: string) => new Date(iso);
      expect(await lastJobRun(ctx.db, "commerce:work")).toBeNull();
      await Promise.all(
        [1, 2, 3].map(() =>
          recordJobRun(
            ctx.db,
            ctx.dialect,
            "commerce:work",
            at("2026-10-14T06:00:00.000Z")
          )
        )
      );
      await recordJobRun(
        ctx.db,
        ctx.dialect,
        "commerce:work",
        at("2026-10-14T06:05:00.000Z")
      );
      const rows = await ctx.db.select(jobHealth).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.lastRunAt.toISOString()).toBe("2026-10-14T06:05:00.000Z");
    });

    it("refuses checkout while the jobs have never run or have stopped, and alerts each time", async () => {
      const ctx = await boot();
      const alerts: (Date | null)[] = [];
      const gate = (now: string) =>
        assertJobsRunning({
          db: ctx.db,
          job: "commerce:work",
          now: new Date(now),
          staleAfterMs: 15 * 60_000,
          alert: lastRunAt => alerts.push(lastRunAt),
        });
      const codeOf = async (work: Promise<void>) => {
        try {
          await work;
          return undefined;
        } catch (error) {
          return NextlyError.is(error) ? String(error.code) : String(error);
        }
      };

      expect(await codeOf(gate("2026-10-14T06:00:00.000Z"))).toBe(
        "COMMERCE_JOBS_NOT_RUNNING"
      );
      await recordJobRun(
        ctx.db,
        ctx.dialect,
        "commerce:work",
        new Date("2026-10-14T06:00:00.000Z")
      );
      expect(await codeOf(gate("2026-10-14T06:15:00.000Z"))).toBeUndefined();
      expect(await codeOf(gate("2026-10-14T06:15:01.000Z"))).toBe(
        "COMMERCE_JOBS_NOT_RUNNING"
      );
      expect(alerts.map(a => a?.toISOString() ?? null)).toEqual([
        null,
        "2026-10-14T06:00:00.000Z",
      ]);
    });
  }
);
