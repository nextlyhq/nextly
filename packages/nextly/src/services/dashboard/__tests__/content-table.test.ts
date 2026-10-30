/**
 * The Content table's reading, `DashboardService.getContentTable`: which rows
 * make the page, ranked by each one's own last update, and counts made for the
 * rows drawn and no others.
 *
 * Every collaborator answers from a fixture, so each property is watched at
 * the call it depends on: which collections are counted and read, how many of
 * those reads run at once, by which rule the drafts are, whose create decision
 * is asked, where a row's date comes from, and how often, and for which
 * subject, the activity trail is read. A table that counted every collection
 * and kept a page answers the same rows; only the calls tell the two apart.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, find } = vi.hoisted(() => ({ count: vi.fn(), find: vi.fn() }));
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count, find }),
}));

const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
vi.mock("../../../di/container", () => ({ container: { get: containerGet } }));

const { verdict, createDisabledSlugs } = vi.hoisted(() => ({
  verdict: vi.fn<(slug: string) => Promise<boolean>>(),
  createDisabledSlugs: vi.fn<() => Promise<ReadonlySet<string>>>(),
}));
vi.mock("../../../domains/widgets/reader-content", () => ({
  createVerdict: () => verdict,
  createDisabledSlugs: () => createDisabledSlugs(),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { MAX_WIDGET_LIMIT } from "../../../domains/widgets/query-limits";
import type { Logger } from "../../shared";
import type { RecentEdit, RecentEditsOptions } from "../activity-log-service";
import { DashboardService } from "../dashboard-service";
import { someResources, type ReadCaller } from "../readable-resources";

const CALLER: ReadCaller = { user: { id: "alice", roles: ["editor"] } };

/** A collection as the registry holds it; `status: true` is the Draft/Published lifecycle. */
function collection(slug: string, label: string, status = false) {
  return { slug, tableName: slug, labels: { plural: label }, status };
}

/** One save as the trail's walk answers it. */
function save(
  subject: string,
  createdAt: string,
  overrides: Partial<RecentEdit> = {}
): RecentEdit {
  return {
    id: `save-${subject}-${createdAt}`,
    actorType: "user",
    userId: "ana",
    userName: "Ana",
    userEmail: null,
    action: "update",
    collection: subject,
    entryId: `doc-${subject}`,
    entryTitle: "Doc",
    subjectKind: "collection",
    metadata: null,
    createdAt,
    count: 1,
    countAtLeast: false,
    firstCreatedAt: createdAt,
    identityErasedAt: null,
    locale: null,
    ...overrides,
  };
}

/** What each count answers, by collection: its entries and its drafts. */
let entries: Record<string, { all: number; draft: number }> = {};
/** Each collection's newest entry the reader may read, as the ordinary read answers it. */
let newest: Record<string, { id: string; updatedAt: string }> = {};
/** Each Single's stored document, by its table. */
let stored: Record<string, { id: string; updated_at: unknown }> = {};
let collections: ReturnType<typeof collection>[] = [];
let singles: Array<{ slug: string; label?: string; tableName?: string }> = [];
/**
 * The trail's answer to the window read, to a read narrowed to one
 * collection, and to a read narrowed to one Single.
 */
let windowAnswer: { edits: RecentEdit[]; hasMore: boolean } = {
  edits: [],
  hasMore: false,
};
let narrowed: Record<string, RecentEdit[]> = {};
let narrowedSingles: Record<string, RecentEdit[]> = {};
/** The saves a read narrowed to one subject answers, by the option it narrowed with. */
function narrowedAnswer(options: RecentEditsOptions): RecentEdit[] {
  if (options.collection !== undefined) {
    return narrowed[options.collection] ?? [];
  }
  return options.single === undefined
    ? windowAnswer.edits
    : (narrowedSingles[options.single] ?? []);
}
const getRecentEdits = vi.fn((options: RecentEditsOptions) =>
  Promise.resolve(
    options.collection === undefined && options.single === undefined
      ? windowAnswer
      : { edits: narrowedAnswer(options), hasMore: false }
  )
);
const selectOne = vi.fn((table: string) => Promise.resolve(stored[table]));

/** Which entries a count asked for: the list's Draft filter, or every entry. */
function askedFor(asked: {
  status?: string;
  where?: { status?: { equals?: unknown } };
}): "draft" | "all" | "other" {
  if (asked.where?.status?.equals === "draft" && asked.status === "all") {
    return "draft";
  }
  if (asked.where === undefined && asked.status === "all") return "all";
  return "other";
}

