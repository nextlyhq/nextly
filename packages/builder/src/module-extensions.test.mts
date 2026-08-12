import { expect, it } from "vitest";

import { BUNDLED_MODULE, TEST_MODULE } from "./source-modules";

/**
 * A positive control for the extension list, written in one of the extensions
 * it exists to cover.
 *
 * Three things have to agree about `.mts`: the guards must WALK it, the layering
 * guard must CLASSIFY it as a test so it may import `vitest`, and the runner
 * must RUN it. The first two are asserted below. The third cannot be asserted
 * from inside — it is proved by this file executing at all, which is why it is
 * `.mts` rather than a `.ts` file with `.mts` in a string.
 *
 * Without it, narrowing `TEST_GLOBS` back to `.ts` would silently drop whatever
 * `.mts` tests exist and the suite would still report green, because a test that
 * stops being collected looks exactly like a test that passed. That failure has
 * a history here, which is why the control is a file rather than a note.
 */

it("is discovered, classified as a test, and executed under a .mts extension", () => {
  const self = "module-extensions.test.mts";

  // Executing at all is the third assertion. These two cover the other
  // classifications the guards make about this same name.
  expect(BUNDLED_MODULE.test(self)).toBe(true);
  expect(TEST_MODULE.test(self)).toBe(true);
});

it("does not classify a plain module as a test", () => {
  // The separating property: `TEST_MODULE` has to REJECT something, or a
  // predicate that returned true for everything would satisfy the test above
  // while exempting every shipped module from the import allowlist.
  expect(TEST_MODULE.test("source-modules.mts")).toBe(false);
  expect(TEST_MODULE.test("geometry.ts")).toBe(false);
  expect(BUNDLED_MODULE.test("README.md")).toBe(false);
});
