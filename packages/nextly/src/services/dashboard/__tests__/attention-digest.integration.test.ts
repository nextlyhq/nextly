/**
 * The attention digest (`system:attention` asked with `op: "list"`) against a
 * real database, as readers with different rights.
 *
 * What only a database can settle: that the release kinds count exactly what
 * the releases domain says stopped or is overdue, and are absent for a reader
 * of no releases exactly as on a site with none; that a draft and a release
 * due this week add nothing; and that a plugin's item shows only to the
 * readers it should, counts only the collections it declares as each reader
 * reads them, and fails alone when it reads past them.
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
import { defineCollection, text } from "../../../config";
import { scheduleAsItStands } from "../../../domains/releases/__tests__/helpers/release-writes";
import { ReleasesRepository } from "../../../domains/releases/releases-repository";
import type { AttentionDigestItem } from "../../../domains/widgets/attention/digest";
import {
  clearAttentionItems,
  registerAttentionItems,
} from "../../../domains/widgets/attention/items";
import { refreshContentSources } from "../../../domains/widgets/content-sources";
import type { AttentionItem } from "../../../domains/widgets/declaration/dashboard";
import type { WidgetQuery } from "../../../domains/widgets/query";
import { sourceResolver } from "../../../domains/widgets/resolved-sources";
import { ATTENTION_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "ad_notes";
const TASKS = "ad_tasks";
const OTHER = "ad_other";
const OWNER = 'plugin "acme"';

let current: TestNextly | undefined;

afterEach(async () => {
  clearAttentionItems();
  await current?.destroy();
  current = undefined;
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const DIGEST: WidgetQuery = {
  source: ATTENTION_SOURCE_ID,
  op: "list",
  limit: 50,
};

/** The digest `caller` is answered. */
async function digestFor(caller: ReadCaller): Promise<AttentionDigestItem[]> {
  const resolve = sourceResolver(ATTENTION_SOURCE_ID);
  if (!resolve) throw new Error("system:attention is not registered");
  const result = await resolve(DIGEST, caller);
  if (result.op !== "list") throw new Error(result.op);
  return result.items as unknown as AttentionDigestItem[];
}

/** Each item of a digest as `id=count`, with "+" for a floor and "!" for a failure. */
const brief = (items: readonly AttentionDigestItem[]) =>
  items.map(
    ({ id, count, atLeast, failed }) =>
      `${id}=${failed ? "!" : count}${atLeast ? "+" : ""}`
  );

/** The plugin's items, kept as startup keeps them for a plugin named acme. */
function declare(items: AttentionItem[]): void {
  registerAttentionItems([
    {
      owner: OWNER,
      widgets: [],
      suggest: undefined,
      alternatives: undefined,
      attention: items,
      unknownKeys: [],
    },
  ]);
}

