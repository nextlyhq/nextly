/**
 * The panel numbers route's own decisions, with the reads it makes stood in at
 * their lowest seam: the Direct API's count, which the dashboard's count runs
 * through as the reader, and the reader's attention digest. A collection kept
 * off the dashboard is still counted; one the reader may not read gives no
 * number; a count's `where` is the one the plugin declared; and the browser
 * names only the plugin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireAuthentication } from "../auth/middleware";
import { requireNextly } from "../direct-api/nextly";
import { recordKeptOffDashboard } from "../domains/widgets/kept-off-dashboard";
import { NextlyError } from "../errors/nextly-error";
import { getHandlerConfig } from "../route-handler/auth-handler";
import { readAttentionDigest } from "../services/dashboard/attention-source";

import { getPluginPanelNumbers } from "./plugin-panel-numbers";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(async () => ({ userId: "reader" })),
  isErrorResponse: (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    "error" in value,
}));
vi.mock("./authenticated-read", () => ({
  PRIVATE_NO_STORE_HEADERS: { "Cache-Control": "private, no-store" },
  readCaller: vi.fn(async () => ({ user: { id: "reader" } })),
}));
vi.mock("../init", () => ({ getCachedNextly: vi.fn(async () => ({})) }));
vi.mock("../route-handler/auth-handler", () => ({
  getHandlerConfig: vi.fn(),
}));
vi.mock("../services/dashboard/attention-source", () => ({
  readAttentionDigest: vi.fn(),
}));
vi.mock("../direct-api/nextly", () => ({ requireNextly: vi.fn() }));

const count = vi.fn<(args: Record<string, unknown>) => Promise<unknown>>();

/**
 * `@acme/library`, owning `patterns` (registered by the host as
 * `site-patterns`) and `layouts`, with three attention items, and the menu a
 * test gives it.
 */
function library(menu: unknown[], extra: object = {}) {
  return {
    name: "@acme/library",
    version: "1.0.0",
    nextly: "*",
    admin: { placement: "standalone" },
    renameMap: { patterns: "site-patterns" },
    contributes: {
      collections: [{ slug: "patterns" }, { slug: "layouts" }],
      dashboard: {
        attention: [
          { id: "acme/fix" },
          { id: "acme/quiet" },
          { id: "acme/broken" },
        ],
      },
      admin: { menu },
    },
    ...extra,
  };
}

function withPlugins(...plugins: object[]) {
  vi.mocked(getHandlerConfig).mockReturnValue({ plugins } as never);
}

async function numbersFor(plugin = "@acme/library") {
  const response = await getPluginPanelNumbers(
    new Request(
      `http://localhost/api/admin-meta/plugin-panel-numbers?plugin=${encodeURIComponent(plugin)}`
    )
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      numbers?: Array<{ index: number; value: number; atLeast: boolean }>;
    },
    response,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireNextly).mockReturnValue({ count } as never);
  count.mockResolvedValue({ total: 0 });
  vi.mocked(readAttentionDigest).mockResolvedValue([]);
  recordKeptOffDashboard("collection", []);
});

