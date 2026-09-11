import { describe, expect, it, vi } from "vitest";

import { resolveServiceOpts, wrapCollectionsForPlugin } from "./service-opts";

function mockCollections() {
  return {
    createEntry: vi.fn().mockResolvedValue({ id: "1" }),
    findEntryById: vi.fn().mockResolvedValue({ id: "1" }),
    updateEntry: vi.fn().mockResolvedValue({ id: "1" }),
    count: vi.fn().mockResolvedValue(3),
    createMany: vi.fn().mockResolvedValue({ successful: 1, failed: 0 }),
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

  it("as:'user' with an API key hands the key's own grants to the facade", async () => {
    // The end of the chain the dispatcher starts: a plugin route serving a
    // scoped key passes `ctx.authenticatedScope` through, and the facade must
    // receive it. Without it the facade resolves the key OWNER's roles, so a
    // viewer-scoped key minted by a super-admin is authorized as one.
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createEntry(
      "vault",
      { title: "a" },
      {
        as: "user",
        user: { id: "u1", email: "u@e.com" },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-vault"],
        },
      }
    );
    expect(m.createEntry).toHaveBeenCalledWith(
      "vault",
      { title: "a" },
      {
        user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
        overrideAccess: false,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-vault"],
        },
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

  it("count translates the trailing opts (index 2, D56)", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).count(
      "vault",
      { where: { a: { equals: 1 } } },
      { as: "system" }
    );
    expect(m.count).toHaveBeenCalledWith(
      "vault",
      { where: { a: { equals: 1 } } },
      SYSTEM_CTX
    );
  });

  it("createMany translates the trailing opts (index 2, D56)", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createMany(
      "vault",
      [{ title: "a" }],
      { as: "system" }
    );
    expect(m.createMany).toHaveBeenCalledWith(
      "vault",
      [{ title: "a" }],
      SYSTEM_CTX
    );
  });

  it("count as:'user' with no user rejects before delegating", async () => {
    const m = mockCollections();
    await expect(
      wrapCollectionsForPlugin(m as never).count("vault", {}, { as: "user" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(m.count).not.toHaveBeenCalled();
  });

  describe("the locale a plugin names travels to the facade", () => {
    /*
     * One assertion per branch of `resolveServiceOpts`, because each branch
     * returns its own literal and a literal drops whatever it does not name.
     * A test of one branch says nothing about the other two — which is how
     * the pair could be added to the type and still not travel.
     */
    const LOCALE = { locale: "de", fallbackLocale: "en" } as const;

    it("system: the pair reaches the context", async () => {
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
        as: "system",
        ...LOCALE,
      });
      expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", {
        ...SYSTEM_CTX,
        ...LOCALE,
      });
    });

    it("public: the pair reaches the context", async () => {
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
        as: "public",
        ...LOCALE,
      });
      expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", {
        overrideAccess: false,
        ...LOCALE,
      });
    });

    it("user: the pair reaches the context beside the caller", async () => {
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
        as: "user",
        user: { id: "u1", email: "u@e.com" },
        ...LOCALE,
      });
      expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", {
        user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
        overrideAccess: false,
        ...LOCALE,
      });
    });

    it("carries `fallbackLocale: false`, which is a value and not an absence", async () => {
      // `false` means "no fallback, tell me whether the translation exists".
      // It is the one value in this pair that a `||` or a truthiness check
      // silently turns into the default chain, so it gets its own assertion.
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
        as: "system",
        locale: "fr",
        fallbackLocale: false,
      });
      expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", {
        ...SYSTEM_CTX,
        locale: "fr",
        fallbackLocale: false,
      });
    });

    it.each(["*", "all"])(
      "refuses the selector %j before delegating — it is not a language",
      async selector => {
        // `*` moves every translation's lifecycle in one write and `all`
        // answers a read per language. A route forwarding `?locale=` must
        // not be able to reach either by accident, and no plugin has a
        // designed use for them, so the boundary refuses both. Before
        // delegating: the facade never sees the call.
        const m = mockCollections();
        await expect(
          wrapCollectionsForPlugin(m as never).updateEntry(
            "vault",
            "1",
            { status: "published" },
            { as: "system", locale: selector }
          )
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
        expect(m.updateEntry).not.toHaveBeenCalled();
      }
    );

    it("says nothing about locale when the plugin said nothing", async () => {
      // The control: absent stays absent, so the facade keeps deciding the
      // default rather than being handed an explicit `undefined` to interpret.
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
        as: "system",
      });
      // Asserted as KEY absence. A conjunction of "has the key" and "is not
      // undefined" is false for a key holding `undefined` too, which is the
      // exact output this exists to reject — and it passed against it.
      const ctx = m.findEntryById.mock.calls[0][2] as Record<string, unknown>;
      expect(Object.hasOwn(ctx, "locale")).toBe(false);
      expect(Object.hasOwn(ctx, "fallbackLocale")).toBe(false);
    });
  });

  it("non-access methods pass through unchanged", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).listCollections();
    expect(m.listCollections).toHaveBeenCalledWith();
  });
});

describe("the hook context a plugin passes", () => {
  // How a plugin tells a hook something about the CALL that the row cannot say.
  // Core has accepted this on every collection operation for some time and
  // seeds the shared hook context from it; this facade dropped it, so an
  // `afterRead` hook doing expensive presentation work could not be told that a
  // read was internal.
  it("reaches the service", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).findEntryById("vault", "1", {
      as: "system",
      context: { internalRead: true },
    });
    expect(m.findEntryById).toHaveBeenCalledWith("vault", "1", {
      user: undefined,
      overrideAccess: true,
      context: { internalRead: true },
    });
  });

  it("travels with a user context too", async () => {
    const m = mockCollections();
    await wrapCollectionsForPlugin(m as never).createEntry(
      "vault",
      { title: "a" },
      {
        as: "user",
        user: { id: "u1", email: "u@x" } as never,
        context: { seeded: 1 },
      }
    );
    expect(m.createEntry).toHaveBeenCalledWith(
      "vault",
      { title: "a" },
      expect.objectContaining({ context: { seeded: 1 } })
    );
  });

  it("is absent when the caller passes none", () => {
    // The control: a facade that invented a context would satisfy the two
    // above without carrying anything the caller said.
    expect(resolveServiceOpts({ as: "system" }).context).toBeUndefined();
    expect(
      resolveServiceOpts({ as: "system", context: { a: 1 } }).context
    ).toEqual({ a: 1 });
  });
});
