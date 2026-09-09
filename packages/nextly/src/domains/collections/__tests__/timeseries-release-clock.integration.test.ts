/**
 * A timeseries decides release visibility on the REQUEST's clock, never on the
 * window the caller asked to report on.
 *
 * The two were one instant, for a real reason: `releaseScope` reads its own
 * clock while the plan resolves, and a window that read a second one afterwards
 * could describe a later period than the row filter admitted. But the anchor is
 * a reporting parameter a caller chooses, and whether a scheduled release has
 * happened is not — so sharing them let a window anchored in the future count
 * drafts that are still scheduled, and a timeline could report rows an ordinary
 * published read of the same collection still hides.
 *
 * The suite for the read as a whole cannot see this: its collection declares no
 * status, so release decisions are never consulted and the defect and the fix
 * produce identical answers there.
 *
 * @module domains/collections/__tests__/timeseries-release-clock.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { date, defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../../releases/releases-repository";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "ts_release_posts";

/** The instant every fixture row is dated, well inside what each dialect stores. */
const OCCURRED = new Date("2026-06-15T12:00:00.000Z");
/** After the present, so the release is genuinely still pending as the test runs. */
const SCHEDULED = new Date("2030-01-01T00:00:00.000Z");
/** The window anchor: past the schedule, which is what makes the two clocks differ. */
const ANCHOR = new Date("2031-01-01T00:00:00.000Z");

type Point = { count: number };
type Timeseries = {
  timeseriesEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { points: Point[] } | null;
  }>;
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" }), date({ name: "occurredAt" })],
      }),
    ],
  });
  return current;
}

/** A draft dated inside the window, and the release scheduled to publish it. */
async function draftInScheduledRelease(t: TestNextly): Promise<void> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG },
    { title: "pending", status: "draft", occurredAt: OCCURRED }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId: id,
    locale: null,
    action: "publish",
    // The read path projects a due member only when its author still exists
    // and is active, matching the write path that runs AS them.
    createdBy: await seedLiveAuthor(t),
  });
  await repo.scheduleRelease(release.id, SCHEDULED, "UTC");
}

/** The window the assertions read, wide enough to contain `OCCURRED`. */
async function countedInWindow(
  t: TestNextly,
  extra: Record<string, unknown> = {}
): Promise<number> {
  const handler = t.getService("collectionsHandler") as unknown as Timeseries;
  const res = await handler.timeseriesEntries({
    collectionName: SLUG,
    dateField: "occurredAt",
    interval: "year",
    intervals: 20,
    now: ANCHOR,
    ...extra,
  });
  expect(res.success).toBe(true);
  return (res.data?.points ?? []).reduce((total, p) => total + p.count, 0);
}

describe.each(getConfiguredTestDialects())(
  "a timeseries anchored past a pending release (%s)",
  dialect => {
    it("does not count a draft the release has not published yet", async () => {
      const t = await boot(dialect);
      await draftInScheduledRelease(t);
      expect(await countedInWindow(t)).toBe(0);
    });

    it("counts a published row in the same window", async () => {
      // The must-be-found control. Without it, a window that reached no row at
      // all -- a wrong anchor, an unstorable bound, a collection read as empty
      // -- would satisfy the case above while proving nothing about clocks.
      const t = await boot(dialect);
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      await handler.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "live", status: "published", occurredAt: OCCURRED }
      );
      expect(await countedInWindow(t)).toBe(1);
    });

    it("counts that same draft once the RELEASE clock passes the schedule", async () => {
      // The must-differ control, and the one that names the mechanism. The row,
      // the window and the anchor are identical to the first case; only the
      // instant release visibility is settled against moves. A draft that
      // stayed hidden here would mean the zero above came from something other
      // than the release still being pending.
      const t = await boot(dialect);
      await draftInScheduledRelease(t);
      expect(await countedInWindow(t, { releaseNow: ANCHOR })).toBe(1);
    });
  }
);
