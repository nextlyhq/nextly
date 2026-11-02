/**
 * Upcoming releases' source against a real database, as readers with
 * different rights: the scheduled releases soonest first, each with its
 * entries and what its checks found; the stopped and overdue line counted by
 * the Releases list's own rule; and nothing at all when nothing is scheduled,
 * stopped or overdue, which is what takes the card off the dashboard.
 *
 * What only a database can settle: that the rows are the Releases list's
 * Upcoming tab and the line its Needs attention tab, so a release a few
 * minutes past its instant is in exactly one of them; that the counts come out
 * right from stored rows on every dialect; and that a reader who may not read
 * releases is told nothing of them.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { WidgetQuery } from "../../widgets/query";
import { sourceResolver } from "../../widgets/resolved-sources";
import { RELEASE_MEMBERS_TABLE, RELEASES_TABLE } from "../release-tables";
import { releaseMemberKey } from "../release-member-key";
import { RELEASES_SOURCE_ID } from "../releases-widget-source";
import type { ReleasesService } from "../services/releases-service";

import { seedLiveAuthor } from "./helpers/live-author";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const ARTICLES = "ur_articles";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let current: TestNextly | undefined;
/** The live author every member is added by: a member whose author is gone is a problem. */
let author: string | null = null;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A super admin's API key holding `permissions`: judged on its own scope, so
 * the bypass cannot widen what it reads.
 */
function scoped(permissions: string[]): ReadCaller {
  return {
    user: { id: "admin", roles: ["super-admin"] },
    authenticatedScope: { actorType: "apiKey", permissions },
  };
}

const READER = scoped(["read-content-releases", `read-${ARTICLES}`]);
/** May read the articles, and not releases. */
const BARRED = scoped([`read-${ARTICLES}`]);

/** The card's own question: every field it draws, and the attention rows. */
const QUERY: WidgetQuery = {
  source: RELEASES_SOURCE_ID,
  op: "list",
  select: [
    "kind",
    "id",
    "title",
    "scheduledAt",
    "entries",
    "issues",
    "reason",
    "count",
  ],
  limit: 6,
};

async function answer(caller: ReadCaller) {
  const resolve = sourceResolver(RELEASES_SOURCE_ID);
  if (!resolve) throw new Error("system:releases is not registered");
  const result = await resolve(QUERY, caller);
  if (result.op !== "list") throw new Error(result.op);
  return result.items;
}

