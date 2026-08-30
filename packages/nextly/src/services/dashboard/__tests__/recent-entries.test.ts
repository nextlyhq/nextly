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
