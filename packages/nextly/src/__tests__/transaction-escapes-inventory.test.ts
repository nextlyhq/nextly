/**
 * The printed inventory of transaction escapes: what the accepted list is
 * built from, so its counts, grouping and unknown share must be exact.
 */
import { describe, expect, it } from "vitest";

import { describeInventory } from "./transaction-escapes-inventory";
import { UNKNOWN_SITE } from "./transaction-escapes";

describe("describeInventory", () => {
  it("groups by dialect then site, counts each, and lists the test files that reached it", () => {
    const text = describeInventory([
      {
        dialect: "postgresql",
        key: "packages/a.ts#A.run",
        accepted: false,
        testFile: "/repo/packages/nextly/src/x.integration.test.ts",
      },
      {
        dialect: "postgresql",
        key: "packages/a.ts#A.run",
        accepted: false,
        testFile: "/repo/packages/nextly/src/y.integration.test.ts",
      },
      {
        dialect: "mysql",
        key: "packages/b.ts#B.go",
        accepted: true,
        testFile: "/repo/packages/nextly/src/x.integration.test.ts",
      },
    ]);

    expect(text.split("\n")).toEqual([
      "[transaction escapes] inventory: 3 report(s), 0 (0%) with no call site",
      "mysql:",
      "  1x packages/b.ts#B.go (accepted)",
      "      packages/nextly/src/x.integration.test.ts",
      "postgresql:",
      "  2x packages/a.ts#A.run",
      "      packages/nextly/src/x.integration.test.ts",
      "      packages/nextly/src/y.integration.test.ts",
    ]);
  });

  it("reports the share of reports that named no call site", () => {
    const text = describeInventory([
      { dialect: "mysql", key: UNKNOWN_SITE, accepted: false },
      { dialect: "mysql", key: "packages/b.ts#B.go", accepted: false },
      { dialect: "mysql", key: "packages/b.ts#B.go", accepted: false },
    ]);

    expect(text.split("\n")[0]).toBe(
      "[transaction escapes] inventory: 3 report(s), 1 (33.3%) with no call site"
    );
  });
});
