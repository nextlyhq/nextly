/**
 * A timestamp survives the round trip regardless of the server's timezone.
 *
 * The columns are declared without a time zone, so they store a wall clock and
 * record nothing about which zone it belongs to: both ends have to agree.
 * Drizzle writes UTC and reads UTC. A driver handed a `Date` writes the LOCAL
 * wall clock instead, and the same row then reads back shifted by the offset.
 *
 * On a UTC server the two conventions agree and nothing is visibly wrong, which
 * is why this went unnoticed -- CI runs in UTC. So the case that matters runs
 * under a fixed non-UTC `TZ` rather than whatever the machine happens to be:
 * running it only in UTC asserts nothing at all.
 */
import { afterEach, describe, expect, it } from "vitest";

import { date, defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

let current: TestNextly | undefined;
let restoreTz: (() => void) | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  restoreTz?.();
  restoreTz = undefined;
});

/**
 * Run the rest of the case as if the server were five hours ahead of UTC.
 *
 * Node reads `TZ` lazily, so assigning it changes how every `Date` created
 * afterwards is formatted, which is what the driver serializes.
 */
function underNonUtcTimezone(): void {
  const previous = process.env.TZ;
  process.env.TZ = "Asia/Karachi";
  restoreTz = () => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  };
}

const ticks = () =>
  defineCollection({
    slug: "ticks",
    fields: [text({ name: "label" }), date({ name: "occurredAt" })],
  });

/**
 * A whole second, so the value survives every dialect verbatim: MySQL
 * `DATETIME` and SQLite integers store whole seconds and would otherwise round
 * the assertion's own input.
 */
const OCCURRED_AT = new Date("2026-08-04T15:04:01.000Z");

/** The instant to one-second resolution, which every dialect stores exactly. */
const toSecond = (value: unknown): number =>
  Math.round((value as Date).getTime() / 1000);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, collections: [ticks()] });
  return current;
}

describe.each(getConfiguredTestDialects())(
  "timestamp round trip (%s)",
  dialect => {
    it("reads back the instant that was written, on a non-UTC server", async () => {
      underNonUtcTimezone();
      const { nextly } = await boot(dialect);

      const { item } = await nextly.create({
        collection: "ticks",
        data: { label: "a", occurredAt: OCCURRED_AT.toISOString() },
        overrideAccess: true,
      });

      const found = await nextly.findByID({
        collection: "ticks",
        id: String(item.id),
        overrideAccess: true,
      });

      // The user-supplied value survives, and the value the write reported
      // agrees with the value a later read reports. The second assertion is the
      // one that failed: the write stored a local wall clock and the read
      // interpreted it as UTC, so the two differed by the offset.
      expect(found?.occurredAt).toEqual(OCCURRED_AT);
      expect(found?.occurredAt).toEqual(item.occurredAt);
    });

    it("agrees with itself about the timestamps it generates", async () => {
      underNonUtcTimezone();
      const { nextly } = await boot(dialect);

      const { item } = await nextly.create({
        collection: "ticks",
        data: { label: "a" },
        overrideAccess: true,
      });

      const found = await nextly.findByID({
        collection: "ticks",
        id: String(item.id),
        overrideAccess: true,
      });

      // `createdAt` is stamped by the write path rather than supplied, so this
      // covers the system columns as well as a user-declared date field.
      //
      // To the SECOND, because sub-second precision is not uniform: a MySQL
      // `DATETIME` and a SQLite integer both hold whole seconds, so a stored
      // timestamp comes back rounded there while the write reports what it
      // generated. A whole second is still three orders of magnitude finer than
      // the offset this guards against -- a skew of even the smallest real
      // timezone would fail it many times over.
      expect(toSecond(found?.createdAt)).toEqual(toSecond(item.createdAt));
      expect(toSecond(found?.updatedAt)).toEqual(toSecond(item.updatedAt));
    });
  }
);
