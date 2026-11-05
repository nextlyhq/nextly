/**
 * The vendored Lucide set: which release it is, and that an id resolves to
 * the icon it names, a renamed one included.
 *
 * @module lucide.test
 */
import { describe, expect, it } from "vitest";

import { lucideVersion, parseIconId, resolveLucideIcon } from "./lucide";

describe("the vendored Lucide set", () => {
  it("is the pinned release, so a change to it is a deliberate one", async () => {
    expect(await lucideVersion()).toBe("1.60.0");
  });

  it("resolves an id to the icon's SVG body and box", async () => {
    const star = await resolveLucideIcon("lucide:star");
    expect(star?.name).toBe("star");
    expect(star?.viewBox).toBe("0 0 24 24");
    expect(star?.body).toMatch(/^<(path|polygon|circle|rect|line|polyline)/);
  });

  it("resolves a renamed icon to the icon it is now", async () => {
    // `activity-square` is Lucide's earlier name for `square-activity`.
    const renamed = await resolveLucideIcon("lucide:activity-square");
    expect(renamed?.name).toBe("square-activity");
    expect(renamed?.id).toBe("lucide:square-activity");
    expect(renamed?.body).toBe(
      (await resolveLucideIcon("lucide:square-activity"))?.body
    );
  });

  it("resolves nothing it does not have, whatever the id looks like", async () => {
    for (const id of [
      "lucide:not-an-icon",
      "other:star",
      "star",
      "lucide:",
      "LUCIDE:STAR",
      // A name spelled like an inherited property is not an icon.
      "lucide:constructor",
    ]) {
      expect(await resolveLucideIcon(id)).toBeNull();
    }
  });

  it("reads an id as its set and name", () => {
    expect(parseIconId("lucide:circle-arrow-up")).toEqual({
      set: "lucide",
      name: "circle-arrow-up",
    });
    expect(parseIconId("lucide star")).toBeNull();
  });
});
