/**
 * A site served by two instances WITHOUT Nextly's shared cache handlers: each
 * instance keeps its own cache, so nothing tells one about the other's write.
 * In production Nextly then caps every cached read's lifetime at 60 s and
 * warns once per process, so a write still reaches every instance within
 * about a minute.
 *
 * Each leg builds the fixture with Next.js's default caches and serves it
 * twice, Cache Components off and on. The first check shows the instances do
 * not share: a write through A is not served by B at once. The later checks
 * wait for the cap: past it, an instance's first read is served stale once
 * while it refreshes in the background, so each wait reads in a loop until
 * the new value, with its deadline counted from the write.
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
 * 60 s cap on its lifetime, then the one stale answer the first read past it
 * gets while the entry refreshes, with room for a loaded runner.
 */
const FRESH_WITHIN_CAP_MS = 70_000;

/** Reads a second apart while waiting out the cap, not four a second for a minute. */
const CAP_POLL_MS = 1_000;

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

    test("the other instance serves the write within the lifetime cap", async ({
      request,
    }, testInfo) => {
      const took = await servedWithin(
        request,
        running().b,
        "through-a",
        wroteAt,
        FRESH_WITHIN_CAP_MS,
        CAP_POLL_MS
      );
      testInfo.annotations.push({
        type: "fresh on the other instance",
        description: `${String(took)} ms`,
      });
    });

    test("a write outside any request is served by both instances within the lifetime cap", async ({
      request,
    }, testInfo) => {
      const { a, b } = running();
      running().writeOutsideRequest("outside");
      const since = Date.now();
      const tookA = await servedWithin(
        request,
        a,
        "outside",
        since,
        FRESH_WITHIN_CAP_MS,
        CAP_POLL_MS
      );
      const tookB = await servedWithin(
        request,
        b,
        "outside",
        since,
        FRESH_WITHIN_CAP_MS,
        CAP_POLL_MS
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
