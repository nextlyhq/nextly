/**
 * A declared widget's read services against a real instance, on each database:
 * reads as the person they were bound to, whatever a plain JavaScript caller
 * passes beside them, with rows the transport check accepts as they come.
 *
 * `read-services.test.ts` observes the binding against a mocked executor, which
 * can only see the arguments it is handed. What each database answers a row
 * with -- a checkbox as a number on one, a date as an object before it is sent
 * -- and whether the person's read rule is the one that decides, are observed
 * here instead, as are what a grouping and a series read answer and which
 * entries a read counts: real rows, a draft and published lifecycle, and two
 * people the read rule tells apart.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../../__tests__/fixtures/permission-holders";
import {
  checkbox,
  defineCollection,
  number,
  select,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ReadCaller } from "../../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../../collection-sources";
import { rangeWindow, validateWidgetQuery } from "../../query";
import { cardAnswerProblem } from "../card-answer";
import { bindReadServices } from "../read-services";

/**
 * This run's mark on the rows it writes. PostgreSQL and MySQL keep a slot's test
 * database between runs, so every read here is filtered to this run's rows and
 * they are deleted when the case ends.
 */
const RUN = randomUUID();
/**
 * Named for its shape: a server database keeps the table an earlier run made,
 * and boot adds no column to it, so the collection's `size` field takes a new
 * table rather than failing every insert into the old one.
 */
const PARCELS = "widget_read_sized_parcels";
/** A collection with a draft and published lifecycle, read by the same rule. */
const NOTES = "widget_read_notes";
/**
 * The one person the collection's read rule admits. Named anew for each case,
 * as a server database keeps the users a case writes.
 */
let readerId = "reader-a";

const parcels = defineCollection({
  slug: PARCELS,
  access: {
    read: ({ user }) => user?.id === readerId,
    create: () => true,
    delete: () => true,
  },
  fields: [
    text({ name: "run" }),
    text({ name: "label" }),
    number({ name: "weight" }),
    checkbox({ name: "fragile" }),
    // The collection's first field with choices: what a grouping read divides it by when it
    // names no field, the collection having no lifecycle.
    select({
      name: "size",
      options: [
        { label: "Small", value: "small" },
        { label: "Large", value: "large" },
      ],
    }),
  ],
});

const notes = defineCollection({
  slug: NOTES,
  status: true,
  access: {
    read: ({ user }) => user?.id === readerId,
    create: () => true,
    delete: () => true,
  },
  fields: [text({ name: "run" }), text({ name: "kind" })],
});

let reader: ReadCaller = { user: { id: readerId, roles: ["editor"] } };
let stranger: ReadCaller = { user: { id: "reader-b", roles: ["editor"] } };

function servicesFor(
  caller: ReadCaller,
  signal = new AbortController().signal,
  now = new Date()
) {
  return bindReadServices({
    caller,
    // As the batch checks a card's own query, less the source gate the route
    // adds: the read rule this suite is about is the collection's own.
    prepare: async query => validateWidgetQuery(query),
    signal,
    now,
  });
}

const thisRun = { run: { equals: RUN } };

