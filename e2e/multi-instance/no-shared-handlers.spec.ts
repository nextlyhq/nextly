/**
 * A site served by two instances WITHOUT Nextly's shared cache handlers: each
 * instance keeps its own cache, so nothing tells one about the other's write.
 * In production Nextly then gives every cached read a 30 s revalidate and
 * warns once per process: past it, an instance's first read gets the old
 * value once while the entry refreshes in the background, so a write reaches
 * every instance about 30 s after it, for as long as something reads it.
 *
 * Each leg builds the fixture with Next.js's default caches and serves it
 * twice, Cache Components off and on. The first check shows the instances do
 * not share: a write through A is not served by B at once. The later checks
 * wait out the revalidate, reading in a loop until the new value, with the
 * deadline counted from the write: the loop's reads are what start each
 * refresh, so a stale answer just past 30 s is allowed, and only the deadline
 * is not.
 *
 * @module multi-instance/no-shared-handlers
 */
import { expect, test } from "@playwright/test";

import {
  loggedKind,
  noteOn,
  NOT_SHARED_KIND,
  servedWithin,
  useLeg,
} from "./checks";
import { WRITE_SECRET, type Leg } from "./instances";

/**
 * The longest a read may be served unchanged without shared handlers: the
 * 30 s revalidate, counted from a fill no later than the write; then one poll,
 * whose read gets the old value once and starts the refresh; then about 2 s
 * for the refreshed answer to arrive. With Cache Components on the entry also
 * expires 300 s after its fill, whoever reads it; with it off nothing does, so
 * there it holds only because this loop keeps reading.
 */
const FRESH_WITHIN_REVALIDATE_MS = 33_000;

/** Reads a second apart while waiting out the revalidate. */
const REVALIDATE_POLL_MS = 1_000;

const LEGS: Leg[] = [
  {
    name: "no-shared-handlers-cache-components-off",
    cacheComponents: false,
    sharedHandlers: false,
  },
  {
    name: "no-shared-handlers-cache-components-on",
    cacheComponents: true,
    sharedHandlers: false,
  },
];

for (const leg of LEGS) {
  test.describe(`two instances, ${leg.name}`, () => {
    const running = useLeg(leg);
    let wroteAt = 0;

    test("a write through one instance is not served by the other at once", async ({
      request,
    }) => {
      const { a, b } = running();
      expect(await noteOn(request, a)).toBe("v0");
      expect(await noteOn(request, b)).toBe("v0");
      wroteAt = Date.now();
      const res = await request.post(`${a.url}/api/note`, {
        headers: { "x-fixture-secret": WRITE_SECRET },
        data: { value: "through-a" },
      });
      expect(res.status()).toBe(200);
      // The writer expires its own cache in the request.
      expect(await noteOn(request, a)).toBe("through-a");
      // Nothing carries the write to B, so B still answers from its own
      // cache: without this, the next check could pass on a read that was
      // never cached.
      expect(await noteOn(request, b)).toBe("v0");
    });

    test("the other instance serves the write within the revalidate", async ({
      request,
    }, testInfo) => {
      const took = await servedWithin(
        request,
        running().b,
        "through-a",
        wroteAt,
        FRESH_WITHIN_REVALIDATE_MS,
        REVALIDATE_POLL_MS
      );
      testInfo.annotations.push({
        type: "fresh on the other instance",
        description: `${String(took)} ms`,
      });
    });

    test("a write outside any request is served by both instances within the revalidate", async ({
      request,
    }, testInfo) => {
      const { a, b } = running();
      // From when the write began, not when the writing process exited.
      const since = running().writeOutsideRequest("outside");
      // Both read at once: an instance refreshes on its first read past the
      // revalidate, so one read only after the other is fresh could start its
      // own refresh with too little of the bound left.
      const [tookA, tookB] = await Promise.all(
        [a, b].map(instance =>
          servedWithin(
            request,
            instance,
            "outside",
            since,
            FRESH_WITHIN_REVALIDATE_MS,
            REVALIDATE_POLL_MS
          )
        )
      );
      testInfo.annotations.push({
        type: "fresh after the write",
        description: `A ${String(tookA)} ms, B ${String(tookB)} ms`,
      });
    });

    test("each instance warns once that the cache handlers are not shared", () => {
      // Last, after many reads: one warning per serving process, not per read.
      const { a, b } = running();
      expect(loggedKind(a, NOT_SHARED_KIND), "instance A").toBe(1);
      expect(loggedKind(b, NOT_SHARED_KIND), "instance B").toBe(1);
    });
  });
}
