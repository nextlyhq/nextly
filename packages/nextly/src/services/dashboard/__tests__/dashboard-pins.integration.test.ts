/**
 * A reader's dashboard pins against a real database, as readers with
 * different rights.
 *
 * What only a database can settle: that pins are kept per reader and one per
 * target; that a 21st is refused while a re-pin at 20 is not; that a pin its
 * reader may no longer read is hidden and kept, and shown again when access
 * returns; that deleting an entry, several entries or a Single takes every
 * reader's pins of it, and no others; and that before `nextly migrate` creates
 * the table, pins read as none, a pin is refused naming the command, and a
 * delete still succeeds (on PostgreSQL, a statement against a missing table
 * would abort the delete's whole transaction).
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../config";
import { container } from "../../../di/container";
import { MAX_PINS_PER_READER } from "../../../domains/dashboard/dashboard-pins";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DASHBOARD_PINS_TABLE } from "../../../schemas/dashboard-pins/table-name";
import { dashboardPinsService } from "../dashboard-pins-service";
import type { ReadCaller } from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "pn_notes";
const OTHER = "pn_other";
const SITE = "pn_site";

/** Readers the notes' own read rule refuses, changed by a test. */
const refused = new Set<string>();

let current: TestNextly | undefined;

afterEach(async () => {
  refused.clear();
  await current?.destroy();
  current = undefined;
});

const as = (id: string): ReadCaller => ({ user: { id } }) as ReadCaller;