describe.each(getConfiguredTestDialects())(
  "the attention digest (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [NOTES, TASKS, OTHER].map(slug =>
          defineCollection({ slug, fields: [text({ name: "title" })] })
        ),
      });
      for (const [collection, n] of [
        [NOTES, 2],
        [TASKS, 1],
        [OTHER, 1],
      ] as const) {
        for (let i = 0; i < n; i++) {
          await current.nextly.create({
            collection,
            data: { title: `${collection} ${i}` },
          });
        }
      }
      // What the query endpoint does before resolving any query: publish the
      // collection sources, which boot does not do.
      await refreshContentSources();
      return current;
    }

    it("counts stopped and overdue releases for a reader of releases, and nothing for anyone else", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      const notesOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-notes", "read", [NOTES]) },
      };
      // Before any release exists: what a reader of no releases must match.
      const noReleases = await digestFor(notesOnly);
      expect(await digestFor(admin)).toEqual([]);

      const repo = new ReleasesRepository(t.adapter);
      const now = Date.now();
      // A draft, and a release due in three days: neither is attention.
      await repo.createRelease({ title: "Draft" });
      const soon = await repo.createRelease({ title: "Due this week" });
      await scheduleAsItStands(repo, soon.id, new Date(now + 3 * DAY), "UTC");
      expect(await digestFor(admin)).toEqual([]);

      const overdue = await repo.createRelease({ title: "Overdue" });
      await scheduleAsItStands(
        repo,
        overdue.id,
        new Date(now - 60 * MINUTE),
        "UTC"
      );
      const stopped = await repo.createRelease({ title: "Stopped" });
      const stoppedAt = new Date(now - 30 * MINUTE);
      await scheduleAsItStands(repo, stopped.id, stoppedAt, "UTC");
      expect(
        await repo.blockReleases([{ id: stopped.id, scheduledAt: stoppedAt }])
      ).toEqual([stopped.id]);

      const items = await digestFor(admin);
      expect(items).toEqual([
        {
          id: "core/overdue-releases",
          kind: "overdue",
          label: "Overdue releases",
          count: 1,
          severity: "critical",
          link: "releases?tab=attention&reason=overdue",
        },
        {
          id: "core/stopped-releases",
          kind: "stopped",
          label: "Releases that stopped",
          count: 1,
          severity: "critical",
          link: "releases?tab=attention&reason=stopped",
        },
      ]);
      // 🔴 A reader of no releases is handed exactly what they were handed on
      // a site with none: no item, no zero, no label.
      expect(await digestFor(notesOnly)).toEqual(noReleases);
      expect(noReleases).toEqual([]);
    });

    it("shows a plugin's items only to readers who may act on them, each counting what they may read", async () => {
      const t = await boot();
      declare([
        {
          id: "acme/waiting",
          label: "Notes and tasks waiting",
          collections: [NOTES, TASKS],
          count: async ({ services, signal }) =>
            (await services.count(NOTES, { signal })) +
            (await services.count(TASKS, { signal })),
          link: "collections/ad_notes",
        },
        {
          id: "acme/flagged",
          label: "Flagged tasks",
          permission: `read-${TASKS}`,
          count: () => Promise.resolve(4),
          link: "collections/ad_tasks",
        },
        {
          // Counts without reading, so only who may see it decides who does:
          // a reader of none of its collections must not, whatever it counts.
          id: "acme/constant",
          label: "Tasks to triage",
          collections: [TASKS],
          count: () => Promise.resolve(5),
          link: "collections/ad_tasks",
        },
      ]);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      const notesOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-notes", "read", [NOTES]) },
      };
      const tasksOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-tasks", "read", [TASKS]) },
      };
      const outsider: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-out", "read", [OTHER]) },
      };

      expect(brief(await digestFor(admin))).toEqual([
        "acme/constant=5",
        "acme/flagged=4",
        "acme/waiting=3",
      ]);
      // 🔴 A reader of one of the two collections gets that one's count: the
      // other answers empty rather than failing the item or leaking its rows.
      expect(brief(await digestFor(notesOnly))).toEqual(["acme/waiting=2"]);
      expect(brief(await digestFor(tasksOnly))).toEqual([
        "acme/constant=5",
        "acme/flagged=4",
        "acme/waiting=1",
      ]);
      // A reader of neither collection, without the permission: nothing at all.
      expect(await digestFor(outsider)).toEqual([]);
      // Plugin items rank as warnings, whatever they count.
      expect(
        (await digestFor(admin)).every(item => item.severity === "warning")
      ).toBe(true);
    });

    it("answers every read of a declared collection the reader may not read with nothing, so the item counts the other", async () => {
      // 🔴 As a count of it is zero: its groups are none and its series is the
      // range's intervals at zero, the answer an empty collection gives, so a
      // reader of one of two collections gets that one's numbers, the item is
      // not failed, and nothing about the other is disclosed.
      const t = await boot();
      const seen: Record<string, { buckets: number; points: number[] }> = {};
      declare([
        {
          id: "acme/spread",
          label: "Notes and tasks, grouped and over time",
          collections: [NOTES, TASKS],
          count: async ({ services, signal }) => {
            let total = 0;
            for (const collection of [NOTES, TASKS]) {
              const { buckets } = await services.groupBy(collection, {
                field: "title",
                signal,
              });
              const { points } = await services.timeseries(collection, {
                range: "7d",
                signal,
              });
              seen[collection] = {
                buckets: buckets.length,
                points: points.map(point => point.count),
              };
              total +=
                10 * buckets.reduce((sum, bucket) => sum + bucket.count, 0) +
                points.reduce((sum, point) => sum + point.count, 0);
            }
            return total;
          },
          link: "collections/ad_notes",
        },
      ]);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      const notesOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-notes", "read", [NOTES]) },
      };

      // The population: both collections read, two notes and one task.
      expect(brief(await digestFor(admin))).toEqual(["acme/spread=33"]);
      expect(brief(await digestFor(notesOnly))).toEqual(["acme/spread=22"]);
      const notes = seen[NOTES];
      const tasks = seen[TASKS];
      expect(notes?.buckets).toBe(2);
      expect(tasks?.buckets).toBe(0);
      // The same intervals as a series read of the readable collection, each
      // at zero: an empty collection's answer, not an empty list.
      expect(tasks?.points).toEqual(notes?.points.map(() => 0));
      expect(notes?.points.length).toBeGreaterThan(1);
    });

    it("refuses a malformed read of a collection the reader may not read, as it does for a reader of it", async () => {
      // 🔴 Checked before "nothing there" is answered: a read that names no
      // field the collection has fails for every reader alike, never only for
      // the one who may read the collection.
      const t = await boot();
      declare([
        {
          id: "acme/misread",
          label: "Tasks grouped by a field they lack",
          collections: [NOTES, TASKS],
          count: async ({ services, signal }) =>
            (await services.count(NOTES, { signal })) +
            (await services.groupBy(TASKS, { field: "no_such_field", signal }))
              .buckets.length,
          link: "collections/ad_notes",
        },
      ]);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      const notesOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "ad-notes", "read", [NOTES]) },
      };
      expect(brief(await digestFor(admin))).toEqual(["acme/misread=!"]);
      expect(brief(await digestFor(notesOnly))).toEqual(["acme/misread=!"]);
    });

    it("fails an item alone when it reads a collection it did not declare", async () => {
      const t = await boot();
      declare([
        {
          id: "acme/sneaky",
          label: "Reads past its collections",
          collections: [NOTES],
          count: ({ services }) => services.count(OTHER),
          link: "collections/ad_notes",
        },
        {
          id: "acme/honest",
          label: "Notes",
          collections: [NOTES],
          count: ({ services }) => services.count(NOTES),
          link: "collections/ad_notes",
        },
      ]);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      expect(brief(await digestFor(admin))).toEqual([
        "acme/honest=2",
        "acme/sneaky=!",
      ]);
    });

    it("shows an item declaring a collection the site lacks to nobody", async () => {
      const t = await boot();
      declare([
        {
          id: "acme/ghost",
          label: "Of a collection that is not here",
          collections: ["ad_missing", NOTES],
          count: () => Promise.resolve(9),
          link: "collections/ad_notes",
        },
      ]);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "ad-admin") },
      };
      expect(await digestFor(admin)).toEqual([]);
    });
  }
);
