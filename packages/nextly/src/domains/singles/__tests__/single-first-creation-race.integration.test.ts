/**
 * A Single's document created by two requests at once.
 *
 * A Single with no stored document gets one on its first read, or its first
 * write. Two requests arriving together on a fresh site, such as the first
 * page views, each find no row and each go on to create it. The Single's
 * table holds one row by its unique slug, so a second insert is refused with
 * a duplicate key on PostgreSQL and MySQL, which a request must never meet.
 * Exactly one row must be created, and every caller must get it.
 *
 * The race is forced rather than waited for. Every insert into the Single's
 * table is held at a gate: the first until a second arrives, so both requests
 * have decided the row is absent before either writes it, and the second
 * until the first one's transaction has committed, so it always meets the
 * committed row. Which request is first is chosen where it matters, by
 * starting the second only once the first has reached the gate. A correct
 * implementation never sends the second insert at all, so the first also goes
 * on alone after a short wait. The property that separates correct from
 * broken is the DATABASE and the history afterwards, not only that no call
 * threw: one row, one "created" event, and, for a versioned Single, one first
 * version, with every caller handed that row.
 *
 * SQLite runs one writing transaction at a time, so it cannot interleave the
 * two; it runs here so the creation stays correct where nothing races.
 *
 * @module domains/singles/__tests__/single-first-creation-race.integration.test
 */
import type {
  TransactionContext,
  TransactionOptions,
} from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const VERSIONED = "race_settings";
const PLAIN = "race_notes";

/** The Single's table, as `resolveSingleTableName` names every Single's. */
const tableOf = (slug: string) => `single_${slug}`;

/** How long a held insert waits for the other before going on alone. */
const HOLD_MS = 1500;

/** `promise`, or nothing once `HOLD_MS` has passed. */
async function heldAtMost(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alone = new Promise<void>(resolve => {
    timer = setTimeout(resolve, HOLD_MS);
  });
  await Promise.race([promise, alone]);
  clearTimeout(timer);
}

/** A promise and the function that settles it. */
function signal(): { promise: Promise<void>; fire: () => void } {
  let fire!: () => void;
  const promise = new Promise<void>(resolve => {
    fire = resolve;
  });
  return { promise, fire };
}

/**
 * Holds the first insert until a second arrives, and the second until the
 * first one's transaction has finished.
 */
interface InsertGate {
  /** An insert arriving, from a transaction that settles with `settled`. */
  arrive(settled: Promise<void>): Promise<void>;
  /** Fires when the first insert reaches the gate. */
  readonly firstArrived: Promise<void>;
  /** How many inserts reached the gate: none means the fixture never raced. */
  readonly arrivals: number;
}

function insertGate(): InsertGate {
  let arrivals = 0;
  const first = signal();
  const second = signal();
  let firstSettled: Promise<void> = Promise.resolve();
  return {
    async arrive(settled) {
      arrivals += 1;
      if (arrivals === 1) {
        firstSettled = settled;
        first.fire();
        await heldAtMost(second.promise);
        return;
      }
      second.fire();
      await heldAtMost(firstSettled);
    },
    firstArrived: first.promise,
    get arrivals() {
      return arrivals;
    },
  };
}

/** `tx`, with its inserts into `table` held at `gate`. */
function holding(
  tx: TransactionContext,
  table: string,
  arrive: () => Promise<void>
): TransactionContext {
  const insert: TransactionContext["insert"] = async (name, data, options) => {
    if (name === table) await arrive();
    return tx.insert(name, data, options);
  };
  return new Proxy(tx, {
    get: (target, prop) =>
      prop === "insert" ? insert : Reflect.get(target, prop, target),
  });
}

/**
 * Hold every insert into `table` made inside a transaction on `t`'s adapter,
 * which is where both a Single's first read and its first write create its row.
 */
function holdInserts(t: TestNextly, table: string): InsertGate {
  const gate = insertGate();
  const adapter = t.adapter;
  const original = adapter.transaction.bind(adapter);
  adapter.transaction = <T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> => {
    const done = signal();
    return original(
      tx => work(holding(tx, table, () => gate.arrive(done.promise))),
      options
    ).finally(done.fire);
  };
  return gate;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: VERSIONED,
        status: true,
        versions: true,
        fields: [text({ name: "heading", defaultValue: "Welcome" })],
      }),
      defineSingle({
        slug: PLAIN,
        fields: [text({ name: "notice", defaultValue: "Open" })],
      }),
    ],
  });
  return current;
}