function makeService(): DashboardService {
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" }),
    executeQuery: vi.fn(),
    selectOne,
  } as unknown as DrizzleAdapter;
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return new DashboardService(adapter, logger);
}

function table(limit: number, scopeSlugs?: readonly string[]) {
  return makeService().getContentTable({
    scope: someResources(
      scopeSlugs ?? [
        ...collections.map(c => c.slug),
        ...singles.map(s => s.slug),
      ]
    ),
    caller: CALLER,
    limit,
  });
}

/** The collections a call was made for, each once. */
const collectionsOf = (mock: { mock: { calls: unknown[][] } }) =>
  new Set(
    mock.mock.calls.map(
      ([options]) => (options as { collection: string }).collection
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  entries = {};
  newest = {};
  stored = {};
  collections = [];
  singles = [];
  windowAnswer = { edits: [], hasMore: false };
  narrowed = {};
  narrowedSingles = {};
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: () => Promise.resolve(collections) };
    }
    if (name === "singleRegistryService") {
      return { getAllSingles: () => Promise.resolve(singles) };
    }
    if (name === "activityLogService") return { getRecentEdits };
    throw new Error(`unexpected container.get("${name}")`);
  });
  count.mockImplementation(
    (asked: { collection: string; status?: string; where?: object }) => {
      const kind = askedFor(asked);
      const row = entries[asked.collection] ?? { all: 1, draft: 0 };
      if (kind === "other") {
        return Promise.reject(
          new Error(`unexpected count ${JSON.stringify(asked)}`)
        );
      }
      return Promise.resolve({ total: kind === "draft" ? row.draft : row.all });
    }
  );
  find.mockImplementation((asked: { collection: string }) => {
    const entry = newest[asked.collection];
    return Promise.resolve({ items: entry === undefined ? [] : [entry] });
  });
  verdict.mockResolvedValue(true);
  createDisabledSlugs.mockResolvedValue(new Set());
});

describe("the Content table's bounded read", () => {
  // Sixty collections, the registry returning them in reverse order, five of
  // them saved recently, one of those (c50) past the first fifty by label:
  // the page is those five and the first of the rest.
  const SIXTY = Array.from({ length: 60 }, (_, i) => {
    const n = String(i).padStart(2, "0");
    return collection(`c${n}`, `C${n}`);
  }).reverse();
  const SAVED = ["c41", "c07", "c33", "c50", "c12"];
  const at = (i: number) => `2026-10-29T1${9 - i}:00:00.000Z`;

  beforeEach(() => {
    collections = SIXTY;
    windowAnswer = {
      edits: SAVED.map((slug, i) => save(slug, at(i))),
      hasMore: false,
    };
    newest = Object.fromEntries(
      SAVED.map((slug, i) => [slug, { id: `doc-${slug}`, updatedAt: at(i) }])
    );
  });

  it("counts only the collections it draws, out of sixty, and reads the newest entry of fifty: those the window names, then the first by label", async () => {
    const answer = await table(6);
    const page = [...SAVED, "c00"];

    expect(answer.rows.map(row => row.slug)).toEqual(page);
    // 🔴 The separating assertions: reading all sixty and keeping six answers
    // the same rows, and only the calls tell the two apart.
    expect([...collectionsOf(count)].sort()).toEqual([...page].sort());
    expect(count.mock.calls.length).toBeLessThanOrEqual(12);
    // 🔴 At most fifty newest-entry reads, each once: the five the window
    // names, c50 among them though it is past the first fifty by label, then
    // the first forty-five of the rest by label (c00 to c48 less the four
    // saved there). The last ten by label are never read.
    const unread = ["c49", ...SIXTY.map(c => c.slug).filter(s => s > "c50")];
    expect(collectionsOf(find)).toEqual(
      new Set(SIXTY.map(c => c.slug).filter(s => !unread.includes(s)))
    );
    expect(find).toHaveBeenCalledTimes(MAX_WIDGET_LIMIT);
    // The newest entry, one, as the reader, every state.
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        sort: "-updatedAt",
        overrideAccess: false,
        user: CALLER.user,
        status: "all",
      })
    );
    expect(new Set(verdict.mock.calls.map(([slug]) => slug))).toEqual(
      new Set(page)
    );
    // Every row the table could show, counted without a count.
    expect(answer.total).toBe(60);
  });

  it("runs at most four of those reads at once", async () => {
    let running = 0;
    let most = 0;
    find.mockImplementation(async (asked: { collection: string }) => {
      running += 1;
      most = Math.max(most, running);
      // Held past a turn of the event loop, so every read started meanwhile overlaps it.
      await new Promise(resolve => setTimeout(resolve, 0));
      running -= 1;
      const entry = newest[asked.collection];
      return { items: entry === undefined ? [] : [entry] };
    });

    await table(6);

    // 🔴 Four at once, not fifty: `Promise.all` over every read answers the
    // same rows, and only how many overlap tells the two apart.
    expect(most).toBe(4);
  });

  it("reads the trail once when its window reached the trail's end", async () => {
    // A drawn collection with an entry and no save of it in the window: who
    // saved it would be asked past the window, if the window had not reached
    // the trail's end.
    newest.c00 = { id: "doc-c00", updatedAt: "2026-10-01T09:00:00.000Z" };
    await table(6);
    expect(getRecentEdits).toHaveBeenCalledTimes(1);
  });

  it("asks the trail past the window, for who saved a drawn collection's newest entry, only for that collection", async () => {
    windowAnswer = { ...windowAnswer, hasMore: true };
    newest.c00 = { id: "doc-c00", updatedAt: "2026-10-01T09:00:00.000Z" };
    narrowed = {
      c00: [save("c00", "2026-10-01T09:00:00.000Z", { userName: "Ben" })],
    };

    const answer = await table(6);

    const narrowedTo = getRecentEdits.mock.calls
      .map(([options]) => options.collection)
      .filter(slug => slug !== undefined);
    expect(narrowedTo).toEqual(["c00"]);
    expect(getRecentEdits.mock.calls[1]?.[0]).toMatchObject({ limit: 1 });
    expect(answer.rows.at(-1)).toMatchObject({
      slug: "c00",
      updatedAt: "2026-10-01T09:00:00.000Z",
      userName: "Ben",
    });
  });
});