describe.each(getConfiguredTestDialects())(
  "Upcoming releases' source (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: ARTICLES,
            status: true,
            fields: [text({ name: "title", required: true })],
          }),
        ],
      });
      author = await seedLiveAuthor(current);
      return current;
    }

    /** An article, stored through the ordinary write. */
    async function article(t: TestNextly): Promise<string> {
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const created = await handler.createEntry(
        { collectionName: ARTICLES, overrideAccess: true },
        { title: "Fine", status: "draft" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      return id;
    }

    /** Empty an article's required title on its stored row: a hard problem. */
    async function breakTitle(t: TestNextly, id: string): Promise<void> {
      await t.adapter.update(
        `dc_${ARTICLES}`,
        { title: "" },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

    /** A release in a state at an instant, holding these articles, straight into its tables. */
    async function release(
      t: TestNextly,
      title: string,
      state: "scheduled" | "blocked" | "draft",
      at: Date,
      entryIds: readonly string[]
    ): Promise<string> {
      const id = crypto.randomUUID();
      const now = new Date();
      await t.adapter.insert(RELEASES_TABLE, {
        id,
        title,
        description: null,
        scheduledAt: state === "draft" ? null : at,
        timezone: "UTC",
        state,
        publishedAt: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        revision: 0,
      });
      for (const entryId of entryIds) {
        const ref = {
          scopeKind: "collection" as const,
          scopeSlug: ARTICLES,
          entryId,
          locale: null,
        };
        await t.adapter.insert(RELEASE_MEMBERS_TABLE, {
          id: crypto.randomUUID(),
          releaseId: id,
          ...ref,
          action: "publish",
          memberKey: releaseMemberKey(id, ref),
          createdBy: author,
          createdAt: now,
        });
      }
      return id;
    }

    it("lists the upcoming releases soonest first, each with its entries and what its checks found, under the stopped and overdue line", async () => {
      const t = await boot();
      // One at a time: SQLite takes one write at a time.
      const [a, b, c, d, e] = [
        await article(t),
        await article(t),
        await article(t),
        await article(t),
        await article(t),
      ];
      await breakTitle(t, b);
      const later = await release(
        t,
        "Later",
        "scheduled",
        new Date(Date.now() + 2 * DAY),
        [c]
      );
      const soon = await release(
        t,
        "Soon",
        "scheduled",
        new Date(Date.now() + DAY),
        [a, b]
      );
      // A few minutes past its instant: the runner reaches it on its next pass, so it is still
      // upcoming by the list's rule, and not yet overdue.
      const due = await release(
        t,
        "Due",
        "scheduled",
        new Date(Date.now() - 3 * MINUTE),
        [d]
      );
      // An hour past its instant: overdue, and on the line rather than in the rows.
      await release(
        t,
        "Late",
        "scheduled",
        new Date(Date.now() - 60 * MINUTE),
        [e]
      );
      await release(t, "Stuck", "blocked", new Date(Date.now() - DAY), [e]);
      await release(t, "Draft", "draft", new Date(), [e]);

      const items = await answer(READER);
      expect(items.filter(item => item.kind === "release")).toEqual([
        expect.objectContaining({
          id: due,
          title: "Due",
          entries: 1,
          issues: 0,
        }),
        expect.objectContaining({
          id: soon,
          title: "Soon",
          entries: 2,
          issues: 1,
        }),
        expect.objectContaining({
          id: later,
          title: "Later",
          entries: 1,
          issues: 0,
        }),
      ]);
      expect(items.filter(item => item.kind === "attention")).toEqual([
        { kind: "attention", reason: "stopped", count: 1 },
        { kind: "attention", reason: "overdue", count: 1 },
      ]);
    });

    it("counts each part of the line as the Releases list's filtered tab counts it for the same reader", async () => {
      const t = await boot();
      const id = await article(t);
      await release(t, "Late 1", "scheduled", new Date(Date.now() - DAY), [id]);
      await release(t, "Late 2", "scheduled", new Date(Date.now() - 2 * DAY), [
        id,
      ]);
      await release(t, "Stuck", "blocked", new Date(Date.now() - DAY), [id]);

      const line = (await answer(READER)).filter(
        item => item.kind === "attention"
      );
      // The Releases list's own read of each filtered tab, as the same key.
      const releases = container.get<ReleasesService>("releasesService");
      for (const reason of ["stopped", "overdue"] as const) {
        const listed = await releases.find(
          { tab: "attention", reason },
          {
            userId: READER.user.id,
            userRoles: READER.user.roles,
            authenticatedScope: READER.authenticatedScope,
          }
        );
        expect(line.find(item => item.reason === reason)?.count).toBe(
          listed.total
        );
      }
      expect(line.map(item => item.count)).toEqual([1, 2]);
    });

    it("places a release just past its instant, and one past the overdue cutoff, where the Releases list's tabs place them", async () => {
      const t = await boot();
      const id = await article(t);
      // Three minutes late, inside the runner's grace: Upcoming, by the tab's rule.
      const justPast = await release(
        t,
        "Just past",
        "scheduled",
        new Date(Date.now() - 3 * MINUTE),
        [id]
      );
      // Half an hour late, past the cutoff: overdue, in Needs attention.
      const late = await release(
        t,
        "Late",
        "scheduled",
        new Date(Date.now() - 30 * MINUTE),
        [id]
      );
      const next = await release(
        t,
        "Next",
        "scheduled",
        new Date(Date.now() + DAY),
        [id]
      );

      const items = await answer(READER);
      const releases = container.get<ReleasesService>("releasesService");
      const actor = {
        userId: READER.user.id,
        userRoles: READER.user.roles,
        authenticatedScope: READER.authenticatedScope,
      };
      const upcomingTab = await releases.find({ tab: "upcoming" }, actor);
      const overdueTab = await releases.find(
        { tab: "attention", reason: "overdue" },
        actor
      );

      // The card's rows are the Upcoming tab's, and its overdue count the overdue tab's.
      const rows = items.filter(item => item.kind === "release");
      expect(rows.map(item => item.id)).toEqual(
        upcomingTab.rows.map(row => row.id)
      );
      expect(rows.map(item => item.id)).toEqual([justPast, next]);
      expect(overdueTab.rows.map(row => row.id)).toEqual([late]);
      expect(
        items.find(
          item => item.kind === "attention" && item.reason === "overdue"
        )?.count
      ).toBe(overdueTab.total);
    });

    it("answers nothing while nothing is scheduled, stopped or overdue, so the card hides", async () => {
      const t = await boot();
      expect(await answer(READER)).toEqual([]);
      // A draft and a release that already went out are neither upcoming nor in need of
      // attention: still nothing.
      const id = await article(t);
      await release(t, "Draft", "draft", new Date(), [id]);
      expect(await answer(READER)).toEqual([]);
      // The control: one scheduled release, and the answer is no longer empty.
      await release(t, "Next", "scheduled", new Date(Date.now() + DAY), [id]);
      expect(await answer(READER)).toHaveLength(1);
    });

    it("tells a reader who may not read releases nothing of them", async () => {
      const t = await boot();
      const id = await article(t);
      await release(t, "Next", "scheduled", new Date(Date.now() + DAY), [id]);
      await release(t, "Stuck", "blocked", new Date(Date.now() - DAY), [id]);
      // The control: a reader who may read releases is told of both.
      expect(await answer(READER)).toHaveLength(2);
      await expect(answer(BARRED)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  }
);
