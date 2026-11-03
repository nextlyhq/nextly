/**
 * Who reaches Remove Layout: the route asks no coarse permission question of
 * its own. A delete or unpublish right expressed as a row rule answers "no"
 * to a question with no row in it, so the route leaves the decision to the
 * Direct API write it makes as the caller, which judges the Layout itself.
 *
 * @module layout-removal/remove-route.test
 */
import { describe, expect, it, vi } from "vitest";

const nextly = {
  find: vi.fn(async (args: { collection: string }) => ({
    items:
      args.collection === "layouts"
        ? [{ id: "landing", status: "published" }]
        : [],
    meta: { hasNext: false },
  })),
  findByID: vi.fn(async () => null),
  findSingle: vi.fn(async () => ({ defaultLayout: "seed" })),
};

vi.mock("@nextlyhq/plugin-sdk", async importActual => ({
  ...(await importActual<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => nextly,
}));

const { removeLayoutRoute } = await import("./remove-route");

describe("the Remove Layout route", () => {
  it("answers a caller whose right a coarse check would refuse, leaving the decision to the write", async () => {
    const can = vi.fn(async () => false);
    const ctx = {
      self: { collections: {}, singles: {} },
      user: { id: "owner-only-writer" },
      caller: {
        can,
        identity: async () => ({ user: { id: "owner-only-writer" } }),
      },
      params: { id: "landing" },
      logger: { warn: () => {} },
      db: {},
      dialect: "sqlite",
    };

    const response = await removeLayoutRoute().handler(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ action: "delete", dryRun: true }),
      }),
      ctx as never
    );

    expect(response.status).toBe(200);
    expect(can).not.toHaveBeenCalled();
  });

  it("refuses a request with no signed-in person", async () => {
    const ctx = {
      self: { collections: {}, singles: {} },
      user: null,
      caller: null,
      params: { id: "landing" },
      logger: { warn: () => {} },
      db: {},
      dialect: "sqlite",
    };

    const refused = await removeLayoutRoute()
      .handler(
        new Request("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ action: "delete", dryRun: true }),
        }),
        ctx as never
      )
      .catch((error: unknown) => error);

    expect((refused as { code?: unknown }).code).toBe("FORBIDDEN");
  });
});