describe("which rows make the page", () => {
  it("ranks each subject by its own last update, though one collection's saves fill the trail's window", async () => {
    collections = [
      collection("busy", "Busy"),
      collection("archive", "Archive"),
      collection("news", "News"),
    ];
    // More saves of busy than the window holds, newest first: every save in it
    // is busy's, and news's latest save lies past it.
    const busyAt = (i: number) =>
      `2026-10-29T10:${String(MAX_WIDGET_LIMIT - 1 - i).padStart(2, "0")}:00.000Z`;
    windowAnswer = {
      edits: Array.from({ length: MAX_WIDGET_LIMIT }, (_, i) =>
        save("busy", busyAt(i), { entryId: `doc-busy-${i}` })
      ),
      hasMore: true,
    };
    newest = {
      busy: { id: "doc-busy-0", updatedAt: busyAt(0) },
      news: { id: "doc-news", updatedAt: "2026-10-29T09:00:00.000Z" },
      // Untouched for years, and first by label.
      archive: { id: "doc-archive", updatedAt: "2024-01-05T08:00:00.000Z" },
    };
    narrowed = {
      news: [save("news", "2026-10-29T09:00:00.000Z", { userName: "Ben" })],
    };

    const answer = await table(2);

    // 🔴 News, saved more recently than Archive, is drawn and Archive is not,
    // though the window holds no save of either.
    expect(answer.rows.map(row => row.slug)).toEqual(["busy", "news"]);
    expect(answer.rows[1]).toMatchObject({
      updatedAt: "2026-10-29T09:00:00.000Z",
      userName: "Ben",
    });
  });
});

