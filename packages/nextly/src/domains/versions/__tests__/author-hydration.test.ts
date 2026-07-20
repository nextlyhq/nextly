/**
 * Version rows store only an author id, so the read path resolves display
 * names. Resolution is decoration on a read the caller already passed, so it
 * must never turn a successful history read into a failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listByIdsSpy = vi.fn();

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({ listUsersByIds: listByIdsSpy })),
}));

import { attachVersionAuthors } from "../author-hydration";
import type { VersionMeta } from "../versions-repository";

function row(createdBy: string | null): VersionMeta {
  return { id: `v-${createdBy ?? "sys"}`, createdBy } as VersionMeta;
}

describe("attachVersionAuthors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves each distinct author id exactly once", async () => {
    listByIdsSpy.mockResolvedValue([{ id: "u1", name: "Ada" }]);

    const result = await attachVersionAuthors([row("u1"), row("u1")]);

    expect(listByIdsSpy).toHaveBeenCalledTimes(1);
    expect(listByIdsSpy).toHaveBeenCalledWith(["u1"]);
    expect(result[0]?.author).toEqual({ id: "u1", name: "Ada" });
    expect(result[1]?.author).toEqual({ id: "u1", name: "Ada" });
  });

  it("leaves a system-written row unattributed without querying", async () => {
    const result = await attachVersionAuthors([row(null)]);

    expect(result[0]?.author).toBeNull();
    expect(listByIdsSpy).not.toHaveBeenCalled();
  });

  it("degrades to a null author when the user no longer exists", async () => {
    // A deleted author must not remove the version from the history.
    listByIdsSpy.mockResolvedValue([]);

    const result = await attachVersionAuthors([row("gone")]);

    expect(result).toHaveLength(1);
    expect(result[0]?.author).toBeNull();
  });

  it("degrades to null authors when the lookup itself fails", async () => {
    listByIdsSpy.mockRejectedValue(new Error("db down"));

    const result = await attachVersionAuthors([row("u1")]);

    expect(result[0]?.author).toBeNull();
  });

  it("preserves the original row fields and order", async () => {
    listByIdsSpy.mockResolvedValue([{ id: "u2", name: "Grace" }]);

    const result = await attachVersionAuthors([row("u1"), row("u2")]);

    expect(result.map(r => r.id)).toEqual(["v-u1", "v-u2"]);
    expect(result[0]?.author).toBeNull();
    expect(result[1]?.author).toEqual({ id: "u2", name: "Grace" });
  });
});