describe.each(getConfiguredTestDialects())(
  "a reader's dashboard pins (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NOTES,
            fields: [text({ name: "title" })],
            admin: { useAsTitle: "title" },
            // A rule only narrows a grant: who holds read-pn_notes still may
            // not read while their id is refused here.
            access: {
              read: ({ user }: { user?: { id?: string } | null }) =>
                !refused.has(user?.id ?? ""),
            },
          }),
          defineCollection({ slug: OTHER, fields: [text({ name: "title" })] }),
        ],
        singles: [
          defineSingle({
            slug: SITE,
            label: { singular: "Site settings" },
            fields: [],
          }),
        ],
      });
      return current;
    }

    async function note(t: TestNextly, title: string): Promise<string> {
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title },
      });
      return String(created.item.id);
    }

    /** Every stored pin, as `userId:slug/entry`, whoever holds it. */
    async function stored(t: TestNextly): Promise<string[]> {
      const rows = await t.adapter.select<{
        userId: string;
        targetSlug: string;
        entryId: string;
      }>(DASHBOARD_PINS_TABLE);
      return rows
        .map(row => `${row.userId}:${row.targetSlug}/${row.entryId}`)
        .sort();
    }

    const entry = (entryId: string) => ({
      targetType: "collection" as const,
      targetSlug: NOTES,
      entryId,
    });
    const site = { targetType: "single" as const, targetSlug: SITE };

    it("keeps each reader's pins, their own alone and one per target, titled", async () => {
      const t = await boot();
      const ana = as(await superAdminUser(t, "pn-ana"));
      const ben = as(await userWhoMay(t, "pn-ben", "read", [NOTES]));
      const first = await note(t, "First");
      const second = await note(t, "Second");
      const pins = dashboardPinsService();

      await pins.pin(ana, entry(first));
      await pins.pin(ana, entry(second));
      await pins.pin(ana, site);
      await pins.pin(ben, entry(first));
      // Pinned again: still one pin.
      await pins.pin(ana, entry(first));

      expect(
        (await pins.list(ana)).map(pin => [pin.targetSlug, pin.title]).sort()
      ).toEqual([
        [NOTES, "First"],
        [NOTES, "Second"],
        [SITE, "Site settings"],
      ]);
      expect((await pins.list(ben)).map(pin => pin.title)).toEqual(["First"]);

      await expect(pins.unpin(ana, entry(second))).resolves.toBe(true);
      await expect(pins.unpin(ana, entry(second))).resolves.toBe(false);
      expect((await pins.list(ana)).map(pin => pin.title).sort()).toEqual([
        "First",
        "Site settings",
      ]);
      // Ben's pin of the same entry is his own, untouched.
      expect((await pins.list(ben)).map(pin => pin.title)).toEqual(["First"]);
    });

    it(`refuses a pin past ${MAX_PINS_PER_READER}, naming the limit, and takes a re-pin at the limit`, async () => {
      const t = await boot();
      const ana = as(await superAdminUser(t, "pn-ana"));
      const ids: string[] = [];
      for (let i = 0; i <= MAX_PINS_PER_READER; i++) {
        ids.push(await note(t, `Note ${i}`));
      }
      const pins = dashboardPinsService();
      for (const id of ids.slice(0, MAX_PINS_PER_READER)) {
        await pins.pin(ana, entry(id));
      }
      await expect(
        pins.pin(ana, entry(ids[MAX_PINS_PER_READER]!))
      ).rejects.toThrow(`at most ${MAX_PINS_PER_READER}`);
      // Already pinned: not a new pin, so not refused.
      await expect(pins.pin(ana, entry(ids[0]!))).resolves.toBeUndefined();
      expect(await pins.list(ana)).toHaveLength(MAX_PINS_PER_READER);
    });

    it("hides a pin its reader may no longer read, keeps it, and shows it again when access returns", async () => {
      const t = await boot();
      const ben = as(await userWhoMay(t, "pn-ben", "read", [NOTES]));
      const first = await note(t, "First");
      const pins = dashboardPinsService();
      await pins.pin(ben, entry(first));
      expect((await pins.list(ben)).map(pin => pin.title)).toEqual(["First"]);

      refused.add("pn-ben");
      // 🔴 Neither its title nor a placeholder: nothing at all.
      expect(await pins.list(ben)).toEqual([]);
      // Kept: the row is still there.
      expect(await stored(t)).toEqual([`pn-ben:${NOTES}/${first}`]);
      // And pinning what they may not read is refused as not found.
      await expect(
        pins.pin(ben, entry(await note(t, "Hidden")))
      ).rejects.toThrow();

      refused.delete("pn-ben");
      expect((await pins.list(ben)).map(pin => pin.title)).toEqual(["First"]);
    });

    it("deletes every reader's pins of a deleted entry, deleted entries and a deleted Single, and no others", async () => {
      const t = await boot();
      const ana = as(await superAdminUser(t, "pn-ana"));
      const ben = as(await superAdminUser(t, "pn-ben"));
      const one = await note(t, "One");
      const two = await note(t, "Two");
      const three = await note(t, "Three");
      const kept = await note(t, "Kept");
      const pins = dashboardPinsService();
      for (const reader of [ana, ben]) {
        for (const id of [one, two, three, kept])
          await pins.pin(reader, entry(id));
        await pins.pin(reader, site);
      }

      // One entry, then two at once by query, then the Single itself.
      await t.nextly.delete({ collection: NOTES, id: one });
      await t.nextly.delete({
        collection: NOTES,
        where: { id: { in: [two, three] } },
      });
      await container
        .get<{
          deleteSingle(slug: string, o: { force: true }): Promise<void>;
        }>("singleRegistryService")
        .deleteSingle(SITE, { force: true });

      expect(await stored(t)).toEqual([
        `pn-ana:${NOTES}/${kept}`,
        `pn-ben:${NOTES}/${kept}`,
      ]);
    });

    it("before nextly migrate: no pins, a pin refused naming the command, and a delete still succeeds", async () => {
      const t = await boot();
      const ana = as(await superAdminUser(t, "pn-ana"));
      const first = await note(t, "First");
      // As a site that has not run `nextly migrate` since the table was added.
      await t.adapter.dropTable(DASHBOARD_PINS_TABLE, { ifExists: true });
      const pins = dashboardPinsService();

      expect(await pins.list(ana)).toEqual([]);
      await expect(pins.pin(ana, entry(first))).rejects.toThrow(
        "nextly migrate"
      );
      // 🔴 On PostgreSQL a pins sweep against the missing table would abort
      // this delete's transaction; asked first, it is skipped.
      await t.nextly.delete({ collection: NOTES, id: first });
      const left = await t.nextly.find({ collection: NOTES, limit: 10 });
      expect(left.items).toEqual([]);
    });
  }
);