describe("the Content table's rows", () => {
  it("takes each row's Updated from its own data, never from the trail", async () => {
    collections = [collection("posts", "Posts")];
    singles = [{ slug: "home", label: "Home", tableName: "single_home" }];
    // The trail's save of posts is older than its newest entry, and the trail
    // holds no save of Home at all.
    windowAnswer = {
      edits: [save("posts", "2026-10-20T10:00:00.000Z")],
      hasMore: false,
    };
    newest = {
      posts: { id: "doc-posts", updatedAt: "2026-10-29T10:00:00.000Z" },
    };
    // Saved long before any trail window.
    stored = {
      single_home: {
        id: "doc-home",
        updated_at: new Date("2024-01-05T08:00:00Z"),
      },
    };

    const answer = await table(10);
    const bySlug = new Map(answer.rows.map(row => [row.slug, row]));

    expect(bySlug.get("posts")).toMatchObject({
      updatedAt: "2026-10-29T10:00:00.000Z",
    });
    // 🔴 A real date never reads as unknown for want of a trail row.
    expect(bySlug.get("home")).toMatchObject({
      updatedAt: "2024-01-05T08:00:00.000Z",
    });
    expect(bySlug.get("home")).not.toHaveProperty("userName");
    // Read from the Single's table, never through a read that would create it.
    expect(selectOne).toHaveBeenCalledWith("single_home", {
      columns: ["id", "updated_at"],
    });
  });

  it("names who saved a Single only when the trail's save is of its document", async () => {
    singles = [
      { slug: "home", label: "Home", tableName: "single_home" },
      { slug: "about", label: "About", tableName: "single_about" },
    ];
    windowAnswer = {
      edits: [
        save("home", "2026-10-29T10:00:00.000Z", {
          subjectKind: "single",
          entryId: "doc-home",
        }),
        // A save of the document About had before it was created again.
        save("about", "2026-10-28T10:00:00.000Z", {
          subjectKind: "single",
          entryId: "doc-earlier-about",
        }),
      ],
      hasMore: false,
    };
    stored = {
      single_home: { id: "doc-home", updated_at: "2026-10-29T10:00:00.000Z" },
      single_about: { id: "doc-about", updated_at: "2026-10-29T09:00:00.000Z" },
    };

    const answer = await table(10);
    const bySlug = new Map(answer.rows.map(row => [row.slug, row]));

    expect(bySlug.get("home")).toMatchObject({
      updatedAt: "2026-10-29T10:00:00.000Z",
      userId: "ana",
      userName: "Ana",
    });
    // 🔴 Dated by its own document, and naming nobody for another one's save.
    expect(bySlug.get("about")).toMatchObject({
      updatedAt: "2026-10-29T09:00:00.000Z",
    });
    expect(bySlug.get("about")).not.toHaveProperty("userName");
  });

  it("asks the trail past the window, for who saved a drawn Single, for that Single alone", async () => {
    collections = [collection("busy", "Busy")];
    singles = [{ slug: "home", label: "Home", tableName: "single_home" }];
    // The window is busy's saves alone and stops short of the trail's end, so
    // Home's latest save lies past it.
    windowAnswer = {
      edits: Array.from({ length: MAX_WIDGET_LIMIT }, (_, i) =>
        save("busy", "2026-10-29T10:00:00.000Z", { entryId: `doc-busy-${i}` })
      ),
      hasMore: true,
    };
    newest = {
      busy: { id: "doc-busy-0", updatedAt: "2026-10-29T10:00:00.000Z" },
    };
    stored = {
      single_home: { id: "doc-home", updated_at: "2026-10-29T11:00:00.000Z" },
    };
    // A collection's saves under Home's slug would answer a read narrowed by
    // the slug alone: they name someone else.
    narrowed = {
      home: [save("home", "2026-10-29T10:30:00.000Z", { userName: "Cara" })],
    };
    narrowedSingles = {
      home: [
        save("home", "2026-10-29T11:00:00.000Z", {
          subjectKind: "single",
          entryId: "doc-home",
          userName: "Ben",
        }),
      ],
    };

    const answer = await table(10);
    const home = answer.rows.find(row => row.kind === "single");

    // 🔴 Named though the window holds no save of it, by the Single's own
    // save, read for the Single and not for a collection of its slug.
    expect(home).toMatchObject({
      updatedAt: "2026-10-29T11:00:00.000Z",
      userName: "Ben",
    });
    expect(getRecentEdits).toHaveBeenCalledWith(
      expect.objectContaining({ single: "home", limit: 1 })
    );
    expect(
      getRecentEdits.mock.calls.filter(([options]) => options.single)
    ).toHaveLength(1);
  });

  it("asks the trail nothing more for a Single when its window reached the trail's end", async () => {
    singles = [{ slug: "home", label: "Home", tableName: "single_home" }];
    stored = {
      single_home: { id: "doc-home", updated_at: "2026-10-29T11:00:00.000Z" },
    };
    narrowedSingles = {
      home: [
        save("home", "2026-10-29T11:00:00.000Z", {
          subjectKind: "single",
          entryId: "doc-home",
        }),
      ],
    };

    const answer = await table(10);

    // The control: a window holding the whole trail and no save of Home means
    // there is none to find, so nobody is named and nothing more is read.
    expect(getRecentEdits).toHaveBeenCalledTimes(1);
    expect(answer.rows[0]).not.toHaveProperty("userName");
  });

  it("leaves Updated out only where there is nothing to date", async () => {
    collections = [collection("empty", "Empty")];
    singles = [{ slug: "about", label: "About", tableName: "single_about" }];
    entries = { empty: { all: 0, draft: 0 } };

    const answer = await table(10);

    for (const row of answer.rows) expect(row).not.toHaveProperty("updatedAt");
  });

  it("names who saved a collection only when the trail's save is of its newest entry", async () => {
    collections = [collection("posts", "Posts"), collection("tags", "Tags")];
    windowAnswer = {
      edits: [
        save("posts", "2026-10-29T10:00:00.000Z"),
        // A save of another tag than the newest one.
        save("tags", "2026-10-28T10:00:00.000Z", { entryId: "doc-older-tag" }),
      ],
      hasMore: false,
    };
    newest = {
      posts: { id: "doc-posts", updatedAt: "2026-10-29T10:00:00.000Z" },
      tags: { id: "doc-tags", updatedAt: "2026-10-29T11:00:00.000Z" },
    };

    const answer = await table(10);
    const bySlug = new Map(answer.rows.map(row => [row.slug, row]));

    expect(bySlug.get("posts")).toMatchObject({
      userId: "ana",
      userName: "Ana",
      actorType: "user",
    });
    expect(bySlug.get("tags")).toMatchObject({
      updatedAt: "2026-10-29T11:00:00.000Z",
    });
    expect(bySlug.get("tags")).not.toHaveProperty("userName");
  });

  it("orders the page by each row's own last update, newest first, a Single among them, and the empty collections last", async () => {
    collections = [
      collection("posts", "Posts"),
      collection("tags", "Tags"),
      collection("authors", "Authors"),
      collection("pages", "Pages"),
    ];
    singles = [{ slug: "home", label: "Home", tableName: "single_home" }];
    entries = { authors: { all: 0, draft: 0 } };
    newest = {
      posts: { id: "doc-posts", updatedAt: "2026-10-29T10:00:00.000Z" },
      tags: { id: "doc-tags", updatedAt: "2026-10-27T10:00:00.000Z" },
      pages: { id: "doc-pages", updatedAt: "2026-10-28T10:00:00.000Z" },
    };
    stored = {
      single_home: { id: "doc-home", updated_at: "2026-10-29T11:00:00.000Z" },
    };

    const answer = await table(10);

    expect(answer.rows.map(row => `${row.kind}:${row.slug}`)).toEqual([
      "single:home",
      "collection:posts",
      "collection:pages",
      "collection:tags",
      // Holding nothing the reader may read: last.
      "collection:authors",
    ]);
    // A Single carries no count and no create decision.
    expect(answer.rows[0]).not.toHaveProperty("count");
    expect(answer.rows[0]).not.toHaveProperty("canCreate");
    // 🔴 Every row the table could show, the Single's included: the list
    // answer's total is the rows it matched, as every list answer's is.
    expect(answer.total).toBe(5);
  });

  it("counts drafts by the collection list's Draft filter, and none for a collection without the lifecycle", async () => {
    collections = [
      collection("posts", "Posts", true),
      collection("tags", "Tags"),
    ];
    entries = { posts: { all: 9, draft: 3 }, tags: { all: 2, draft: 0 } };

    const answer = await table(10);
    const bySlug = new Map(answer.rows.map(row => [row.slug, row]));

    expect(bySlug.get("posts")).toMatchObject({ count: 9, draft: 3 });
    expect(bySlug.get("tags")).toMatchObject({ count: 2, draft: null });
    // The list's own read, as the reader: every entry narrowed by `where`,
    // never the workflow's `status: "draft"`.
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
    // A collection without the lifecycle is not asked for drafts at all.
    expect(
      count.mock.calls.filter(
        ([asked]) => (asked as { collection: string }).collection === "tags"
      )
    ).toHaveLength(1);
  });

  it("offers create where the reader's create decision allows it and the definition does not turn it off", async () => {
    collections = [
      collection("posts", "Posts"),
      collection("tags", "Tags"),
      collection("forms", "Forms"),
    ];
    verdict.mockImplementation(slug => Promise.resolve(slug !== "tags"));
    createDisabledSlugs.mockResolvedValue(new Set(["forms"]));

    const answer = await table(10);
    const canCreate = Object.fromEntries(
      answer.rows.map(row => [row.slug, row.canCreate])
    );

    expect(canCreate).toEqual({ posts: true, tags: false, forms: false });
  });

  it("offers create nowhere while which collections turn it off is unknown", async () => {
    collections = [collection("posts", "Posts")];
    createDisabledSlugs.mockRejectedValue(new Error("registry not read"));

    const answer = await table(10);

    expect(answer.rows[0]?.canCreate).toBe(false);
    expect(verdict).not.toHaveBeenCalled();
  });

  it("lists only what the reader's scope admits", async () => {
    collections = [
      collection("posts", "Posts"),
      collection("secret", "Secret"),
    ];

    const answer = await table(10, ["posts"]);

    expect(answer.rows.map(row => row.slug)).toEqual(["posts"]);
    expect(collectionsOf(count)).toEqual(new Set(["posts"]));
    expect(answer.total).toBe(1);
  });
});
