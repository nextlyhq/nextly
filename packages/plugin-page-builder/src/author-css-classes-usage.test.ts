/**
 * The class usage count (`class-usage.ts`) reads shared styles only. A block's
 * own CSS class names are free text the site's class library never holds, so
 * the count leaves them out and still counts the shared styles beside them.
 */
import { describe, expect, it } from "vitest";

import { classUsageOf } from "./class-usage";

const page = (node: Record<string, unknown>) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/section", version: 1, props: {}, ...node }],
});

describe("a block's own CSS classes in the usage count", () => {
  it("are never counted, and the shared styles beside them still are", () => {
    expect(
      classUsageOf(page({ classes: ["c-framed"], cssClasses: "promo c-dark" }))
        .ids
    ).toEqual(["c-framed"]);
    expect(classUsageOf(page({ cssClasses: "promo c-framed" })).ids).toEqual(
      []
    );
  });
});
