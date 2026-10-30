/**
 * `system:continue`: Continue where you left off's source lists the reader's
 * pins in the order pinned and then their own latest saves (Mine), or other
 * people's (Team), each document once, every title read as the reader now and
 * never taken from the trail, and a row the reader may not read now left out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRecentEdits = vi.fn();
const pendingChangeLocales = vi.fn();
const resolveReadableResources = vi.fn();
const readActivitySubjects = vi.fn();
const listPins = vi.fn();
const readableHeadings = vi.fn();
/** The booted config the source reads its retention window from. */
let serviceConfig: Record<string, unknown> = {};

vi.mock("../../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) => {
      if (name === "config") return serviceConfig;
      if (name === "versionsService") return { pendingChangeLocales };
      return { getRecentEdits };
    },
  },
}));
vi.mock("../resolve-readable-resources", () => ({
  resolveReadableResources: (...args: unknown[]) =>
    resolveReadableResources(...args) as unknown,
}));
vi.mock("../activity-subjects", () => ({
  readActivitySubjects: () => readActivitySubjects() as unknown,
}));
vi.mock("../dashboard-pins-service", () => ({
  dashboardPinsService: () => ({ list: listPins }),
}));
// The real `headingKey`, so the source and this test key a document alike;
// the read itself is the test's.
vi.mock("../readable-headings", async importOriginal => ({
  ...(await importOriginal<typeof import("../readable-headings")>()),
  bootedHeadingRegistries: () => ({}),
  readableHeadings: (...args: unknown[]) =>
    readableHeadings(...args) as unknown,
}));

import {
  resolveAuditRetentionConfig,
  setAuditRetention,
} from "../../../domains/audit/retention-config";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import { validateWidgetQuery } from "../../../domains/widgets/query";
import { clearSources } from "../../../domains/widgets/sources";
import {
  clearSystemResolvers,
  systemResolver,
} from "../../../domains/widgets/system-sources";
import {
  CONTINUE_SOURCE_ID,
  registerContinueWidgetSource,
} from "../continue-widget-source";
import { type DocumentRef, headingKey } from "../readable-headings";
import { someResources } from "../readable-resources";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const SCOPE = someResources(["posts", "pages"]);
const SINGLES = { labels: new Map(), keptOff: new Set(), complete: true };
const KEPT_OFF = { slugs: new Set<string>(), complete: true };

/** One document's latest save, as the walk answers it, with the trail's stored title. */
function edit(collection: string, entryId: string, userId = "user-2") {
  return {
    id: `save-${entryId}`,
    actorType: "user",
    userId,
    userName: userId === "user-1" ? "Me" : "Ana",
    userEmail: null,
    action: "update",
    collection,
    entryId,
    entryTitle: `Stored ${entryId}`,
    subjectKind: "collection",
    metadata: { changedFields: ["title"] },
    createdAt: "2026-10-23T12:00:00.000Z",
    count: 1,
    countAtLeast: false,
    firstCreatedAt: "2026-10-23T12:00:00.000Z",
    identityErasedAt: null,
    locale: null,
  };
}

/** A pin as the pins service shows it: readable, titled as the reader reads it. */
function pin(entryId: string, pinnedAt: string) {
  return {
    targetType: "collection" as const,
    targetSlug: "posts",
    entryId,
    title: `Pinned ${entryId}`,
    status: "draft",
    updatedAt: "2026-10-20T09:00:00.000Z",
    pinnedAt,
  };
}

/** Every document the test's reader may read now, titled as the read path titles it. */
let readable = new Set(["posts/p1", "posts/p2", "pages/g1"]);

const rows = (answer: unknown) =>
  (answer as { items: Record<string, unknown>[] }).items;

