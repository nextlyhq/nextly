/**
 * D35 Unit A — the collection facade forwards `RequestContext.overrideAccess`
 * to the entry service on every access method. A focused unit test with a spied
 * entry service: the live `createTestNextly` create path can't exercise this (it
 * has a hook-wiring gap and doesn't register code-access rules), so we assert the
 * threading directly.
 */
import { describe, expect, it, vi } from "vitest";

import { CollectionService } from "./collection-service";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function make(entry: Record<string, unknown>): CollectionService {
  return new CollectionService(
    {} as never,
    noopLogger as never,
    {} as never,
    entry as never
  );
}

const ok = { success: true, data: { id: "1" } };

describe("CollectionService threads RequestContext.overrideAccess (D35, Unit A)", () => {
  it("createEntry forwards overrideAccess to the entry service", async () => {
    const entry = { createEntry: vi.fn().mockResolvedValue(ok) };
    await make(entry).createEntry(
      "vault",
      { title: "a" },
      { overrideAccess: true }
    );
    expect(entry.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "vault",
        overrideAccess: true,
      }),
      { title: "a" }
    );
  });

  it("findEntryById forwards overrideAccess (single-object-arg read method)", async () => {
    const entry = { getEntry: vi.fn().mockResolvedValue(ok) };
    await make(entry).findEntryById("vault", "1", { overrideAccess: true });
    expect(entry.getEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "vault",
        entryId: "1",
        overrideAccess: true,
      })
    );
  });

  it("defaults overrideAccess to undefined when the context omits it", async () => {
    const entry = { createEntry: vi.fn().mockResolvedValue(ok) };
    await make(entry).createEntry("vault", { title: "a" }, {});
    expect(entry.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: undefined }),
      { title: "a" }
    );
  });
});
