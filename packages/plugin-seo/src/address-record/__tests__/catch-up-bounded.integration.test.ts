/**
 * The address record's catch-up never keeps the site waiting on a
 * transaction that is not running: on a serverless platform a function is
 * frozen once its response is sent, and a catch-up started at a start, not
 * awaited, may have a transaction open then, idle, holding lock rows every
 * save and every other catch-up needs.
 *
 * On PostgreSQL, where the database bounds a transaction:
 *
 * - A catch-up meeting a lock row held by a transaction that never ends
 *   gives up within a short wait instead of waiting until a statement
 *   timeout, says the record is not ready, and the site goes on answering.
 *   It is tried again once the holder has gone, and records the page.
 * - A catch-up frozen part-way through a transaction has that transaction
 *   ended by the database within a short time, so a save of the page it had
 *   locked goes through; the catch-up, when it runs again, fails and is
 *   tried again, and the process carries on.
 *
 * On SQLite and MySQL the catch-up's transactions are opened as before.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq, inArray, increment } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import {
  holdNextStatement,
  statementsOf,
} from "../../__tests__/count-statements";
import { seoPlugin } from "../../plugin";
import { addressClaims } from "../../schema/tables";
import {
  addressRecordReady,
  CATCH_UP_TRANSACTION_BOUNDS,
  catchUp,
  lastCatchUp,
} from "../catch-up";

import {
  forgetNote,
  forgetRecord,
  recordedRows,
  seoContext,
} from "./record-tables";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** How `work` settled, never waiting past `capMs`. */
async function settledWithin<T>(
  work: Promise<T>,
  capMs: number
): Promise<
  | { outcome: "resolved"; value: T; ms: number }
  | { outcome: "rejected" | "still waiting"; ms: number }
> {
  const started = Date.now();
  const settled = await Promise.race([
    work.then(
      value => ({ outcome: "resolved" as const, value }),
      () => ({ outcome: "rejected" as const })
    ),
    sleep(capMs).then(() => ({ outcome: "still waiting" as const })),
  ]);
  return { ...settled, ms: Date.now() - started };
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages"] })],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
    ],
  });
  await lastCatchUp();
  return current;
}

async function publish(t: TestNextly, slug: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "pages",
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/**
 * A transaction of the test's own, standing for a process frozen with one
 * open: every lock row of the record taken, held until `release`.
 */
async function holdEveryLockRow(): Promise<{ release: () => Promise<void> }> {
  const seo = seoContext();
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let taken!: () => void;
  const holding = new Promise<void>(resolve => {
    taken = resolve;
  });
  const held = seo.db.transaction(async tx => {
    await tx
      .update(addressClaims, { taken: increment(1) })
      .where(eq(tx.table(addressClaims).kind, "lock"));
    taken();
    await released;
  });
  held.catch(() => undefined);
  await holding;
  return {
    release: async () => {
      release();
      await held.catch(() => undefined);
    },
  };
}

/**
 * Forget every address the record holds and the fingerprint of the last
 * run, keeping the lock rows: the next catch-up claims each page's address
 * again, under lock rows already there.
 */
async function forgetAddresses(): Promise<void> {
  const seo = seoContext();
  await seo.db
    .delete(addressClaims)
    .where(inArray(seo.db.table(addressClaims).kind, ["address", "range"]));
  await forgetNote("fingerprint");
}

const postgres = getConfiguredTestDialects().filter(
  dialect => dialect === "postgresql"
);

describe.each(postgres)(
  "the address record's catch-up is bounded by the database (%s)",
  dialect => {
    it("gives up within a short wait on a lock row a transaction never lets go of, and the site answers meanwhile", async () => {
      const t = await boot(dialect);
      const page = await publish(t, "hello");
      // The page's address forgotten, its lock rows kept: the catch-up must
      // claim the address again under those lock rows.
      await forgetAddresses();
      const holder = await holdEveryLockRow();
      try {
        const run = await settledWithin(catchUp(), 15_000);
        expect(run.outcome).toBe("resolved");
        expect(run.ms).toBeLessThan(
          (CATCH_UP_TRANSACTION_BOUNDS.lockWaitMs ?? 0) + 4000
        );
        expect(run.outcome === "resolved" && run.value.ran).toBe(false);
        expect(addressRecordReady()).toBe(false);

        // The site answers meanwhile.
        const read = await settledWithin(
          t.nextly.findByID({ collection: "pages", id: page }),
          3000
        );
        expect(read.outcome).toBe("resolved");
      } finally {
        await holder.release();
      }

      // Tried again once the holder has gone: the page is recorded.
      const again = await catchUp();
      expect(again.ran).toBe(true);
      expect(addressRecordReady()).toBe(true);
      expect(Object.values(await recordedRows())).toContain(`pages:${page}`);
    }, 60_000);

    it("has a transaction a frozen catch-up left open ended within a short time, so a save of its page goes through", async () => {
      const t = await boot(dialect);
      const page = await publish(t, "hello");
      await forgetAddresses();

      // Frozen once its transaction holds the page's lock row: the read that
      // follows is never sent until the process runs again.
      let freeze: ReturnType<typeof holdNextStatement> | undefined;
      const run = catchUp({
        afterReleases: async () => {
          freeze = holdNextStatement(dialect, /for share/i);
        },
      });
      run.catch(() => undefined);
      for (let waited = 0; freeze === undefined && waited < 10_000; ) {
        await sleep(50);
        waited += 50;
      }
      if (freeze === undefined) throw new Error("the catch-up never froze");
      await freeze.reached;
      try {
        // A save of the page the frozen transaction locked.
        const save = await settledWithin(
          t.nextly.update({
            collection: "pages",
            id: page,
            data: { title: "Saved meanwhile", _overwrite: true },
          }),
          15_000
        );
        expect(save.outcome).toBe("resolved");
        expect(save.ms).toBeLessThan(
          (CATCH_UP_TRANSACTION_BOUNDS.idleMs ?? 0) + 4000
        );
      } finally {
        freeze.release();
      }
      // Thawed: the catch-up fails rather than bringing the process down,
      // and says the record is not ready.
      const thawed = await settledWithin(run, 15_000);
      expect(thawed.outcome).toBe("resolved");
      expect(thawed.outcome === "resolved" && thawed.value.ran).toBe(false);
      expect(addressRecordReady()).toBe(false);
      // The next run records the page.
      expect((await catchUp()).ran).toBe(true);
      expect(addressRecordReady()).toBe(true);
    }, 60_000);
  }
);

describe.each(getConfiguredTestDialects())(
  "the address record's catch-up transactions (%s)",
  dialect => {
    it("are bounded on PostgreSQL alone", async () => {
      const t = await boot(dialect);
      await publish(t, "hello");
      await forgetRecord();
      // What the publish set off after its commit (its pages' problems
      // check) finished first, so every transaction counted is the catch-up's.
      await sleep(1500);
      const sent = await statementsOf(dialect, () => catchUp());
      const bounded = sent.filter(sql =>
        /set local (lock_timeout|idle_in_transaction_session_timeout)/i.test(
          sql
        )
      );
      if (dialect === "postgresql") {
        const opened = sent.filter(sql => /^\s*begin\b/i.test(sql)).length;
        expect(opened).toBeGreaterThan(0);
        // Both bounds on every transaction the catch-up opened.
        expect(bounded).toHaveLength(opened * 2);
      } else {
        expect(bounded).toEqual([]);
      }
      expect(addressRecordReady()).toBe(true);
    }, 60_000);
  }
);
