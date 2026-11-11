import { expect, test } from "@playwright/test";

import { sharedCacheMayKeep } from "../support/shared-cache.mjs";

/**
 * The cache-header judgement the admin speed check and the prebuilt-page spec
 * share: a shared cache may keep a response only when the header grants it a
 * lifetime, not merely when it refuses nothing.
 */
test("a shared cache keeps only a response granted a lifetime", () => {
  // What Next.js sends for a page prebuilt with no revalidation.
  expect(sharedCacheMayKeep("s-maxage=31536000")).toBe(true);
  expect(sharedCacheMayKeep("public, max-age=60")).toBe(true);
  expect(sharedCacheMayKeep("s-maxage=60, stale-while-revalidate=30")).toBe(
    true
  );

  expect(sharedCacheMayKeep(null)).toBe(false);
  expect(sharedCacheMayKeep("")).toBe(false);
  expect(sharedCacheMayKeep("public")).toBe(false);
  expect(sharedCacheMayKeep("no-cache")).toBe(false);
  expect(sharedCacheMayKeep("max-age=0")).toBe(false);
  expect(sharedCacheMayKeep("s-maxage=0, max-age=60")).toBe(false);
  expect(sharedCacheMayKeep("private, max-age=60")).toBe(false);
  expect(sharedCacheMayKeep("no-store, s-maxage=60")).toBe(false);
  expect(
    sharedCacheMayKeep(
      "private, no-cache, no-store, max-age=0, must-revalidate"
    )
  ).toBe(false);
});
