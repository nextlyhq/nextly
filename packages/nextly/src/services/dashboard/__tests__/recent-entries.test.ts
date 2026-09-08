import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();

vi.mock("../../../direct-api/nextly", () => ({
  getNextly: () => ({ find }),
}));

// Backs `getRegisteredCollections`'s real (unstubbed) path -- see "does not
// query a collection outside the caller's scope" below, which needs the real
// `filterByResource` call to run rather than a stub that already decided the
// answer.
const getAllCollections = vi.fn();
vi.mock("../../../di/container", () => ({
  container: { get: () => ({ getAllCollections }) },
}));

import { DashboardService } from "../dashboard-service";
import { someResources } from "../readable-resources";

function makeService() {
  const adapter = {
    executeQuery: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockResolvedValue([]),
    getDialect: () => "sqlite",
  } as unknown as ConstructorParameters<typeof DashboardService>[0];
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as ConstructorParameters<typeof DashboardService>[1];
  return new DashboardService(adapter, logger);
}

beforeEach(() => {
  vi.clearAllMocks();
  find.mockResolvedValue({ items: [] });
  getAllCollections.mockResolvedValue([]);
});

describe("recent entries", () => {
  it("reads through the Direct API with access control ENFORCED", async () => {
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([
      {
        slug: "posts",
        tableName: "posts",
        label: "Posts",
        group: null,
        useAsTitle: "title",
        hasStatus: true,
      },
    ]);

    const caller = { user: { id: "user-1", roles: ["editor"] } };
    await service.getRecentEntries(5, someResources(["posts"]), caller);

    // The whole point of the change: the read must NOT be a raw query, and it
    // must carry the caller so the ordinary access rules apply. A read that
    // omitted `user` would default to a trusted read and leak exactly what the
    // raw SQL leaked.
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user: { id: "user-1", roles: ["editor"] },
        limit: 5,
        sort: "-updatedAt",
      })
    );
  });

  it("forwards an API key's own scope so it is not judged by its minter's roles", async () => {
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([
      {
        slug: "posts",
        tableName: "posts",
        label: "Posts",
        group: null,
        useAsTitle: "title",
        hasStatus: true,
      },
    ]);

    await service.getRecentEntries(5, someResources(["posts"]), {
      user: { id: "user-1", roles: ["admin"] },
      authenticatedScope: { actorType: "apiKey", permissions: ["posts:read"] },
    });

    // The Direct API's `find` names this option `actor` (it is translated to
    // `authenticatedScope` further down the call chain -- see
    // `direct-api/namespaces/helpers.ts`), so that is the key the caller's
    // `authenticatedScope` must arrive under here.
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorType: "apiKey",
          permissions: ["posts:read"],
        },
      })
    );
  });

  it("requires a caller at compile time -- there is no optional-parameter fallback", async () => {
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([]);

    // `caller` is a required parameter now (not `caller?`): a handler that
    // forgets to build one must fail to compile rather than silently return
    // an empty, unauthenticated-looking feed. This file is NOT in
    // `tsconfig.tests.json`'s exclude list, so `pnpm check-types` actually
    // evaluates this directive -- widening `caller` back to optional makes
    // it unused and the build fails, which is the point.
    // @ts-expect-error -- omitting `caller` must fail to typecheck.
    const result = await service.getRecentEntries(5, someResources(["posts"]));

    // Even reached through a type-system bypass, the call must not throw:
    // with no registered collections there is nothing to read through.
    expect(result).toEqual({ entries: [] });
  });

  it("does not query a collection outside the caller's scope", async () => {
    const service = makeService();
    // Deliberately NOT stubbing `getRegisteredCollections` here: it is the
    // function that applies `filterByResource(scope, ...)`
    // (dashboard-service.ts), so stubbing it is exactly what would let the
    // scope filter be deleted without this test noticing. The registry
    // returns three collections; only "posts" is in scope, so only "posts"
    // may reach `find`.
    getAllCollections.mockResolvedValue([
      {
        slug: "posts",
        tableName: "posts",
        labels: { plural: "Posts" },
        fields: [],
      },
      {
        slug: "pages",
        tableName: "pages",
        labels: { plural: "Pages" },
        fields: [],
      },
      {
        slug: "orders",
        tableName: "orders",
        labels: { plural: "Orders" },
        fields: [],
      },
    ]);

    await service.getRecentEntries(5, someResources(["posts"]), {
      user: { id: "user-1" },
    });

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "posts" })
    );
  });
});

/**
 * `admin.useAsTitle` may name a field of any type.
 *
 * Schema validation checks only that the named field EXISTS, never that it
 * holds a primitive, so `json`, `group`, `repeater`, `component` and `chips`
 * all reach this code as objects or arrays. `String()` on one of those renders
 * `[object Object]` -- a heading that says nothing, in a feed whose whole job
 * is to name the entry.
 *
 * The rule is already written in the comment above this mapping ("narrow by
 * typeof/instanceof first so every branch that reaches String() is already
 * known to be a real primitive") and `updatedAt` and `status` beside it obey
 * it. The title did not.
 */
