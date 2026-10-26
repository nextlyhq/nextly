/**
 * A write changes only an entry's status when its body names `status` and
 * nothing a write would store: judged by the keys alone, never their values.
 */
import { describe, expect, it, vi } from "vitest";

import {
  isStatusOnlyWrite,
  statusGate,
  writeGateFor,
} from "../immutable-system-fields";

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

  it("fails for a body whose status is left undefined, which names no status", () => {
    // The write drops an undefined status, so the body changes nothing it
    // would name: an update, not an unpublish.
    expect(isStatusOnlyWrite({ status: undefined }, "collection")).toBe(false);
    expect(isStatusOnlyWrite({ status: undefined, id: "e1" }, "single")).toBe(
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

describe("writeGateFor", () => {
  it("names the gate a status-only body's status names, on an entry with a lifecycle", async () => {
    await expect(
      writeGateFor({ status: "published" }, "collection", () => true)
    ).resolves.toBe("publish");
    await expect(
      writeGateFor({ status: "draft", id: "e1" }, "single", async () => true)
    ).resolves.toBe("unpublish");
  });

  it("names update for a body naming a field, without reading the lifecycle", async () => {
    const hasLifecycle = vi.fn(() => true);
    await expect(
      writeGateFor(
        { status: "published", title: "t" },
        "collection",
        hasLifecycle
      )
    ).resolves.toBe("update");
    expect(hasLifecycle).not.toHaveBeenCalled();
  });

  it("names update for a status-only body where there is no lifecycle", async () => {
    // `status` is then an ordinary field.
    await expect(
      writeGateFor({ status: "published" }, "collection", () => false)
    ).resolves.toBe("update");
  });

  it("names update for a body whose status is left undefined", async () => {
    await expect(
      writeGateFor({ status: undefined }, "collection", () => true)
    ).resolves.toBe("update");
  });
});