describe("GET /api/admin-meta/plugin-panel-numbers", () => {
  it("counts a collection kept off the dashboard, by its registered slug, as the reader", async () => {
    recordKeptOffDashboard("collection", [
      { slug: "site-patterns", admin: { hidden: true } },
    ]);
    count.mockResolvedValue({ total: 7 });
    withPlugins(
      library([
        {
          label: "Patterns",
          to: "/admin/collections/patterns",
          count: { collection: "patterns" },
        },
      ])
    );

    const { status, body, response } = await numbersFor();

    expect(status).toBe(200);
    expect(body.numbers).toEqual([{ index: 0, value: 7, atLeast: false }]);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "site-patterns",
        overrideAccess: false,
        user: { id: "reader" },
      })
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("gives no number for a collection the reader may not read, and answers the rest", async () => {
    count.mockImplementation(async args =>
      args.collection === "layouts"
        ? Promise.reject(NextlyError.forbidden())
        : { total: 4 }
    );
    withPlugins(
      library([
        { label: "Layouts", to: "/l", count: { collection: "layouts" } },
        { label: "Patterns", to: "/p", count: { collection: "patterns" } },
      ])
    );

    const { status, body } = await numbersFor();

    expect(status).toBe(200);
    expect(body.numbers).toEqual([{ index: 1, value: 4, atLeast: false }]);
  });

  it("counts with the declared where, and reads one collection and where once", async () => {
    const drafts = { status: { equals: "draft" } };
    count.mockImplementation(async args => ({
      total: args.where === undefined ? 10 : 3,
    }));
    withPlugins(
      library([
        { label: "All", to: "/a", count: { collection: "patterns" } },
        {
          label: "Drafts",
          to: "/d",
          count: { collection: "patterns", where: drafts },
        },
        {
          label: "Drafts again",
          to: "/d2",
          badge: { collection: "patterns", where: drafts },
        },
      ])
    );

    const { body } = await numbersFor();

    expect(body.numbers).toEqual([
      { index: 0, value: 10, atLeast: false },
      { index: 1, value: 3, atLeast: false },
      { index: 2, value: 3, atLeast: false },
    ]);
    expect(count).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "site-patterns", where: drafts })
    );
  });

  it("reads an attention item's number from the reader's digest, once", async () => {
    vi.mocked(readAttentionDigest).mockResolvedValue([
      {
        id: "acme/fix",
        kind: "plugin",
        label: "Fix",
        count: 99,
        atLeast: true,
        severity: "warning",
      },
      {
        id: "acme/broken",
        kind: "plugin",
        label: "Broken",
        count: 0,
        failed: true,
        severity: "warning",
      },
    ]);
    withPlugins(
      library([
        { label: "Fix", to: "/f", badge: { attention: "acme/fix" } },
        { label: "Quiet", to: "/q", badge: { attention: "acme/quiet" } },
        { label: "Broken", to: "/b", badge: { attention: "acme/broken" } },
      ])
    );

    const { body } = await numbersFor();

    // Present, with its floor; absent, so nothing is waiting: 0; failed: none.
    expect(body.numbers).toEqual([
      { index: 0, value: 99, atLeast: true },
      { index: 1, value: 0, atLeast: false },
    ]);
    expect(readAttentionDigest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readAttentionDigest).mock.calls[0][0]).toEqual({
      user: { id: "reader" },
    });
  });

  it("leaves every attention number out when the digest cannot be read", async () => {
    vi.mocked(readAttentionDigest).mockRejectedValue(new Error("down"));
    count.mockResolvedValue({ total: 2 });
    withPlugins(
      library([
        { label: "Fix", to: "/f", badge: { attention: "acme/fix" } },
        { label: "Layouts", to: "/l", count: { collection: "layouts" } },
      ])
    );

    const { status, body } = await numbersFor();

    expect(status).toBe(200);
    expect(body.numbers).toEqual([{ index: 1, value: 2, atLeast: false }]);
  });

  it("keys each number by its item's place among the published items", async () => {
    count.mockResolvedValue({ total: 5 });
    withPlugins(
      library([
        // Left out of the published menu: a page of its own it does not
        // register. The places are counted after it is gone.
        { label: "Missing", to: "/admin/plugins/acme-library/missing" },
        { label: "Plain", to: "/x" },
        { label: "Layouts", to: "/l", count: { collection: "layouts" } },
      ])
    );

    const { body } = await numbersFor();

    expect(body.numbers).toEqual([{ index: 1, value: 5, atLeast: false }]);
  });

  it("answers an empty list for a plugin it does not know, one with no numbers, and a disabled one", async () => {
    withPlugins(
      library([{ label: "Plain", to: "/x" }]),
      library(
        [{ label: "Layouts", to: "/l", count: { collection: "layouts" } }],
        { name: "@acme/off", enabled: false }
      )
    );

    for (const name of ["@acme/nope", "@acme/library", "@acme/off"]) {
      const { status, body } = await numbersFor(name);
      expect(status).toBe(200);
      expect(body.numbers).toEqual([]);
    }
    expect(count).not.toHaveBeenCalled();
  });

  it("refuses a request naming no plugin", async () => {
    withPlugins(library([]));
    const response = await getPluginPanelNumbers(
      new Request("http://localhost/api/admin-meta/plugin-panel-numbers")
    );
    expect(response.status).toBe(400);
  });

  it("refuses a caller who is not signed in, before reading anything", async () => {
    vi.mocked(requireAuthentication).mockResolvedValueOnce({
      statusCode: 401,
      error: "Authentication required",
    } as never);
    withPlugins(
      library([
        { label: "Layouts", to: "/l", count: { collection: "layouts" } },
      ])
    );

    const { status } = await numbersFor();

    expect(status).toBe(401);
    expect(count).not.toHaveBeenCalled();
    expect(readAttentionDigest).not.toHaveBeenCalled();
  });
});
