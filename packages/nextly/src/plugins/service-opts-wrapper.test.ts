import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../errors/nextly-error";
import {
  resolveServiceOpts as resolve,
  type ServiceOpts,
  wrapCollectionsForPlugin as wrap,
} from "./service-opts";

/** No roles for anyone: what a fresh account looks like, and what the tests below assume. */
const deps = { listRoleSlugs: async () => [] as string[] };
const wrapCollectionsForPlugin = (collections: never) =>
  wrap(collections, deps);
const resolveServiceOpts = (opts: ServiceOpts) => resolve(opts, deps);

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
        user: {
          id: "u1",
          email: "u@e.com",
          role: "",
          roles: [],
          permissions: [],
        },
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
        user: {
          id: "u1",
          email: "u@e.com",
          role: "",
          roles: [],
          permissions: [],
        },
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
        user: {
          id: "u1",
          email: "u@e.com",
          role: "",
          roles: [],
          permissions: [],
        },
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

    it("reads an empty locale as none named, so a write cannot slip past the refusal", async () => {
      // `?locale=` forwarded as-is is the empty string. Not a language, not a
      // selector — and the write path reads any falsy locale as "none named",
      // which would file the write under the default language rather than
      // refuse it. So it travels as nothing, the way the wire reads an absent
      // parameter: the key is absent at the facade, not present and empty.
      const m = mockCollections();
      await wrapCollectionsForPlugin(m as never).updateEntry(
        "vault",
        "1",
        { title: "b" },
        { as: "system", locale: "" }
      );
      const ctx = m.updateEntry.mock.calls[0][3] as Record<string, unknown>;
      expect(Object.hasOwn(ctx, "locale")).toBe(false);
    });

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

  it("is absent when the caller passes none", async () => {
    // The control: a facade that invented a context would satisfy the two
    // above without carrying anything the caller said.
    expect(
      (await resolveServiceOpts({ as: "system" })).context
    ).toBeUndefined();
    expect(
      (await resolveServiceOpts({ as: "system", context: { a: 1 } })).context
    ).toEqual({ a: 1 });
  });
});

