import { describe, expect, it, vi } from "vitest";

import { wrapCollectionsForPlugin } from "./service-opts";

function mockCollections() {
  return {
    createEntry: vi.fn().mockResolvedValue({ id: "1" }),
    findEntryById: vi.fn().mockResolvedValue({ id: "1" }),
    updateEntry: vi.fn().mockResolvedValue({ id: "1" }),
    listCollections: vi.fn().mockResolvedValue([]), // non-access passthrough
  };
}

const SYSTEM_CTX = { user: undefined, overrideAccess: true };

describe("wrapCollectionsForPlugin (D35, Unit C)", () => {
  it("no opts → system context (overrideAccess:true)", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createEntry("vault", {
      title: "a",
    });
    expect(m.createEntry).toHaveBeenCalledWith(
      "vault",
      { title: "a" },
      SYSTEM_CTX
    );
  });

  it("as:'system' → overrideAccess:true", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createEntry(
      "vault",
      { title: "a" },
      { as: "system" }
    );
    expect(m.createEntry).toHaveBeenCalledWith(
      "vault",
      { title: "a" },
      SYSTEM_CTX
    );
  });

  it("as:'user' → user context, overrideAccess:false", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createEntry(
      "vault",
      { title: "a" },
      { as: "user", user: { id: "u1", email: "u@e.com" } }
    );
    expect(m.createEntry).toHaveBeenCalledWith(
      "vault",
      { title: "a" },
      {
        user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
        overrideAccess: false,
      }
    );
  });

  it("as:'user' with no user rejects (INVALID_INPUT) before delegating", async () => {
    const m = mockCollections();
    await expect(
      wrapCollectionsForPlugin(m as never).createEntry(
        "vault",
        { title: "a" },
        { as: "user" }
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(m.createEntry).not.toHaveBeenCalled();
  });

  it("findEntryById translates the trailing opts (index 2)", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
      as: "system",
    });
    expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", SYSTEM_CTX);
  });

  it("updateEntry translates the trailing opts (index 3)", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).updateEntry(
      "vault",
      "1",
      { title: "b" },
      { as: "system" }
    );
    expect(m.updateEntry).toHaveBeenCalledWith(
      "vault",
      "1",
      { title: "b" },
      SYSTEM_CTX
    );
  });

  it("non-access methods pass through unchanged", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).listCollections();
    expect(m.listCollections).toHaveBeenCalledWith();
  });
});
