/**
 * A declared widget's read services against a real instance, on each database:
 * reads as the person they were bound to, whatever a plain JavaScript caller
 * passes beside them, with rows the transport check accepts as they come.
 *
 * `read-services.test.ts` observes the binding against a mocked executor, which
 * can only see the arguments it is handed. What each database answers a row
 * with -- a checkbox as a number on one, a date as an object before it is sent
 * -- and whether the person's read rule is the one that decides, are observed
 * here instead.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { checkbox, defineCollection, number, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ReadCaller } from "../../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../../collection-sources";
import { validateWidgetQuery } from "../../query";
import { cardAnswerProblem } from "../card-answer";
import { bindReadServices } from "../read-services";

/**
 * This run's mark on the rows it writes. PostgreSQL and MySQL keep a slot's test
 * database between runs, so every read here is filtered to this run's rows and
 * they are deleted when the case ends.
 */
const RUN = randomUUID();
const PARCELS = "widget_read_parcels";
/** The one person the collection's read rule admits. */
const READER = "reader-a";

const parcels = defineCollection({
  slug: PARCELS,
  access: {
    read: ({ user }) => user?.id === READER,
    create: () => true,
    delete: () => true,
  },
  fields: [
    text({ name: "run" }),
    text({ name: "label" }),
    number({ name: "weight" }),
    checkbox({ name: "fragile" }),
  ],
});

const reader: ReadCaller = { user: { id: READER, roles: ["editor"] } };
const stranger: ReadCaller = { user: { id: "reader-b", roles: ["editor"] } };

function servicesFor(
  caller: ReadCaller,
  signal = new AbortController().signal
) {
  return bindReadServices({
    caller,
    // As the batch checks a card's own query, less the source gate the route
    // adds: the read rule this suite is about is the collection's own.
    prepare: async query => validateWidgetQuery(query),
    signal,
    now: new Date(),
  });
}

const thisRun = { run: { equals: RUN } };

function readServicesSuite(label: string, boot: () => Promise<TestNextly>) {
  describe(`a declared widget's reads (${label})`, () => {
    let handle: TestNextly | undefined;
    let written: string[] = [];

    afterEach(async () => {
      for (const id of written) {
        // The Direct API's own default: trusted, as a teardown is.
        await handle?.nextly.delete({ collection: PARCELS, id });
      }
      written = [];
      await handle?.destroy();
      handle = undefined;
    });

    async function bootWithParcels(): Promise<void> {
      handle = await boot();
      for (const [label, weight, fragile] of [
        // Whole numbers: a `number` field is an integer column unless it asks for `decimal`.
        ["vase", 3, true],
        ["book", 1, false],
      ] as const) {
        const created = await handle.nextly.create({
          collection: PARCELS,
          data: { run: RUN, label, weight, fragile },
        });
        written.push(String(created.item.id));
      }
      // What `POST /api/dashboard/query` does before it resolves any query.
      await refreshCollectionSources();
    }

    it("reads as the person bound, with rows the transport check accepts", async () => {
      await bootWithParcels();
      const services = servicesFor(reader);

      expect(await services.count(PARCELS, { where: thisRun })).toBe(2);
      const found = await services.find(PARCELS, {
        where: thisRun,
        sort: "label",
        select: ["label", "weight", "fragile"],
      });
      expect(found.items).toEqual([
        expect.objectContaining({ label: "book", weight: 1, fragile: false }),
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
      expect(await servicesFor(reader).count(PARCELS, passed)).toBe(2);
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

readServicesSuite("sqlite", () => createTestNextly({ collections: [parcels] }));

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
    return createTestNextly({ adapter, collections: [parcels] });
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
    return createTestNextly({ adapter, collections: [parcels] });
  });
});
