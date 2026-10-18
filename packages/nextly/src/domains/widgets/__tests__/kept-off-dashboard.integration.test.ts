/**
 * Internal and hidden content is never offered or counted on the dashboard, for a super-admin.
 *
 * On a real instance, with collections declared the way the page builder declares its own: an
 * internal usage index (`internal: true`), and user content it hides from the navigation because
 * it has screens of its own (`admin: { hidden: true }`). Both are stored as `admin.hidden`, so
 * both are left out.
 *
 * As the install's first user -- its super-admin -- because that is the caller for whom nothing
 * about ACCESS removes them: the control below proves the super-admin may read every one of
 * them, so whatever leaves them out is the dashboard rule and nothing else.
 *
 * @module domains/widgets/__tests__/kept-off-dashboard.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it } from "vitest";

import { readAccessCaller } from "../../../api/authenticated-read";
import { readableEntities } from "../../../auth/entity-read-access";
import { defineCollection, defineSingle, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  allResources,
  someResources,
} from "../../../services/dashboard/readable-resources";
import type {
  ReadableResources,
  ReadCaller,
} from "../../../services/dashboard/readable-resources";
import { refreshCollectionWidgets } from "../collection-widgets";
import { validateWidgetQuery } from "../query";
import {
  readableCollectionSlugs,
  readableSingleSlugs,
} from "../reader-content";
import { clearSources, listSources } from "../sources";
import { widgetAudience } from "../visibility";

/** Shown: ordinary content. */
const POSTS = "posts";
/** Internal, as the page builder's class-usage index is declared. */
const CLASS_USAGE = "nx_pb_class_usage";
/** Hidden from the navigation, as the page builder's patterns are declared. */
const PATTERNS = "patterns";
/** A shown Single and an internal one. */
const SETTINGS = "site-settings";
const INTERNAL_SINGLE = "nx_pb_flags";

const KEPT_OFF = [CLASS_USAGE, PATTERNS];

