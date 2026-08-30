import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();

vi.mock("../../../direct-api/nextly", () => ({
  getNextly: () => ({ find }),
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

  it("refuses to read at all when it has no caller", async () => {
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

    // No caller means no access decision can be made. Reading anyway with
    // `user: undefined` and `overrideAccess: false` is the shape most likely to
    // be mishandled downstream, so refuse here instead.
    const result = await service.getRecentEntries(5, someResources(["posts"]));

    expect(find).not.toHaveBeenCalled();
    expect(result).toEqual({ entries: [] });
  });

  it("does not query a collection outside the caller's scope", async () => {
    const service = makeService();
    vi.spyOn(
      service as unknown as {
        getRegisteredCollections: (s: unknown) => Promise<unknown[]>;
      },
      "getRegisteredCollections"
    ).mockResolvedValue([]);

    await service.getRecentEntries(5, someResources([]), {
      user: { id: "user-1" },
    });

    expect(find).not.toHaveBeenCalled();
  });
});