function readServicesSuite(label: string, boot: () => Promise<TestNextly>) {
  describe(`a declared widget's reads (${label})`, () => {
    let handle: TestNextly | undefined;
    let written: { collection: string; id: string }[] = [];

    afterEach(async () => {
      for (const { collection, id } of written) {
        // The Direct API's own default: trusted, as a teardown is.
        await handle?.nextly.delete({ collection, id });
      }
      written = [];
      await handle?.destroy();
      handle = undefined;
    });

    async function bootWithParcels(): Promise<void> {
      handle = await boot();
      for (const [label, weight, fragile, size] of [
        // Whole numbers: a `number` field is an integer column unless it asks for `decimal`.
        ["vase", 3, true, "large"],
        ["book", 1, false, "small"],
        ["lamp", 2, true, "large"],
      ] as const) {
        const created = await handle.nextly.create({
          collection: PARCELS,
          data: { run: RUN, label, weight, fragile, size },
        });
        written.push({ collection: PARCELS, id: String(created.item.id) });
      }
      for (const [kind, status] of [
        ["memo", "published"],
        ["memo", "draft"],
        ["letter", "draft"],
      ] as const) {
        const created = await handle.nextly.create({
          collection: NOTES as never,
          data: { run: RUN, kind, status } as never,
        });
        written.push({ collection: NOTES, id: String(created.item.id) });
      }
      // A code rule only narrows the permission, so both people hold read on
      // parcels and the rule alone tells them apart.
      const suffix = randomUUID().slice(0, 8);
      readerId = await userWhoMay(handle, `reader-a-${suffix}`, "read", [
        PARCELS,
        NOTES,
      ]);
      reader = { user: { id: readerId, roles: ["editor"] } };
      stranger = {
        user: {
          id: await userWhoMay(handle, `reader-b-${suffix}`, "read", [
            PARCELS,
            NOTES,
          ]),
          roles: ["editor"],
        },
      };
      // What `POST /api/dashboard/query` does before it resolves any query.
      await refreshCollectionSources();
    }

    it("reads as the person bound, with rows the transport check accepts", async () => {
      await bootWithParcels();
      const services = servicesFor(reader);

      expect(await services.count(PARCELS, { where: thisRun })).toBe(3);
      const found = await services.find(PARCELS, {
        where: thisRun,
        sort: "label",
        select: ["label", "weight", "fragile"],
      });
      expect(found.items).toEqual([
        expect.objectContaining({ label: "book", weight: 1, fragile: false }),
        expect.objectContaining({ label: "lamp", weight: 2, fragile: true }),
        expect.objectContaining({ label: "vase", weight: 3, fragile: true }),
      ]);
      // As they came, the rows are an answer the list display takes.
      expect(cardAnswerProblem("list", found)).toBeUndefined();
    });

    it("refuses a person the read rule refuses, whatever options the call passes", async () => {
      await bootWithParcels();
      // A plain JavaScript caller is not held to the type, so it may pass what
      // the type leaves out. None of it is read.
      const passed = {
        where: thisRun,
        overrideAccess: true,
        user: reader.user,
        as: "system",
      } as unknown as { where: typeof thisRun };

      await expect(
        servicesFor(stranger).count(PARCELS, passed)
      ).rejects.toThrow();
      await expect(
        servicesFor(stranger).find(PARCELS, passed)
      ).rejects.toThrow();
      // The control: the same options, for the person the rule admits.
      expect(await servicesFor(reader).count(PARCELS, passed)).toBe(3);
    });

    it("groups entries by the field named, or by the collection's own, as the bars view draws them", async () => {
      await bootWithParcels();
      const services = servicesFor(reader);
      const bySize = [
        { value: "large", count: 2 },
        { value: "small", count: 1 },
      ];
      const named = await services.groupBy(PARCELS, {
        field: "size",
        where: thisRun,
      });
      expect(named).toEqual({ buckets: bySize });
      // No lifecycle, so the collection's own grouping is its first field with choices.
      expect(await services.groupBy(PARCELS, { where: thisRun })).toEqual({
        buckets: bySize,
      });
      // With a lifecycle, its status: the published entries alone unless the read asks for all.
      expect(await services.groupBy(NOTES, { where: thisRun })).toEqual({
        buckets: [{ value: "published", count: 1 }],
      });
      const all = await services.groupBy(NOTES, {
        where: thisRun,
        status: "all",
      });
      expect(all.buckets).toEqual([
        { value: "draft", count: 2 },
        { value: "published", count: 1 },
      ]);
      // As it came, the answer is data the bars display takes.
      expect(cardAnswerProblem("bars", named)).toBeUndefined();
    });

    it("counts entries over a range in the interval the range draws, as the series view draws them", async () => {
      await bootWithParcels();
      // One instant for the reads and the windows they are compared with, a
      // second after the rows were made: MySQL stores a DATETIME to the
      // second, rounding to the nearest, so a row made at x.6s is stored at
      // x+1s and would sit past a `now` taken straight after it, outside the
      // window that ends there.
      const now = new Date(Date.now() + 1000);
      const services = servicesFor(reader, undefined, now);
      for (const range of ["7d", "30d", "90d", "12m"] as const) {
        const series = await services.timeseries(PARCELS, {
          range,
          where: thisRun,
        });
        // The interval the range is drawn in, every interval present, and the rows made just
        // now counted once.
        expect(series.interval, range).toBe(rangeWindow(range, now).interval);
        expect(series.points.length, range).toBe(
          rangeWindow(range, now).intervals
        );
        expect(
          series.points.reduce((sum, point) => sum + point.count, 0),
          range
        ).toBe(3);
        expect(cardAnswerProblem("timeseries", series), range).toBeUndefined();
      }
      // Published entries alone, unless the read asks for all of them.
      const total = async (status?: "published" | "all") =>
        (
          await services.timeseries(NOTES, {
            range: "7d",
            where: thisRun,
            ...(status === undefined ? {} : { status }),
          })
        ).points.reduce((sum, point) => sum + point.count, 0);
      expect(await total()).toBe(1);
      expect(await total("published")).toBe(1);
      expect(await total("all")).toBe(3);
    });

    it("counts and finds the published entries unless the read asks for all", async () => {
      await bootWithParcels();
      const services = servicesFor(reader);
      expect(await services.count(NOTES, { where: thisRun })).toBe(1);
      expect(
        await services.count(NOTES, { where: thisRun, status: "published" })
      ).toBe(1);
      expect(
        await services.count(NOTES, { where: thisRun, status: "all" })
      ).toBe(3);
      const found = await services.find(NOTES, {
        where: thisRun,
        select: ["kind"],
        status: "all",
      });
      expect(found.items).toHaveLength(3);
      // A collection with no lifecycle has only published entries: both read every row.
      expect(
        await services.count(PARCELS, { where: thisRun, status: "published" })
      ).toBe(3);
      expect(
        await services.count(PARCELS, { where: thisRun, status: "all" })
      ).toBe(3);
    });

    it("groups and counts over time only for a person the read rule admits", async () => {
      await bootWithParcels();
      // The same reads, with drafts asked for too, for the person the rule refuses.
      await expect(
        servicesFor(stranger).groupBy(NOTES, { where: thisRun, status: "all" })
      ).rejects.toThrow();
      await expect(
        servicesFor(stranger).timeseries(PARCELS, {
          range: "30d",
          where: thisRun,
        })
      ).rejects.toThrow();
      await expect(
        servicesFor(stranger).count(NOTES, { where: thisRun, status: "all" })
      ).rejects.toThrow();
      // The control: the person the rule admits gets them.
      expect(
        (
          await servicesFor(reader).groupBy(NOTES, {
            where: thisRun,
            status: "all",
          })
        ).buckets
      ).toHaveLength(2);
    });

    it("reads nothing once the card has given up", async () => {
      await bootWithParcels();
      const card = new AbortController();
      card.abort();
      await expect(
        servicesFor(reader, card.signal).count(PARCELS, { where: thisRun })
      ).rejects.toThrow();
    });
  });
}

readServicesSuite("sqlite", () =>
  createTestNextly({ collections: [parcels, notes] })
);

// PostgreSQL and MySQL: self-skipping without their URLs, run by CI's matrix.
const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const MY_URL = process.env.TEST_MYSQL_URL ?? "";

describe.skipIf(!PG_URL)("postgres", () => {
  readServicesSuite("postgres", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = PG_URL;
    const adapter = await createAdapter({
      type: "postgresql",
      url: PG_URL,
    } as Parameters<typeof createAdapter>[0]);
    return createTestNextly({ adapter, collections: [parcels, notes] });
  });
});

describe.skipIf(!MY_URL)("mysql", () => {
  readServicesSuite("mysql", async () => {
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL = MY_URL;
    const adapter = await createAdapter({
      type: "mysql",
      url: MY_URL,
    } as Parameters<typeof createAdapter>[0]);
    return createTestNextly({ adapter, collections: [parcels, notes] });
  });
});