describeEachDialect(
  "content kept off the dashboard, as a super-admin",
  dialect => {
    let handle: TestNextly | undefined;
    let superAdmin: ReadCaller;

    beforeEach(async () => {
      handle = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
          defineCollection({
            slug: CLASS_USAGE,
            internal: true,
            fields: [text({ name: "className" })],
          }),
          defineCollection({
            slug: PATTERNS,
            admin: { useAsTitle: "title", hidden: true },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: SETTINGS,
            fields: [text({ name: "siteName" })],
          }),
          defineSingle({
            slug: INTERNAL_SINGLE,
            internal: true,
            fields: [text({ name: "flag" })],
          }),
        ],
      });

      // The FIRST user is the install's super-admin.
      superAdmin = await firstUser(handle);

      // A cold process: what is published below is the refresh's own work.
      clearSources();
      await refreshCollectionWidgets();
    });

    afterEach(async () => {
      clearSources();
      await handle?.destroy();
      handle = undefined;
    });

    it("is content the super-admin may read, so access is not what leaves it out", async () => {
      // The control every assertion below leans on.
      const readable = await readableEntities(
        [POSTS, ...KEPT_OFF, SETTINGS, INTERNAL_SINGLE],
        readAccessCaller(superAdmin)
      );
      expect([...readable].sort()).toEqual(
        [POSTS, ...KEPT_OFF, SETTINGS, INTERNAL_SINGLE].sort()
      );
    });

    it("publishes no widget source for it, so a query naming it reads as an unknown name", () => {
      const ids = listSources().map(source => source.id);
      expect(ids).toContain(`collection:${POSTS}`);
      expect(ids).toContain(`single:${SETTINGS}`);
      for (const slug of KEPT_OFF) {
        expect(ids).not.toContain(`collection:${slug}`);
      }
      expect(ids).not.toContain(`single:${INTERNAL_SINGLE}`);

      // The same refusal, word for word, as a name that was never registered.
      const refusal = (source: string): string => {
        try {
          validateWidgetQuery({ source, op: "count" });
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return "accepted";
      };
      expect(refusal(`collection:${CLASS_USAGE}`)).toBe(
        refusal("collection:never-registered")
      );
      expect(refusal(`collection:${PATTERNS}`)).toBe(
        refusal("collection:never-registered")
      );
    });

    it("offers no card for it", async () => {
      const audience = await widgetAudience(readAccessCaller(superAdmin));
      const offered = new Set(
        audience.visible
          .map(widget => (widget as { collection?: string }).collection)
          .filter((slug): slug is string => slug !== undefined)
      );
      // The population control: the shown collection's cards ARE offered.
      expect(offered.has(POSTS)).toBe(true);
      for (const slug of [...KEPT_OFF, INTERNAL_SINGLE]) {
        expect(offered.has(slug)).toBe(false);
      }
    });

    it("does not make a content card worth offering", async () => {
      expect(await readableCollectionSlugs(superAdmin)).toEqual([POSTS]);
      expect(await readableSingleSlugs(superAdmin)).toEqual([SETTINGS]);
    });

    it("is not counted in the dashboard's content figures", async () => {
      const dashboard = handle!.getService("dashboardService") as unknown as {
        getStats: (o: {
          scope: ReturnType<typeof allResources>;
          caller: ReadCaller;
        }) => Promise<{
          collectionCounts: Array<{ slug: string }>;
          singles: number;
        }>;
      };

      const stats = await dashboard.getStats({
        scope: allResources(),
        caller: superAdmin,
      });

      expect(stats.collectionCounts.map(row => row.slug)).toEqual([POSTS]);
      expect(stats.singles).toBe(1);
    });

    it("leaves its activity out of the recent-changes figure, and keeps the shown content's", async () => {
      // One change to the shown collection and three to the two hidden ones, so a figure that
      // counted them would read 4, and one that dropped everything would read 0.
      await logChanges(handle!, superAdmin, [
        POSTS,
        CLASS_USAGE,
        PATTERNS,
        PATTERNS,
      ]);

      expect(await recentChanges(handle!, allResources(), superAdmin)).toBe(1);
      // A scope that names a hidden collection as well binds the scope's names and the hidden
      // ones in one query, which is where PostgreSQL's numbered placeholders could be misbound.
      expect(
        await recentChanges(
          handle!,
          someResources([POSTS, PATTERNS]),
          superAdmin
        )
      ).toBe(1);
    });
  }
);

describeEachDialect(
  "the recent-changes figure with nothing kept off the dashboard",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    it("counts every collection's activity, with no exclusion to bind", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
          defineCollection({
            slug: "pages",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const owner = await firstUser(handle);
      await logChanges(handle, owner, [POSTS, "pages"]);

      expect(await recentChanges(handle, allResources(), owner)).toBe(2);
    });
  }
);

/** The install's first user, its super-admin. */
async function firstUser(handle: TestNextly): Promise<ReadCaller> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  return { user: { id: owner.item.id, roles: ["super-admin"] } };
}

/** One logged change per collection named, through the service that records them. */
async function logChanges(
  handle: TestNextly,
  actor: ReadCaller,
  collections: readonly string[]
): Promise<void> {
  const activityLog = handle.getService("activityLogService");
  for (const collection of collections) {
    await activityLog.logActivity({
      actorType: "user",
      userId: String(actor.user.id),
      action: "create",
      collection,
      entryTitle: `A change to ${collection}`,
    });
  }
}

/** The dashboard's "changed in the last 24 hours" figure, as `getStats` reports it. */
async function recentChanges(
  handle: TestNextly,
  scope: ReadableResources,
  caller: ReadCaller
): Promise<number> {
  const dashboard = handle.getService("dashboardService") as unknown as {
    getStats: (o: {
      scope: ReadableResources;
      caller: ReadCaller;
    }) => Promise<{ content: { recentChanges24h: number } }>;
  };
  const stats = await dashboard.getStats({ scope, caller });
  return stats.content.recentChanges24h;
}
