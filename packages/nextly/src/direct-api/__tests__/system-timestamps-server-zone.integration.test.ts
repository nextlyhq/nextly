/**
 * A saved entry's `createdAt` and `updatedAt` are the instant of the save,
 * whatever time zone the server runs in.
 *
 * The round-trip suite beside this one compares what a write reported with
 * what a later read reports. Both can be wrong by the same amount and still
 * agree, so this one compares every stamp with the clock: a stamp read back
 * five hours ahead on a server five hours ahead of UTC is wrong even when every
 * read of it says the same thing.
 *
 * Each case runs under UTC and under a zone five hours ahead. The UTC run is
 * the control: a stamp that is only right there is the defect, and CI runs in
 * UTC, so without the second zone nothing here would fail.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
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
 * Run the rest of the case as if the server ran in `zone`.
 *
 * Node reads `TZ` again when it is assigned, so every `Date` made afterwards,
 * and every driver formatting one, uses the new zone.
 */
function runIn(zone: string): void {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  restoreTz = () => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  };
}

/**
 * Holds `value` to the save that happened between `before` and `after`.
 *
 * A second of slack on each side: SQLite and MySQL keep whole seconds, so a
 * stamp can read up to a second before the save began. A shifted stamp is off
 * by hours, far outside it. A failure names, in ISO form, the instant that
 * was read and the window it missed.
 */
function expectStampOfSave(
  label: string,
  value: unknown,
  before: number,
  after: number
): void {
  expect(
    value instanceof Date || typeof value === "string",
    `${label} is a stamp (got ${String(value)})`
  ).toBe(true);
  const at = new Date(value as Date | string).getTime();
  const window = `${new Date(before - 1000).toISOString()} .. ${new Date(after + 1000).toISOString()}`;
  expect(
    at >= before - 1000 && at <= after + 1000,
    `${label} ${new Date(at).toISOString()} is within the save, ${window}`
  ).toBe(true);
}

const ZONES = ["UTC", "Asia/Karachi"] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    ZONES.map(zone => ({ dialect, zone }))
  )
)("system timestamps on a $zone server ($dialect)", ({ dialect, zone }) => {
  it("stamps a collection entry with the instant of its save", async () => {
    runIn(zone);
    const seenByHooks: { operation: string; updatedAt: unknown }[] = [];
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "label" })],
          hooks: {
            afterChange: [
              ctx => {
                const doc = ctx.data as Record<string, unknown> | undefined;
                // Spelled as the update answers it (`updated_at`), see below.
                seenByHooks.push({
                  operation: ctx.operation,
                  updatedAt: doc?.updatedAt ?? doc?.updated_at,
                });
                return ctx.data;
              },
            ],
          },
        }),
      ],
    });
    const { nextly } = current;

    const beforeCreate = Date.now();
    const { item } = await nextly.create({
      collection: "notes",
      data: { label: "a" },
      overrideAccess: true,
    });
    const afterCreate = Date.now();
    expectStampOfSave(
      "create's createdAt",
      item.createdAt,
      beforeCreate,
      afterCreate
    );
    expectStampOfSave(
      "create's updatedAt",
      item.updatedAt,
      beforeCreate,
      afterCreate
    );

    const beforeUpdate = Date.now();
    const updated = await nextly.update({
      collection: "notes",
      id: String(item.id),
      data: { label: "b", _overwrite: true },
      overrideAccess: true,
    });
    const afterUpdate = Date.now();
    expectStampOfSave(
      "update's updatedAt",
      // The update answers the row with its column names, `updated_at`, where
      // every other answer spells it `updatedAt`; either names the instant.
      updated.item.updatedAt ??
        (updated.item as Record<string, unknown>).updated_at,
      beforeUpdate,
      afterUpdate
    );

    const found = await nextly.findByID({
      collection: "notes",
      id: String(item.id),
      overrideAccess: true,
    });
    expectStampOfSave(
      "a read's createdAt",
      found?.createdAt,
      beforeCreate,
      afterCreate
    );
    expectStampOfSave(
      "a read's updatedAt",
      found?.updatedAt,
      beforeUpdate,
      afterUpdate
    );

    const listed = await nextly.find({
      collection: "notes",
      overrideAccess: true,
    });
    expectStampOfSave(
      "a list's updatedAt",
      listed.items[0]?.updatedAt,
      beforeUpdate,
      afterUpdate
    );

    const hookOnUpdate = seenByHooks.find(seen => seen.operation === "update");
    expectStampOfSave(
      "afterChange's updatedAt",
      hookOnUpdate?.updatedAt,
      beforeUpdate,
      afterUpdate
    );
  });

  it("stamps a Single with the instant of its save", async () => {
    runIn(zone);
    const seenByHooks: unknown[] = [];
    current = await createTestNextly({
      dialect,
      singles: [
        defineSingle({
          slug: "home",
          access: { read: () => true, update: () => true },
          fields: [text({ name: "headline" })],
          hooks: {
            afterChange: [
              ctx => {
                const doc = ctx.data as Record<string, unknown> | undefined;
                seenByHooks.push(doc?.updatedAt);
                return ctx.data;
              },
            ],
          },
        }),
      ],
    });
    const { nextly } = current;

    const beforeFirst = Date.now();
    const { item: first } = (await nextly.updateSingle({
      slug: "home",
      data: { headline: "one", _overwrite: true },
      overrideAccess: true,
    })) as { item: Record<string, unknown> };
    const afterFirst = Date.now();
    expectStampOfSave(
      "first save's createdAt",
      first.createdAt,
      beforeFirst,
      afterFirst
    );
    expectStampOfSave(
      "first save's updatedAt",
      first.updatedAt,
      beforeFirst,
      afterFirst
    );

    const beforeSecond = Date.now();
    const { item: second } = (await nextly.updateSingle({
      slug: "home",
      data: { headline: "two", _overwrite: true },
      overrideAccess: true,
    })) as { item: Record<string, unknown> };
    const afterSecond = Date.now();
    expectStampOfSave(
      "second save's updatedAt",
      second.updatedAt,
      beforeSecond,
      afterSecond
    );

    const read = (await nextly.findSingle({
      slug: "home",
      overrideAccess: true,
    })) as Record<string, unknown>;
    expectStampOfSave(
      "a read's createdAt",
      read.createdAt,
      beforeFirst,
      afterFirst
    );
    expectStampOfSave(
      "a read's updatedAt",
      read.updatedAt,
      beforeSecond,
      afterSecond
    );

    expectStampOfSave(
      "afterChange's updatedAt",
      seenByHooks.at(-1),
      beforeSecond,
      afterSecond
    );
  });
});