describe("the transactional writes take ServiceOpts, as the plain writes do", () => {
  // A plugin reaching the access check through `withTransaction` must meet the
  // same gate as one calling `createEntry`. The context below is not a
  // `ServiceOpts` shape at all: it names `overrideAccess` and hands in a caller
  // claiming a role. Taken raw, both reached the service as written.
  const forged = {
    as: "public",
    overrideAccess: true,
    user: { id: "u1", email: "u@x", roles: ["super-admin"] },
  } as unknown as ServiceOpts;
  const forgedUser = {
    overrideAccess: true,
    user: {
      id: "u1",
      email: "u@x",
      role: "super-admin",
      roles: ["super-admin"],
    },
  } as unknown as ServiceOpts;
  const TX = { adapterTransaction: true };

  function mockTransactional() {
    return {
      ...mockCollections(),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      withTransaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work(TX)
      ),
      createEntryInTransaction: vi.fn().mockResolvedValue({ id: "1" }),
      updateEntryInTransaction: vi.fn().mockResolvedValue({ id: "1" }),
      deleteEntryInTransaction: vi.fn().mockResolvedValue(undefined),
    };
  }

  /** The context `createEntry` hands the service for these options. */
  async function plainContext(opts: ServiceOpts): Promise<unknown> {
    const m = mockTransactional();
    await wrapCollectionsForPlugin(m as never).createEntry("vault", {}, opts);
    return m.createEntry.mock.calls[0][2];
  }

  it("createEntryInTransaction: a named overrideAccess elevates nothing", async () => {
    const m = mockTransactional();
    const facade = wrapCollectionsForPlugin(m as never);
    await facade.withTransaction(tx =>
      facade.createEntryInTransaction(tx, "vault", { title: "a" }, forged)
    );
    const ctx = m.createEntryInTransaction.mock.calls[0][3] as Record<
      string,
      unknown
    >;
    expect(m.createEntryInTransaction.mock.calls[0][0]).toBe(TX);
    expect(ctx.overrideAccess).toBe(false);
    expect(ctx.user).toBeUndefined();
    expect(ctx).toEqual(await plainContext(forged));
  });

  it("updateEntryInTransaction: a forged caller's roles are not believed", async () => {
    const m = mockTransactional();
    const facade = wrapCollectionsForPlugin(m as never);
    await facade.withTransaction(tx =>
      facade.updateEntryInTransaction(tx, "vault", "1", { a: 1 }, forgedUser)
    );
    const ctx = m.updateEntryInTransaction.mock.calls[0][4] as {
      overrideAccess: unknown;
      user: { role: unknown; roles: unknown };
    };
    expect(ctx.overrideAccess).toBe(false);
    // The roles come from the lookup, which answers none for this account.
    expect(ctx.user.roles).toEqual([]);
    expect(ctx.user.role).toBe("");
    expect(ctx).toEqual(await plainContext(forgedUser));
  });

  it("deleteEntryInTransaction: translated, and an actor passed past it is dropped", async () => {
    const m = mockTransactional();
    const facade = wrapCollectionsForPlugin(m as never);
    const deleteWithActor = facade.deleteEntryInTransaction as (
      ...args: unknown[]
    ) => Promise<void>;
    await facade.withTransaction(tx =>
      deleteWithActor(tx, "vault", "1", forgedUser, { kind: "user", id: "x" })
    );
    const call = m.deleteEntryInTransaction.mock.calls[0];
    expect(call).toHaveLength(4);
    expect(call[3]).toEqual(await plainContext(forgedUser));
  });

  // A token is only good while the work it was handed to runs. Kept past that,
  // it would write through a transaction that has committed or rolled back,
  // so it must be refused, before the service is reached, and with an error
  // that says the token finished rather than that it was never handed out:
  // the plain "unknown token" refusal would pass these tests too, so the
  // reason is asserted, and the service's call count shows the refusal is a
  // precondition and not a failure partway through.
  const FINISHED = {
    code: "VALIDATION_ERROR",
    logContext: { reason: "plugin-transaction-finished" },
    publicData: {
      errors: [
        {
          path: "tx",
          code: "INVALID",
          message:
            "This transaction has already finished: do this work inside the callback you passed to ctx.services.collections.withTransaction.",
        },
      ],
    },
  };

  it("a token kept past a callback that resolved is refused, before the service", async () => {
    const m = mockTransactional();
    const facade = wrapCollectionsForPlugin(m as never);
    let kept: unknown;
    await facade.withTransaction(async tx => {
      kept = tx;
    });

    const refused = await facade
      .createEntryInTransaction(kept as never, "vault", { title: "late" }, {})
      .catch((error: unknown) => error);

    expect(refused).toMatchObject(FINISHED);
    expect(m.createEntryInTransaction).not.toHaveBeenCalled();
  });

  it("a token kept past a callback that rejected is refused, before the service", async () => {
    const m = mockTransactional();
    const facade = wrapCollectionsForPlugin(m as never);
    let kept: unknown;
    const failed = await facade
      .withTransaction(async tx => {
        kept = tx;
        throw new Error("work failed");
      })
      .catch((error: unknown) => error);
    expect(failed).toMatchObject({ message: "work failed" });

    const refused = await facade
      .updateEntryInTransaction(kept as never, "vault", "1", { a: 1 }, {})
      .catch((error: unknown) => error);

    expect(refused).toMatchObject(FINISHED);
    expect(m.updateEntryInTransaction).not.toHaveBeenCalled();
  });

  it("a write the work started but did not await finishes before the transaction ends", async () => {
    // The service sees the transaction only after the caller is resolved,
    // which for a user awaits a role lookup, so a write the callback fires and
    // forgets passes the token check while the transaction is live and could
    // otherwise reach the service after it ended. The lookup here takes a
    // timer tick, longer than the transaction takes to end, which is what
    // opens that gap. The mock transaction records when it ends; the write
    // must have reached the service by then.
    const order: string[] = [];
    const m = mockTransactional();
    m.withTransaction = vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) => {
        const result = await work(TX);
        order.push("transaction ended");
        return result;
      }
    );
    m.createEntryInTransaction = vi.fn(async () => {
      order.push("service write");
      return { id: "1" };
    });
    const slowLookup = {
      listRoleSlugs: () =>
        new Promise<string[]>(done => setTimeout(() => done([]), 5)),
    };
    const facade = wrap(m as never, slowLookup);
    const asUser: ServiceOpts = {
      as: "user",
      user: { id: "u1", email: "u@e.com" },
    };
    let unawaited: Promise<unknown> | undefined;

    await facade.withTransaction(async tx => {
      unawaited = facade.createEntryInTransaction(tx, "vault", {}, asUser);
    });

    expect(order).toEqual(["service write", "transaction ended"]);
    await expect(unawaited).resolves.toEqual({ id: "1" });
  });

  /** A transaction mock that records whether it reached its commit. */
  function committing(
    m: ReturnType<typeof mockTransactional>,
    order: string[]
  ) {
    m.withTransaction = vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) => {
        const result = await work(TX);
        order.push("commit");
        return result;
      }
    );
  }

  it("a write the work did not await that fails rejects the transaction before its commit", async () => {
    const order: string[] = [];
    const m = mockTransactional();
    committing(m, order);
    const violation = new Error("unique violation");
    m.createEntryInTransaction = vi.fn(async () => {
      order.push("service write failed");
      throw violation;
    });
    const facade = wrapCollectionsForPlugin(m as never);

    const outcome = await facade
      .withTransaction(async tx => {
        // Held, not awaited, by the work; handled here so the test run does
        // not report it as unhandled.
        facade
          .createEntryInTransaction(tx, "vault", {}, {})
          .catch(() => undefined);
      })
      .catch((error: unknown) => error);

    expect(outcome).toBe(violation);
    expect(order).toEqual(["service write failed"]);
  });

  it("a refusal the work awaited and caught leaves the transaction to commit", async () => {
    // The control for the drained-failure rule: a service refusal (here a
    // validation error that never reached the database) settled while the
    // work ran, so the work decides. It caught it and carried on.
    const order: string[] = [];
    const m = mockTransactional();
    committing(m, order);
    m.createEntryInTransaction = vi.fn(async () => {
      order.push("service refused");
      throw NextlyError.validation({
        errors: [{ path: "title", code: "REQUIRED", message: "Required." }],
      });
    });
    m.updateEntryInTransaction = vi.fn(async () => {
      order.push("service write");
      return { id: "1" };
    });
    const facade = wrapCollectionsForPlugin(m as never);

    const result = await facade.withTransaction(async tx => {
      await facade
        .createEntryInTransaction(tx, "vault", {}, {})
        .catch(() => undefined);
      await facade.updateEntryInTransaction(tx, "vault", "1", { a: 1 }, {});
      return "work done";
    });

    expect(result).toBe("work done");
    expect(order).toEqual(["service refused", "service write", "commit"]);
  });

  it("the work's own error wins over a write it did not await that failed too", async () => {
    const order: string[] = [];
    const m = mockTransactional();
    committing(m, order);
    m.createEntryInTransaction = vi.fn(async () => {
      order.push("service write failed");
      throw new Error("unique violation");
    });
    const facade = wrapCollectionsForPlugin(m as never);

    const outcome = await facade
      .withTransaction(async tx => {
        facade
          .createEntryInTransaction(tx, "vault", {}, {})
          .catch(() => undefined);
        throw new Error("work failed");
      })
      .catch((error: unknown) => error);

    expect(outcome).toMatchObject({ message: "work failed" });
    expect(order).toEqual(["service write failed"]);
  });
});
