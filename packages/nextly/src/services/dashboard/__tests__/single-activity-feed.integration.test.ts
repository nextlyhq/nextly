/**
 * A Single's saves in Recent activity and in the 24-hour figure, on every
 * dialect: headed by the Single's label, shown only to someone who may read
 * that Single, and left out of both when the Single is hidden or internal.
 * Which rows a hidden slug removes is decided by the row's stated kind, so a
 * Single and a collection sharing a slug never remove each other's, and a
 * row from before the kind was recorded counts as a collection's.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ActivitySubjectKind } from "../activity-log-service";
import { readActivitySingles } from "../activity-singles";
import {
  allResources,
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "../readable-resources";

const POSTS = "posts";
/** A collection hidden from the navigation. */
const PATTERNS = "patterns";
const SETTINGS = "site-settings";
/** Internal, as a plugin declares its own flags. */
const FLAGS = "nx_flags";
/** Hidden from the navigation by its author. */
const ARCHIVE = "archive";

describeEachDialect("a Single's saves in Recent activity", dialect => {
  let handle: TestNextly | undefined;
  let owner: ReadCaller;

  beforeEach(async () => {
    handle = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
        defineCollection({
          slug: PATTERNS,
          admin: { hidden: true },
          fields: [text({ name: "title" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: SETTINGS,
          label: { singular: "Site Settings" },
          fields: [text({ name: "siteName" })],
        }),
        defineSingle({
          slug: FLAGS,
          label: { singular: "Flags" },
          internal: true,
          fields: [text({ name: "flag" })],
        }),
        defineSingle({
          slug: ARCHIVE,
          label: { singular: "Archive" },
          admin: { hidden: true },
          fields: [text({ name: "note" })],
        }),
      ],
    });
    // The install's first user is its super-admin, for whom nothing about
    // access leaves a row out: what does is the rule under test.
    owner = await firstUser(handle);
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  /** Save a Single as the owner, returning its live document id. */
  const save = async (slug: string, data: Record<string, unknown>) => {
    const result = await handle!
      .getService("singleEntryService")
      .update(slug, data, {
        overrideAccess: true,
        actor: { type: "user", id: String(owner.user.id) },
      });
    expect(result.success, JSON.stringify(result)).toBe(true);
    return (result.data as { id: string }).id;
  };

  const feedFor = async (caller: ReadCaller, scope: ReadableResources) =>
    (
      await handle!.getService("activityLogService").getRecentActivity({
        limit: 20,
        scope,
        caller,
        singles: await readActivitySingles(),
      })
    ).activities;

  it("shows a save headed by the Single's label, as a Single's", async () => {
    const id = await save(SETTINGS, { siteName: "Acme" });
    expect(await feedFor(owner, allResources())).toEqual([
      expect.objectContaining({
        collection: SETTINGS,
        entryId: id,
        entryTitle: "Site Settings",
        subjectKind: "single",
      }),
    ]);
  });

  it("shows it to no one who may not read that Single", async () => {
    await save(SETTINGS, { siteName: "Acme" });
    // In the scope, so the row reaches the per-row check, which refuses a
    // reader with no grant on the Single. The owner seeing it is the control.
    const stranger: ReadCaller = { user: { id: "stranger", roles: [] } };
    expect(await feedFor(stranger, someResources([SETTINGS]))).toEqual([]);
    expect(await feedFor(owner, someResources([SETTINGS]))).toHaveLength(1);
  });

  it("leaves hidden and internal Singles out of the feed and the figure", async () => {
    await save(SETTINGS, { siteName: "Acme" });
    await save(FLAGS, { flag: "on" });
    await save(ARCHIVE, { note: "old" });

    const feed = await feedFor(owner, allResources());
    expect(feed.map(row => row.collection)).toEqual([SETTINGS]);
    expect(await recentChanges(handle!, owner)).toBe(1);
  });

  it("drops a row from before the kind was recorded under a Single's slug", async () => {
    // Such a row is a collection's whose slug a Single has since taken, and
    // showing it as the Single's would put a collection's title under it.
    const id = await save(SETTINGS, { siteName: "Acme" });
    await log(handle!, owner, SETTINGS, null, id);
    const feed = await feedFor(owner, allResources());
    expect(feed.map(row => row.subjectKind)).toEqual(["single"]);
  });

  it("removes only the hidden kind's rows from the figure when a slug is shared", async () => {
    // Under the internal Single's slug only the Single's rows go; under the
    // hidden collection's, the collection's and the kindless ones go, since a
    // row stating no kind is a collection's. Uneven counts per kind, so each
    // wrong rule gives its own total: right is 3 + 1 = 4; blind to kind and to
    // Singles (the rule this replaces) 6; blind to kind for both 0; kindless
    // read as a Single's 6; kindless dropped 2.
    const rows: [string, ActivitySubjectKind | null, number][] = [
      [FLAGS, "single", 3],
      [FLAGS, "collection", 1],
      [FLAGS, null, 2],
      [PATTERNS, "single", 1],
      [PATTERNS, "collection", 2],
      [PATTERNS, null, 4],
    ];
    for (const [slug, kind, times] of rows) {
      for (let i = 0; i < times; i++) await log(handle!, owner, slug, kind);
    }
    expect(await recentChanges(handle!, owner)).toBe(4);
  });
});

/** The install's first user, its super-admin. */
async function firstUser(handle: TestNextly): Promise<ReadCaller> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const created = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  return { user: { id: created.item.id, roles: ["super-admin"] } };
}

/** One row in the trail, stating `kind` (or none, as a row from before it). */
async function log(
  handle: TestNextly,
  actor: ReadCaller,
  collection: string,
  kind: ActivitySubjectKind | null,
  entryId?: string
): Promise<void> {
  await handle.getService("activityLogService").logActivity({
    actorType: "user",
    userId: String(actor.user.id),
    action: "update",
    collection,
    subjectKind: kind,
    ...(entryId === undefined ? {} : { entryId }),
    entryTitle: `A change to ${collection}`,
  });
}

/** The dashboard's "changed in the last 24 hours" figure, as `getStats` reports it. */
async function recentChanges(
  handle: TestNextly,
  caller: ReadCaller
): Promise<number> {
  const dashboard = handle.getService("dashboardService") as unknown as {
    getStats: (o: {
      scope: ReadableResources;
      caller: ReadCaller;
    }) => Promise<{ content: { recentChanges24h: number } }>;
  };
  const stats = await dashboard.getStats({ scope: allResources(), caller });
  return stats.content.recentChanges24h;
}
