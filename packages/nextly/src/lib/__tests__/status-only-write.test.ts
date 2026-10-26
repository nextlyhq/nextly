/**
 * A write changes only an entry's status when its body names `status` and
 * nothing a write would store: judged by the keys alone, never their values.
 */
import { describe, expect, it } from "vitest";

import { isStatusOnlyWrite, statusGate } from "../immutable-system-fields";

describe("isStatusOnlyWrite", () => {
  it("holds for a body naming status alone, on a collection and a Single", () => {
    expect(isStatusOnlyWrite({ status: "published" }, "collection")).toBe(true);
    expect(isStatusOnlyWrite({ status: "draft" }, "single")).toBe(true);
  });

  it("holds beside the system columns a write never stores from a body", () => {
    expect(
      isStatusOnlyWrite(
        {
          status: "published",
          id: "e1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        "collection"
      )
    ).toBe(true);
  });

  it("fails for a body naming any field a write stores, whatever its value", () => {
    expect(
      isStatusOnlyWrite({ status: "published", title: "same" }, "collection")
    ).toBe(false);
    expect(isStatusOnlyWrite({ status: "draft", slug: "s" }, "single")).toBe(
      false
    );
  });

  it("fails for a body that names no status", () => {
    expect(isStatusOnlyWrite({}, "collection")).toBe(false);
    expect(isStatusOnlyWrite({ id: "e1" }, "collection")).toBe(false);
  });
});

describe("statusGate", () => {
  it("asks publish for published, and unpublish for any other status", () => {
    expect(statusGate("published")).toBe("publish");
    expect(statusGate("draft")).toBe("unpublish");
    expect(statusGate(false)).toBe("unpublish");
  });
});
