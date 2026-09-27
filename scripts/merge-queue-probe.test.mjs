/**
 * Holds only while `.github/probe/queue-pass.md` is absent: true on the
 * default branch as it stands, false in a merge group that lands that file
 * ahead of this one.
 */
import { existsSync } from "node:fs";
import { expect, it } from "vitest";

it("finds no .github/probe/queue-pass.md", () => {
  expect(existsSync(new URL("../.github/probe/queue-pass.md", import.meta.url))).toBe(false);
});
