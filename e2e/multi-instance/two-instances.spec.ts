/**
 * A site served by two instances sharing Nextly's cache handlers gives the
 * same freshness as one instance: a write through either instance, or made
 * outside any request (a job, the CLI, a script), is served by both within
 * the bound, while their reads stay cached in between.
 *
 * Each leg builds the fixture once and serves it twice, Cache Components off
 * and on. The first check is the control: a change made in the database with
 * no expiry is not served, so the reads are cached, and every later "fresh"
 * is the expiry reaching that instance rather than a read that was never
 * cached.
 *
 * @module multi-instance/two-instances
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
 * How soon the other instance must serve a write. The handlers ask the
 * database about a tag at most every 5 s, so this is that interval with room
 * for a loaded runner; the requirement itself is one minute.
 */
const FRESH_WITHIN_MS = 15_000;

const LEGS: Leg[] = [
  {
    name: "cache-components-off",
    cacheComponents: false,
    sharedHandlers: true,
  },
  { name: "cache-components-on", cacheComponents: true, sharedHandlers: true },
];

for (const leg of LEGS) {
  test.describe(`two instances, ${leg.name}`, () => {
    const running = useLeg(leg);

    test("both instances serve the note from their cache: a change with no expiry is not served", async ({
      request,
    }) => {
      const { a, b } = running();
      expect(await noteOn(request, a)).toBe("v0");
      expect(await noteOn(request, b)).toBe("v0");
      running().writeOutsideRequest("unexpired", true);
      // Past the handlers' lookup interval, so an instance that would
      // re-read the database has had every chance to.
      await new Promise(resolve => setTimeout(resolve, 6_000));
      expect(await noteOn(request, a)).toBe("v0");
      expect(await noteOn(request, b)).toBe("v0");
    });

    test("a write through one instance is served by the other within the bound", async ({
      request,
    }, testInfo) => {
      const { a, b } = running();
      const since = Date.now();
      const res = await request.post(`${a.url}/api/note`, {
        headers: { "x-fixture-secret": WRITE_SECRET },
        data: { value: "through-a" },
      });
      expect(res.status()).toBe(200);
      expect(await noteOn(request, a)).toBe("through-a");
      const took = await servedWithin(
        request,
        b,
        "through-a",
        since,
        FRESH_WITHIN_MS
      );
      testInfo.annotations.push({
        type: "fresh on the other instance",
        description: `${String(took)} ms`,
      });
    });

    test("after a write both instances cache again: a later change with no expiry is not served", async ({
      request,
    }) => {
      const { a, b } = running();
      // An entry the writer filled while its own expiry was still being
      // recorded is judged against that record once it reads it back, and is
      // filled again, so it is read past one lookup interval first: what is
      // checked is that the writer caches again, not that one early entry.
      await new Promise(resolve => setTimeout(resolve, 6_000));
      expect(await noteOn(request, a)).toBe("through-a");
      expect(await noteOn(request, b)).toBe("through-a");
      // The writer included: an instance that kept re-reading the database
      // after its own write would serve this change, and look fresh for the
      // wrong reason in the check after.
      running().writeOutsideRequest("unexpired-after-write", true);
      await new Promise(resolve => setTimeout(resolve, 6_000));
      expect(await noteOn(request, a)).toBe("through-a");
      expect(await noteOn(request, b)).toBe("through-a");
    });

    test("a write outside any request is served by both instances within the bound", async ({
      request,
    }, testInfo) => {
      const { a, b } = running();
      // From when the write began, not when the writing process exited.
      const since = running().writeOutsideRequest("outside");
      // Both read at once, each held to the whole bound from the write.
      const [tookA, tookB] = await Promise.all(
        [a, b].map(instance =>
          servedWithin(request, instance, "outside", since, FRESH_WITHIN_MS)
        )
      );
      testInfo.annotations.push({
        type: "fresh after the write",
        description: `A ${String(tookA)} ms, B ${String(tookB)} ms`,
      });
    });

    test("neither instance warns that the cache handlers are not shared", () => {
      // Last, after every read above: an instance the shared handlers serve
      // gets no lifetime cap and says nothing about one.
      const { a, b } = running();
      expect(loggedKind(a, NOT_SHARED_KIND), "instance A").toBe(0);
      expect(loggedKind(b, NOT_SHARED_KIND), "instance B").toBe(0);
    });
  });
}
