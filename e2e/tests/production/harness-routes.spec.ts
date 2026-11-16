import { expect } from "@playwright/test";

import { test } from "../support/visible";

/**
 * The builder's harness routes do not exist in the build a visitor gets.
 *
 * They register test-only blocks and mount the editor over fixture pages, so
 * a route left reachable would put a test double in front of a visitor. Each
 * is gated by `NEXTLY_E2E_CANVAS_HARNESS`, which the dev suite sets and this
 * one deliberately does not: here they must answer 404.
 *
 * @module tests/production/harness-routes
 */
test.describe("the builder harness routes in a production build", () => {
  for (const route of ["/builder-locks", "/builder-locks?seed=broken"]) {
    test(`${route} answers 404`, async ({ request }) => {
      const response = await request.get(route);
      expect(response.status()).toBe(404);
    });
  }
});
