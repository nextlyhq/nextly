/**
 * The dashboard's summary sources. `system:team` asks the Team card's own gate
 * before it counts anyone and gives the roles figure only to a reader who may
 * see roles; `system:content` answers the service's per-collection reading
 * within the reader's scope. Both refuse what they cannot answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countTeamFigure = vi.fn();
const getContentByCollection = vi.fn();
const getContentSingles = vi.fn();
const resolveReadableResources = vi.fn();
const granted = vi.fn<() => string[]>();

vi.mock("../../../di/container", () => ({
  container: {
    has: () => true,
    get: () => ({ countTeamFigure, getContentByCollection, getContentSingles }),
  },
}));
vi.mock("../resolve-readable-resources", () => ({
  resolveReadableResources: (...args: unknown[]) =>
    resolveReadableResources(...args) as unknown,
}));
// The verdicts this reader's grants give; the gate itself is the real one.
vi.mock("../../../domains/widgets/visibility", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/widgets/visibility")
  >()),
  permissionVerdicts: (gates: readonly unknown[]) => {
    const held = new Set(granted());
    const slugs = gates.flatMap(gate =>
      typeof gate === "string"
        ? [gate]
        : (gate as { allOf: (string | string[])[] }).allOf.flat()
    );
    return Promise.resolve(new Map(slugs.map(slug => [slug, held.has(slug)])));
  },
}));

import { executeWidgetQuery } from "../../../domains/widgets/execute";
import {
  clearSources,
  isUnavailableSourceRefusal,
} from "../../../domains/widgets/sources";
import {
  CONTENT_SOURCE_ID,
  TEAM_SOURCE_ID,
} from "../../../domains/widgets/system-source-ids";
import { clearSystemResolvers } from "../../../domains/widgets/system-sources";
import { someResources } from "../readable-resources";
import { registerSummaryWidgetSources } from "../summary-widget-sources";

const SCOPE = someResources(["posts"]);
const POSTS = {
  slug: "posts",
  label: "Posts",
  group: null,
  count: 9,
  published: 7,
  draft: 2,
};

const caller = { user: { id: "user-1", roles: ["editor"] } };
const ask = (extra: Record<string, unknown> = {}) =>
  executeWidgetQuery({ source: TEAM_SOURCE_ID, op: "list", ...extra }, caller);
const rows = (answer: unknown) =>
  (answer as { items: Record<string, unknown>[] }).items;

beforeEach(() => {
  vi.clearAllMocks();
  countTeamFigure.mockImplementation((figure: string) =>
    Promise.resolve(figure === "users" ? 12 : 3)
  );
  resolveReadableResources.mockResolvedValue(SCOPE);
  getContentByCollection.mockResolvedValue([POSTS]);
  getContentSingles.mockResolvedValue([]);
  clearSources();
  clearSystemResolvers();
  registerSummaryWidgetSources();
});

describe("who the team source answers", () => {
  it("answers a reader the card is not for exactly as a missing source, and counts no one", async () => {
    // May read people but neither add nor change them.
    granted.mockReturnValue(["read-users", "read-roles"]);
    const refusal = await ask().catch((error: unknown) => error);
    expect(isUnavailableSourceRefusal(refusal)).toBe(true);
    expect(countTeamFigure).not.toHaveBeenCalled();
  });

  it("gives the people alone to a reader who may not see roles, with no roles row at all", async () => {
    granted.mockReturnValue(["read-users", "create-users"]);
    expect(rows(await ask())).toEqual([{ figure: "users", count: 12 }]);
    // Never counted, rather than counted and dropped.
    expect(countTeamFigure).not.toHaveBeenCalledWith("roles");
  });

  it("gives the roles too to a reader who may see them", async () => {
    granted.mockReturnValue(["read-users", "update-users", "read-roles"]);
    expect(rows(await ask())).toEqual([
      { figure: "users", count: 12 },
      { figure: "roles", count: 3 },
    ]);
  });
});

describe("what it refuses", () => {
  it.each([
    ["a filter", { where: { figure: { equals: "users" } } }],
    ["a sort", { sort: "count" }],
    ["a status", { status: "published" }],
  ])(
    "refuses %s rather than answering a different question",
    async (_, extra) => {
      granted.mockReturnValue(["read-users", "create-users"]);
      await expect(ask(extra)).rejects.toThrow();
      expect(countTeamFigure).not.toHaveBeenCalled();
    }
  );
});

describe("the content source", () => {
  const askContent = (extra: Record<string, unknown> = {}) =>
    executeWidgetQuery(
      { source: CONTENT_SOURCE_ID, op: "list", ...extra },
      caller
    );

  it("asks the service within the scope the access layer gives this reader", async () => {
    const answer = rows(await askContent());
    expect(resolveReadableResources).toHaveBeenCalledWith(caller);
    expect(getContentByCollection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: SCOPE, caller })
    );
    expect(answer).toEqual([{ kind: "collection", ...POSTS }]);
  });

  it("answers the Singles after the collections, in the room the collections leave", async () => {
    getContentSingles.mockResolvedValue([{ slug: "home", label: "Home page" }]);
    const answer = rows(await askContent({ limit: 3 }));
    // 🔴 Without them, retiring the Singles card took every Single off the dashboard.
    expect(getContentSingles).toHaveBeenCalledWith({ scope: SCOPE, limit: 2 });
    expect(answer).toEqual([
      { kind: "collection", ...POSTS },
      { kind: "single", slug: "home", label: "Home page", group: null },
    ]);
  });

  it("asks for no Singles when the collections fill the page", async () => {
    getContentByCollection.mockResolvedValue([
      POSTS,
      { ...POSTS, slug: "pages" },
    ]);
    await askContent({ limit: 2 });
    expect(getContentSingles).not.toHaveBeenCalled();
  });

  it("hands the query's limit to the service, which counts only that page", async () => {
    await askContent({ limit: 7 });
    expect(getContentByCollection).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7 })
    );
  });

  it("answers only the fields a query selected, at most its limit", async () => {
    getContentByCollection.mockResolvedValue([
      POSTS,
      { ...POSTS, slug: "pages", label: "Pages" },
    ]);
    expect(
      rows(await askContent({ select: ["slug", "draft"], limit: 1 }))
    ).toEqual([{ slug: "posts", draft: 2, kind: "collection" }]);
  });

  it("keeps each row's kind whatever was selected, so a Single sharing a collection's slug stays apart", async () => {
    // 🔴 A select without `kind` stripped it, and the two `posts` rows below
    // could not be told apart.
    getContentSingles.mockResolvedValue([
      { slug: "posts", label: "Posts page" },
    ]);
    expect(
      rows(await askContent({ select: ["slug", "label"], limit: 5 }))
    ).toEqual([
      { slug: "posts", label: "Posts", kind: "collection" },
      { slug: "posts", label: "Posts page", kind: "single" },
    ]);
  });

  it("refuses a filter rather than answering a different question", async () => {
    await expect(
      askContent({ where: { slug: { equals: "posts" } } })
    ).rejects.toThrow();
    expect(getContentByCollection).not.toHaveBeenCalled();
  });
});