/** The ids of the documents the Single's table holds. */
async function storedIds(t: TestNextly, slug: string): Promise<string[]> {
  const rows = await t.adapter.select<{ id: string }>(tableOf(slug), {});
  return rows.map(row => row.id);
}

/** How many "created" events the Single's history holds. */
async function createdEvents(t: TestNextly, slug: string): Promise<number> {
  const rows = await t.adapter.select<{
    subjectKind: string;
    subjectSlug: string | null;
    kind: string;
  }>("nextly_content_events");
  return rows.filter(
    row =>
      row.subjectKind === "single" &&
      row.subjectSlug === slug &&
      row.kind === "created"
  ).length;
}

/** How many numbered versions the Single holds. */
async function versions(t: TestNextly, slug: string): Promise<number> {
  const rows = await t.adapter.select<{ versionNo: number | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: slug },
        ],
      },
    }
  );
  return rows.filter(row => row.versionNo !== null).length;
}

/** Every outcome fulfilled, or the first rejection's reason thrown. */
function fulfilled<T>(outcomes: PromiseSettledResult<T>[]): T[] {
  return outcomes.map(outcome => {
    if (outcome.status === "rejected") throw outcome.reason;
    return outcome.value;
  });
}

/** The id of a read's document. */
const idOf = (doc: unknown) => (doc as { id?: unknown } | null)?.id;

/** The id of the document a write's result names. */
const writtenId = (result: { item: unknown }) => idOf(result.item);

describe.each(getConfiguredTestDialects())(
  "a Single's document created by two requests at once (%s)",
  dialect => {
    it.each([VERSIONED, PLAIN])(
      "two first reads of %s create one document and both get it",
      async slug => {
        const t = await boot(dialect);
        const gate = holdInserts(t, tableOf(slug));

        const [a, b] = fulfilled(
          await Promise.allSettled([
            t.nextly.findSingle({ slug, overrideAccess: true }),
            t.nextly.findSingle({ slug, overrideAccess: true }),
          ])
        );

        expect(gate.arrivals).toBeGreaterThan(0);
        const ids = await storedIds(t, slug);
        expect(ids).toHaveLength(1);
        expect(idOf(a)).toBe(ids[0]);
        expect(idOf(b)).toBe(ids[0]);
        expect(await createdEvents(t, slug)).toBe(1);
        expect(await versions(t, slug)).toBe(slug === VERSIONED ? 1 : 0);
      }
    );

    it("a first read and a first write at once create one document", async () => {
      const t = await boot(dialect);
      const gate = holdInserts(t, tableOf(VERSIONED));

      // The read creates first and the write meets its row: the order the
      // write path could not survive. The other order is the read's to
      // survive, and the two first reads above cover it.
      const reading = t.nextly.findSingle({
        slug: VERSIONED,
        overrideAccess: true,
      });
      await heldAtMost(gate.firstArrived);
      const writing = t.nextly.updateSingle({
        slug: VERSIONED,
        data: { heading: "Hello", _overwrite: true },
        overrideAccess: true,
      });
      const [readOutcome, writeOutcome] = await Promise.allSettled([
        reading,
        writing,
      ]);
      const [read] = fulfilled([readOutcome]);
      const [written] = fulfilled([writeOutcome]);

      expect(gate.arrivals).toBeGreaterThan(0);
      const ids = await storedIds(t, VERSIONED);
      expect(ids).toHaveLength(1);
      expect(idOf(read)).toBe(ids[0]);
      expect(writtenId(written)).toBe(ids[0]);
      expect(await createdEvents(t, VERSIONED)).toBe(1);
      // The write lands on the one document, whichever request created it.
      const stored = await t.nextly.findSingle({
        slug: VERSIONED,
        overrideAccess: true,
      });
      expect(stored).toMatchObject({ heading: "Hello" });
    });

    it("two first writes at once create one document and both apply", async () => {
      const t = await boot(dialect);
      const gate = holdInserts(t, tableOf(PLAIN));

      const [first, second] = fulfilled(
        await Promise.allSettled([
          t.nextly.updateSingle({
            slug: PLAIN,
            data: { notice: "Closed", _overwrite: true },
            overrideAccess: true,
          }),
          t.nextly.updateSingle({
            slug: PLAIN,
            data: { notice: "Closed", _overwrite: true },
            overrideAccess: true,
          }),
        ])
      );

      expect(gate.arrivals).toBeGreaterThan(0);
      const ids = await storedIds(t, PLAIN);
      expect(ids).toHaveLength(1);
      expect(writtenId(first)).toBe(ids[0]);
      expect(writtenId(second)).toBe(ids[0]);
      expect(await createdEvents(t, PLAIN)).toBe(1);
    });
  }
);
