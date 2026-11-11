import { expect } from "@playwright/test";

import { test } from "../support/visible";

/**
 * A header a plugin's proxy handler sets reaches what a visitor is served on a
 * production build, a page served from its prerendered store included: the
 * playground's `proxy.ts` hands every request to `createNextlyProxy`, and the
 * contributions fixture's handler marks each response it lets through.
 *
 * @module tests/production/proxy-handlers
 */

const HEADER = "x-nextly-proxy-fixture";
const FIXTURE = "contributions-fixture";

test.describe("proxy handlers on a production build", () => {
  test("a contributed header reaches a page served from its prerendered store", async ({
    request,
  }) => {
    // `/site/welcome` is built ahead of time; asked until Next says it served
    // the stored render, so the header is read on exactly that response.
    let served: { cache?: string; header?: string } = {};
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request.get("/site/welcome", {
        headers: { cookie: "" },
      });
      expect(response.status()).toBe(200);
      served = {
        cache: response.headers()["x-nextjs-cache"],
        header: response.headers()[HEADER],
      };
      if (served.cache === "HIT") break;
    }
    expect(served.cache, "the page came from its prerendered store").toBe(
      "HIT"
    );
    expect(served.header).toBe(FIXTURE);
  });

  test("a contributed header reaches a page rendered for the request", async ({
    request,
  }) => {
    const response = await request.get("/", { headers: { cookie: "" } });
    expect(response.status()).toBe(200);
    expect(response.headers()[HEADER]).toBe(FIXTURE);
  });
});