describe("recent entry headings", () => {
  function collectionWithTitleField(useAsTitle: string) {
    return {
      slug: "posts",
      tableName: "posts",
      label: "Posts",
      group: null,
      useAsTitle,
      hasStatus: false,
    };
  }

  /**
   * The Direct API's `select` is a REAL projection: `applyFieldSelection`
   * (collection-query-service.ts) keeps only `id`, the system timestamps, and
   * whatever key was explicitly asked for -- it does not hand back the whole
   * row regardless of what was requested. A row fixture passed straight
   * through to `entryHeading` -- unprojected -- would let its fallback chain
   * (`data.title`, `data.name`) "work" in a test while being dead code in
   * production, because a real read only ever carries what `select` named.
   *
   * So the mock projects too: a field survives only if `select` asked for it
   * by name. This is what makes "the fallback candidates are in `select`" an
   * assertion that can actually fail.
   */
  function project(
    row: Record<string, unknown>,
    select: Record<string, boolean> | undefined
  ): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    if (row.id !== undefined) projected.id = row.id;
    if (!select) return { ...projected };
    for (const [key, included] of Object.entries(select)) {
      if (included && row[key] !== undefined) projected[key] = row[key];
    }
    return projected;
  }

  async function headingFor(
    row: Record<string, unknown>,
    useAsTitle = "title"
  ): Promise<string> {
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([collectionWithTitleField(useAsTitle)]);
    find.mockImplementation(
      async (args: { select?: Record<string, boolean> }) => ({
        items: [project(row, args.select)],
      })
    );

    const result = await service.getRecentEntries(5, someResources(["posts"]), {
      user: { id: "user-1" },
    });
    return result.entries[0].title;
  }

  it("falls back to the id when the title field holds an object", async () => {
    expect(
      await headingFor({ id: "p1", title: { en: "Hello" }, updatedAt: "" })
    ).toBe("p1");
  });

  it("falls back to the id when the title field holds an array", async () => {
    // A `repeater` or `chips` field named by `useAsTitle`.
    expect(
      await headingFor({ id: "p2", title: ["a", "b"], updatedAt: "" })
    ).toBe("p2");
  });

  it("keeps a numeric title, which is a real primitive", async () => {
    // The positive control for the two above: an implementation that rejected
    // everything but a string would satisfy them and would blank out a
    // numeric title field.
    expect(await headingFor({ id: "p3", title: 2026, updatedAt: "" })).toBe(
      "2026"
    );
  });

  it("skips past an EMPTY string to the next candidate", async () => {
    // An untitled draft. `??` only skips null and undefined, so an empty
    // string reached the heading and rendered as nothing at all.
    expect(
      await headingFor({ id: "p4", title: "", name: "Draft", updatedAt: "" })
    ).toBe("Draft");
  });

  it("skips past an object title to the next candidate rather than to the id", async () => {
    expect(
      await headingFor(
        {
          id: "p5",
          heading: { en: "Hi" },
          title: "Fallback title",
          updatedAt: "",
        },
        "heading"
      )
    ).toBe("Fallback title");
  });

  it("PROJECTS every candidate the walk considers, not just title and name", async () => {
    // 🔴 The projection and the walk are one mechanism in two places. The walk
    // gained `label`, `subject` and `heading`; a projection still naming only
    // `title` and `name` leaves those absent from every real read, so the walk
    // looks widened and cannot reach them -- the dead-code state this file's
    // projecting mock exists to catch, wearing a different shape.
    expect(
      await headingFor({ id: "p7", subject: "Re: hello", updatedAt: "" })
    ).toBe("Re: hello");
    expect(
      await headingFor({ id: "p8", label: "Invoice 4021", updatedAt: "" })
    ).toBe("Invoice 4021");
  });

  it("keeps an ordinary string title", async () => {
    expect(
      await headingFor({ id: "p6", title: "Real title", updatedAt: "" })
    ).toBe("Real title");
  });

  it("projects entryHeading's fallback candidates, so its chain can actually fire", async () => {
    // `entryHeading`'s chain is `data[titleField] ?? data.title ?? data.name`.
    // `applyFieldSelection` keeps only what `select` names, so `title` and
    // `name` reach a real read ONLY if they are asked for here -- proven by
    // the two preceding tests failing without this.
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([collectionWithTitleField("heading")]);

    await service.getRecentEntries(5, someResources(["posts"]), {
      user: { id: "user-1" },
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ title: true, name: true }),
      })
    );
  });

  it("resolves a REAL heading through the fallback chain, from a genuinely projected row", async () => {
    // `useAsTitle` names a field ("heading") this row does not carry -- the
    // realistic case of a field that is empty, absent, or of a type
    // `entryHeading` will not render. `title` reaches the resolver only
    // because the projection above selected it; a select missing the
    // fallback candidates would drop it here exactly as it does in
    // production, and this would resolve to the id instead.
    expect(
      await headingFor(
        {
          id: "p7",
          title: "Selected through a real projection",
          updatedAt: "",
        },
        "heading"
      )
    ).toBe("Selected through a real projection");
  });
});