const ask = (where?: Record<string, unknown>, who: unknown = caller) =>
  executeWidgetQuery(
    {
      source: CONTINUE_SOURCE_ID,
      op: "list",
      limit: 5,
      ...(where ? { where } : {}),
    },
    who as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  serviceConfig = {};
  setAuditRetention(undefined);
  readable = new Set(["posts/p1", "posts/p2", "pages/g1"]);
  resolveReadableResources.mockResolvedValue(SCOPE);
  readActivitySubjects.mockResolvedValue({
    singles: SINGLES,
    keptOffCollections: KEPT_OFF,
  });
  listPins.mockResolvedValue([]);
  getRecentEdits.mockResolvedValue({ edits: [], hasMore: false });
  readableHeadings.mockImplementation(async (refs: DocumentRef[]) => {
    const headings = new Map<string, unknown>();
    for (const ref of refs) {
      if (readable.has(`${ref.slug}/${ref.entryId}`)) {
        headings.set(headingKey(ref), {
          // Each language its own title, as the read path answers it.
          title: ref.locale
            ? `Read ${ref.entryId} in ${ref.locale}`
            : `Read ${ref.entryId}`,
          icon: "Bookmark",
          status: "published",
        });
      }
    }
    return headings;
  });
  pendingChangeLocales.mockResolvedValue(new Map());
  clearSources();
  clearSystemResolvers();
  registerContinueWidgetSource();
});

describe("Mine", () => {
  it("lists the pins first in the order pinned, then the reader's own saves, each document once", async () => {
    // Newest first, as the pins service lists them.
    listPins.mockResolvedValue([
      pin("p2", "2026-10-22T00:00:00.000Z"),
      pin("p1", "2026-10-21T00:00:00.000Z"),
    ]);
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p1", "user-1"), edit("pages", "g1", "user-1")],
      hasMore: false,
    });
    const answer = rows(await ask());
    expect(answer.map(row => [row.entryId, row.pinned])).toEqual([
      ["p1", true],
      ["p2", true],
      // p1's save is already listed as its pin.
      ["g1", false],
    ]);
    // The reader's own saves, enough of them that the pins cannot leave Mine short.
    expect(getRecentEdits).toHaveBeenCalledWith(
      expect.objectContaining({
        savedBy: "user-1",
        limit: 7,
        scope: SCOPE,
        caller,
      })
    );
    expect(getRecentEdits.mock.calls[0]![0]).not.toHaveProperty("notSavedBy");
  });

  it("is Mine when the query names no tab", async () => {
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p1", "user-1")],
      hasMore: false,
    });
    await ask();
    expect(getRecentEdits).toHaveBeenCalledWith(
      expect.objectContaining({ savedBy: "user-1" })
    );
  });

  it("dates a pin by its document's last update and draws its heading as read", async () => {
    listPins.mockResolvedValue([pin("p1", "2026-10-21T00:00:00.000Z")]);
    const [first] = rows(await ask({ tab: "mine" }));
    expect(first).toMatchObject({
      entryTitle: "Pinned p1",
      editedAt: "2026-10-20T09:00:00.000Z",
      status: "draft",
      userId: null,
      pinned: true,
    });
  });

  it("has nothing for a caller who is not a person: no pins read, no saves asked", async () => {
    const key = {
      user: { id: "key-owner" },
      authenticatedScope: { actorType: "apiKey", permissions: [] },
    };
    expect(rows(await ask({ tab: "mine" }, key))).toEqual([]);
    expect(listPins).not.toHaveBeenCalled();
    expect(getRecentEdits).not.toHaveBeenCalled();
  });
});

describe("Team", () => {
  it("asks for every save but the reader's, and marks the documents the reader pinned", async () => {
    listPins.mockResolvedValue([pin("p2", "2026-10-21T00:00:00.000Z")]);
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p2"), edit("pages", "g1")],
      hasMore: false,
    });
    const answer = rows(await ask({ tab: "team" }));
    expect(answer.map(row => [row.entryId, row.userName, row.pinned])).toEqual([
      ["p2", "Ana", true],
      ["g1", "Ana", false],
    ]);
    const [options] = getRecentEdits.mock.calls[0] as [Record<string, unknown>];
    expect(options).toMatchObject({ notSavedBy: "user-1", limit: 5 });
    expect(options).not.toHaveProperty("savedBy");
  });
});

describe("the titles it shows", () => {
  it("titles each row as the reader reads it now, never from the trail's stored title", async () => {
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p1")],
      hasMore: false,
    });
    const answer = await ask({ tab: "team" });
    expect(rows(answer)[0]).toMatchObject({
      entryTitle: "Read p1",
      icon: "Bookmark",
      status: "published",
    });
    expect(JSON.stringify(answer)).not.toContain("Stored p1");
    // Read as the caller, for the documents the saves name.
    expect(readableHeadings).toHaveBeenCalledWith(
      [{ kind: "collection", slug: "posts", entryId: "p1", locale: null }],
      caller,
      expect.anything()
    );
  });

  it("leaves out a save whose document the reader may not read now, title and all", async () => {
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p1"), edit("posts", "hidden")],
      hasMore: false,
    });
    const answer = await ask({ tab: "team" });
    expect(rows(answer).map(row => row.entryId)).toEqual(["p1"]);
    // 🔴 Neither its row nor anything naming it: not "Untitled", not its stored title.
    expect(JSON.stringify(answer)).not.toContain("hidden");
  });
});

