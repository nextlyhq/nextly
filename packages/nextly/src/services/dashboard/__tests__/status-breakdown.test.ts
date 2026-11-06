/**
 * The draft/published breakdown must be the CALLER's breakdown.
 *
 * `getStats` computes `content.totalEntries` from the access-controlled
 * per-collection counts (`collection-counts.test.ts`), but its sibling
 * `status` breakdown used to run raw `SELECT ... GROUP BY status` over the
 * PHYSICAL table -- ignoring the collection's access gate entirely. It
 * therefore reported the WHOLE table's draft/published split to a reader who
 * could see only a fraction of it: the breakdown both disclosed hidden row
 * counts and contradicted the total sitting beside it in the same response.
 *
 * The fix routes the breakdown through the same access-enforced
 * `nextly.count({ overrideAccess: false })` path as the total, once for
 * `status: "published"` and once for the drafts, which are the collection
 * list's Draft filter (`status: "all"` narrowed by `where`). So this file drives the raw
 * per-status counts and the access-controlled ones to DIFFERENT numbers -- a
 * test where they agreed could not tell the two implementations apart -- and
 * asserts `totalEntries === published + draft` for the CALLER, which the raw
 * path could not have satisfied.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));

/** What a count was asked: its lifecycle, and whether it is the list's Draft filter. */
interface CountAsked {
  status?: "all" | "published" | "draft";
  where?: { status?: { equals?: unknown } };
}

/** Which of a collection's entries a count read: the list's drafts, or its `status`. */
const askedFor = ({ status, where }: CountAsked) =>
  where?.status?.equals === "draft" ? "draft" : (status ?? "all");
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count }),
}));

const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
vi.mock("../../../di/container", () => ({ container: { get: containerGet } }));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../shared";
import { DashboardService } from "../dashboard-service";
import { someResources, type ReadCaller } from "../readable-resources";

/**
 * Table-wide truth: 5 rows, 4 published, 1 draft. Alice's own read reaches only
 * 1 of them, which happens to be published.
 */
const RAW_PUBLISHED_EVERYONE = 4;
const RAW_DRAFT_EVERYONE = 1;
const ALICE_VISIBLE_TOTAL = 1;
const ALICE_VISIBLE_PUBLISHED = 1;
const ALICE_VISIBLE_DRAFT = 0;

/** `status: true` is the collection-level Draft/Published lifecycle flag. */
const COLLECTIONS = [
  {
    slug: "posts",
    tableName: "posts",
    labels: { plural: "Posts" },
    fields: [],
    status: true,
  },
];

const CALLER: ReadCaller = {
  user: { id: "alice", roles: ["editor"] },
};

/**
 * Any raw SQL over `posts` answers with EVERYONE's rows, access ignored --
 * the wrong number this fix must stop reaching for.
 */
function makeAdapter(): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
    executeQuery: vi.fn().mockImplementation((sql: string) => {
      if (sql.toLowerCase().includes("group by")) {
        return Promise.resolve([
          { status: "published", count: RAW_PUBLISHED_EVERYONE },
          { status: "draft", count: RAW_DRAFT_EVERYONE },
        ]);
      }
      return Promise.resolve([
        { count: RAW_PUBLISHED_EVERYONE + RAW_DRAFT_EVERYONE },
      ]);
    }),
  } as unknown as DrizzleAdapter;
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeService(adapter: DrizzleAdapter): DashboardService {
  return new DashboardService(adapter, makeLogger());
}

let adapter: DrizzleAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  adapter = makeAdapter();
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
    }
    if (name === "singleRegistryService") {
      return { getAllSingles: vi.fn().mockResolvedValue([]) };
    }
    throw new Error(`unexpected container.get("${name}")`);
  });

  // The access-controlled count answers per the STATUS it was asked for --
  // Alice's one visible row, split by lifecycle. `status: "all"` is what
  // `getCollectionCounts` asks for the total.
  count.mockImplementation((asked: CountAsked) => {
    const entries = askedFor(asked);
    if (entries === "published") {
      return Promise.resolve({ total: ALICE_VISIBLE_PUBLISHED });
    }
    if (entries === "draft") {
      return Promise.resolve({ total: ALICE_VISIBLE_DRAFT });
    }
    return Promise.resolve({ total: ALICE_VISIBLE_TOTAL });
  });
});

describe("the status breakdown honours the caller's row-level access", () => {
  it("reports the CALLER's published/draft split, not the whole table's", async () => {
    const stats = await makeService(adapter).getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.status).toEqual({
      published: ALICE_VISIBLE_PUBLISHED,
      draft: ALICE_VISIBLE_DRAFT,
    });
    // The number a raw, access-blind GROUP BY would have reported -- this is
    // the separating assertion. With the two numbers equal, both
    // implementations would pass.
    expect(stats.status.published).not.toBe(RAW_PUBLISHED_EVERYONE);
    expect(stats.status.draft).not.toBe(RAW_DRAFT_EVERYONE);
  });

  it("keeps the breakdown consistent with the total: totalEntries === published + draft", async () => {
    const stats = await makeService(adapter).getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.content.totalEntries).toBe(ALICE_VISIBLE_TOTAL);
    expect(stats.content.totalEntries).toBe(
      stats.status.published + stats.status.draft
    );
  });

  it("asks for published and draft through the access-enforced count, per collection", async () => {
    await makeService(adapter).getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user: CALLER.user,
        status: "published",
      })
    );
    // The drafts by the collection list's Draft filter, as the Content table
    // counts them: every entry, narrowed to those whose status is draft.
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user: CALLER.user,
        status: "all",
        where: { status: { equals: "draft" } },
      })
    );
    expect(count).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" })
    );
  });

  it("never falls back to a raw GROUP BY over the physical table", async () => {
    await makeService(adapter).getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    const rawCalls = (
      adapter.executeQuery as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    for (const [sql] of rawCalls) {
      expect(String(sql).toLowerCase()).not.toContain("group by");
    }
  });
});
