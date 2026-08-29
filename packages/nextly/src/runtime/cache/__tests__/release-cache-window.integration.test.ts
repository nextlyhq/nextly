/**
 * The release cache bound, exercised through the wiring rather than in
 * isolation.
 *
 * The first version of this feature computed the bound correctly and then read
 * the adapter off the reader — which does not expose one. Every unit test
 * passed and the bound was inert on every real content route, because nothing
 * exercised the path that resolves the database. So these cases boot a real
 * runtime and go through `releaseBoundedRevalidate`, which is the function both
 * public routes actually call.
 *
 * @module runtime/cache/__tests__/release-cache-window.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TTL_MS } from "../../../domains/releases/pending-transition-cache";
import { ReleasesRepository } from "../../../domains/releases/releases-repository";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { releaseBoundedRevalidate } from "../release-cache-window";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const NOW = new Date("2026-06-01T00:00:00.000Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);

/**
 * The longest any answer may be, because the memo behind it may be that stale.
 *
 * Every case below schedules INSIDE this window, so the schedule is what binds
 * and each assertion still discriminates. A two-hour release — what these cases
 * used before the ceiling existed — now yields the ceiling in every one of
 * them, which would make them pass against wiring that ignored the schedule
 * entirely. One case deliberately schedules outside it, to assert the cap.
 */
const CEILING_SECONDS = DEFAULT_TTL_MS / 1000;
const SOON_MS = 10_000;
const SOON_SECONDS = SOON_MS / 1000;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect });
  return current;
}

describe.each(getConfiguredTestDialects())(
  "the release bound reaches a real read (%s)",
  dialect => {
    it("bounds the lifetime once a release is scheduled ahead", async () => {
      // The case the isolated tests could not see: this resolves the adapter
      // from the container, exactly as a content route does.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(SOON_MS), "UTC");

      await expect(releaseBoundedRevalidate(undefined, NOW)).resolves.toBe(
        SOON_SECONDS
      );
    });

    it("caps a DISTANT release at the staleness ceiling", async () => {
      // The schedule is not the only thing that can shorten a page's life. This
      // server's view of the schedule may be a memo-window old, so a release
      // another server scheduled for five minutes from now is invisible here —
      // and a two-hour page would outlive it.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");

      await expect(releaseBoundedRevalidate(undefined, NOW)).resolves.toBe(
        CEILING_SECONDS
      );
    });

    it("is bounded by the ceiling — NOT tag-only — when nothing is scheduled", async () => {
      // Deliberately a behaviour change, and the defect it closes. `false` means
      // "cache until something flushes this"; on a multi-instance deployment the
      // flush has already happened, on the server that wrote the schedule. This
      // server then caches a page with no expiry at all, on the strength of a
      // memo saying nothing is due, and nothing re-renders it to ask again.
      await boot(dialect);

      await expect(releaseBoundedRevalidate(undefined, NOW)).resolves.toBe(
        CEILING_SECONDS
      );
    });

    it("sees a release scheduled AFTER a page already read nothing", async () => {
      // The staleness this closes. A first read memoizes "nothing scheduled"
      // for 30 seconds. Scheduling then flushes the page's tags — but the
      // re-render reads that same memo, so without invalidating it the page is
      // cached tag-only again against a release the schedule already knows
      // about, and stays stale until materialisation finally writes.
      const t = await boot(dialect);
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(
        CEILING_SECONDS
      );

      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(SOON_MS), "UTC");

      // No waiting for the TTL: scheduling invalidated the shared memo. The
      // release is nearer than the ceiling, so the answer MOVES — a schedule
      // beyond the ceiling would read the same either way and prove nothing.
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(SOON_SECONDS);
    });

    it("goes quiet again once the release is CANCELLED", async () => {
      // The control, and the other direction: cancelling must not leave a bound
      // derived from an instant that will never arrive.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Called off" });
      await repo.scheduleRelease(release.id, at(SOON_MS), "UTC");
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(SOON_SECONDS);

      await repo.cancelRelease(release.id);

      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(
        CEILING_SECONDS
      );
    });

    it("keeps a caller's SHORTER window", async () => {
      // The bound is a ceiling, not a replacement: a route that asked for sixty
      // seconds meant it.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(SOON_MS), "UTC");

      await expect(releaseBoundedRevalidate(5, NOW)).resolves.toBe(5);
    });

    it("overrides a caller's LONGER window", async () => {
      // The control for the case above, and the reason the bound exists: a
      // route asking for a day must not outlive a release due in ten seconds.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(SOON_MS), "UTC");

      await expect(releaseBoundedRevalidate(24 * 60 * 60, NOW)).resolves.toBe(
        SOON_SECONDS
      );
    });
  }
);
