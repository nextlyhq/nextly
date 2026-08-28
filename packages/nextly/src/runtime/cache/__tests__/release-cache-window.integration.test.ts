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
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");

      await expect(releaseBoundedRevalidate(undefined, NOW)).resolves.toBe(
        2 * 60 * 60
      );
    });

    it("is tag-only when nothing is scheduled", async () => {
      // The control. A wiring that always returned a number would satisfy the
      // case above while making every site pay a lifetime it never needed.
      await boot(dialect);

      await expect(releaseBoundedRevalidate(undefined, NOW)).resolves.toBe(
        false
      );
    });

    it("sees a release scheduled AFTER a page already read nothing", async () => {
      // The staleness this closes. A first read memoizes "nothing scheduled"
      // for 30 seconds. Scheduling then flushes the page's tags — but the
      // re-render reads that same memo, so without invalidating it the page is
      // cached tag-only again against a release the schedule already knows
      // about, and stays stale until materialisation finally writes.
      const t = await boot(dialect);
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(false);

      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");

      // No waiting for the TTL: scheduling invalidated the shared memo.
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(2 * 60 * 60);
    });

    it("goes quiet again once the release is CANCELLED", async () => {
      // The control, and the other direction: cancelling must not leave a bound
      // derived from an instant that will never arrive.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Called off" });
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");
      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(2 * 60 * 60);

      await repo.cancelRelease(release.id);

      expect(await releaseBoundedRevalidate(undefined, NOW)).toBe(false);
    });

    it("keeps a caller's SHORTER window", async () => {
      // The bound is a ceiling, not a replacement: a route that asked for sixty
      // seconds meant it.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");

      await expect(releaseBoundedRevalidate(60, NOW)).resolves.toBe(60);
    });

    it("overrides a caller's LONGER window", async () => {
      // The control for the case above, and the reason the bound exists: a
      // route asking for a day must not outlive a release due in two hours.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, at(2 * 60 * 60 * 1000), "UTC");

      await expect(releaseBoundedRevalidate(24 * 60 * 60, NOW)).resolves.toBe(
        2 * 60 * 60
      );
    });
  }
);