describe("a save in another language", () => {
  it("is titled in the language it was saved in, and is still the document its pin names", async () => {
    listPins.mockResolvedValue([pin("p1", "2026-10-21T00:00:00.000Z")]);
    getRecentEdits.mockResolvedValue({
      edits: [{ ...edit("posts", "p1"), locale: "fr" }],
      hasMore: false,
    });
    const [row] = rows(await ask({ tab: "team" }));
    // 🔴 Read in French, as the row links to French: not the default language's title.
    expect(row).toMatchObject({
      entryTitle: "Read p1 in fr",
      locale: "fr",
      // The pin names the document, whatever language it was saved in.
      pinned: true,
    });
    expect(readableHeadings).toHaveBeenCalledWith(
      [{ kind: "collection", slug: "posts", entryId: "p1", locale: "fr" }],
      caller,
      expect.anything()
    );
  });

  it("is not listed again on Mine after its pin, whatever language it was saved in", async () => {
    listPins.mockResolvedValue([pin("p1", "2026-10-21T00:00:00.000Z")]);
    getRecentEdits.mockResolvedValue({
      edits: [{ ...edit("posts", "p1", "user-1"), locale: "fr" }],
      hasMore: false,
    });
    expect(rows(await ask({ tab: "mine" })).map(row => row.entryId)).toEqual([
      "p1",
    ]);
  });
});

describe("what it refuses", () => {
  // Asked of the source's own resolver, past the query's validation, so each
  // refusal is the source's and not only the layer in front of it.
  const resolve = (where: Record<string, unknown>) =>
    systemResolver(CONTINUE_SOURCE_ID)!(
      { source: CONTINUE_SOURCE_ID, op: "list", limit: 5, where },
      caller as never
    );

  it("refuses a filter it does not declare, rather than answering another question", async () => {
    await expect(resolve({ tab: "mine", onlyMine: true })).rejects.toThrow();
    expect(getRecentEdits).not.toHaveBeenCalled();
  });

  it("refuses a tab that is not one", async () => {
    await expect(resolve({ tab: "everyone" })).rejects.toThrow();
    expect(getRecentEdits).not.toHaveBeenCalled();
  });

  it("is refused by the query's own validation too, before the source is asked", async () => {
    // Named by the validation's own words, asked of the validator itself: the
    // query route answers every invalid query with one generic refusal, so a
    // caller learns nothing from which rule refused it.
    expect(() =>
      validateWidgetQuery({
        source: CONTINUE_SOURCE_ID,
        op: "list",
        limit: 5,
        where: { tab: "everyone" },
      })
    ).toThrow('where filter "tab"');
    await expect(ask({ tab: "everyone" })).rejects.toThrow();
    expect(getRecentEdits).not.toHaveBeenCalled();
  });
});

describe("each row's pending changes", () => {
  it("says whether changes are not published, and nothing when the read failed", async () => {
    getRecentEdits.mockResolvedValue({
      edits: [edit("posts", "p1"), edit("pages", "g1")],
      hasMore: false,
    });
    pendingChangeLocales.mockImplementation(
      async (_kind: string, slug: string) => {
        if (slug === "pages") throw new Error("read failed");
        return new Map([["p1", new Set([null])]]);
      }
    );
    const answer = rows(await ask({ tab: "team" }));
    // 🔴 `false` would say nothing is unpublished when the question was never answered.
    expect(answer.map(row => [row.entryId, row.pendingChanges])).toEqual([
      ["p1", true],
      ["g1", null],
    ]);
  });
});

describe("the span the answer covers", () => {
  it("states the trail's retention, in days, and none when nothing prunes it", async () => {
    serviceConfig = { auditRetention: resolveAuditRetentionConfig(undefined) };
    expect(await ask({ tab: "team" })).toMatchObject({ window: { days: 90 } });
    serviceConfig = {
      auditRetention: resolveAuditRetentionConfig({ activityMaxAgeMs: false }),
    };
    expect(await ask({ tab: "team" })).not.toHaveProperty("window");
  });
});
