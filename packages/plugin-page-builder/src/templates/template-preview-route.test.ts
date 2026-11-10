/**
 * What the template preview routes decide: which collections they read at
 * all, what the list asks and answers (order, search, status, the create
 * right), and what the entry read answers, over injected reads.
 *
 * The reads model the caller's access the way core's gate answers it: a
 * collection the caller may not read is refused, and an entry they may not
 * read is never returned. So a route that listed or answered something the
 * caller's read did not return, or that judged access itself, fails here.
 * That the routes bind those reads AS THE CALLER is the last block, which
 * reads the arguments handed to the Direct API.
 *
 * @module templates/template-preview-route.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AsCallerFindArgs, AsCallerPage } from "../entry-reads";

/** The Direct API handle the routes reach, with its reads recorded. */
const nextly = vi.hoisted(() => ({ find: vi.fn(), findByID: vi.fn() }));

// The handle is replaced and nothing else is, so the editor and public
// readers the entry route builds run as they do in production.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
  bindingFieldShapes: async () => [{ name: "title", type: "text" }],
}));

import type { TemplateGuardSetup } from "./template-guard";
import {
  TEMPLATE_PREVIEW_ENTRIES_PATH,
  TEMPLATE_PREVIEW_LIMIT,
} from "./template-preview-contract";
import {
  previewStatusOf,
  readPreviewEntries,
  readPreviewEntry,
  templatePreviewEntriesRoute,
  type PreviewEntriesReads,
  type PreviewEntryReads,
} from "./template-preview-route";

/** A collection that may have a template, with Draft/Published and a title. */
const POSTS = {
  slug: "posts",
  label: "Post",
  labels: { singular: "Post", plural: "Posts" },
  status: true,
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
  ],
};

/** A collection that exists and may have a template, but the caller may not read. */
const SECRETS = { ...POSTS, slug: "secrets", label: "Secret" };

/** One stored entry, and who may read it. */
interface Row {
  readonly id: string;
  readonly title: string;
  readonly status: "draft" | "published";
  readonly updatedAt: string;
  /** Whether a working draft waits on it. */
  readonly pending?: boolean;
  /** Whether the caller's access lets them read it. */
  readonly readable?: boolean;
}

const ROWS: readonly Row[] = [
  {
    id: "a",
    title: "Building a content model that lasts",
    status: "published",
    updatedAt: "2026-11-06T10:00:00.000Z",
  },
  {
    id: "b",
    title: "Release notes: September",
    status: "draft",
    updatedAt: "2026-11-07T08:00:00.000Z",
  },
  {
    id: "c",
    title: "Field notes: a week with the editor",
    status: "published",
    updatedAt: "2026-11-04T09:00:00.000Z",
    pending: true,
  },
  {
    id: "hidden",
    title: "Someone else's draft",
    status: "draft",
    // The most recent of all: a route that listed it would put it first.
    updatedAt: "2026-11-07T09:00:00.000Z",
    readable: false,
  },
  {
    id: "d",
    title: "Rebuilding our docs search",
    status: "published",
    updatedAt: "2026-11-04T09:00:00.000Z",
  },
];

/** The guard's collection reads: posts and secrets exist, pages is the plugin's own. */
const collections: Pick<
  TemplateGuardSetup,
  "readCollection" | "ownCollections"
> = {
  ownCollections: () => new Set(["pages", "templates"]),
  readCollection: async slug =>
    slug === "posts"
      ? POSTS
      : slug === "secrets"
        ? SECRETS
        : slug === "pages"
          ? { ...POSTS, slug: "pages" }
          : null,
};

/** A where clause's value at `key`, as the fake reads it. */
function at(where: unknown, key: string): unknown {
  return typeof where === "object" && where !== null
    ? (where as Record<string, unknown>)[key]
    : undefined;
}

/**
 * The caller's read, as core's gate answers it: `secrets` refused, unreadable
 * rows left out, then the filter, the order and the selection applied.
 */
function callerFind(rows: readonly Row[] = ROWS) {
  return vi.fn(async (args: AsCallerFindArgs): Promise<AsCallerPage> => {
    if (args.collection === "secrets") {
      throw NextlyError.forbidden({ logContext: { reason: "test" } });
    }
    let kept = rows.filter(row => row.readable !== false);
    const ids = at(at(args.where, "id"), "in");
    if (Array.isArray(ids)) kept = kept.filter(row => ids.includes(row.id));
    if (at(args.where, "_pendingChange") === true) {
      kept = kept.filter(row => row.pending === true);
    }
    const contains = at(at(args.where, "title"), "contains");
    if (typeof contains === "string") {
      kept = kept.filter(row =>
        row.title.toLowerCase().includes(contains.toLowerCase())
      );
    }
    const sort = args.sort ?? [];
    if (sort[0] === "-updatedAt") {
      kept = [...kept].sort(
        (x, y) =>
          y.updatedAt.localeCompare(x.updatedAt) || x.id.localeCompare(y.id)
      );
    }
    const items = kept
      .slice(0, args.limit)
      .map(row =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => args.select[key] === true)
        )
      );
    return {
      items,
      meta: {
        total: kept.length,
        page: 1,
        limit: args.limit,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  });
}

function listReads(
  overrides: Partial<PreviewEntriesReads> = {}
): PreviewEntriesReads {
  return {
    collections,
    find: callerFind(),
    mayCreate: async () => true,
    ...overrides,
  };
}

/** The refusal a read throws, or a failure naming what happened instead. */
async function refusalOf(run: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("the read was not refused");
}

describe("the list of entries a template may preview", () => {
  it("lists the caller's readable entries, drafts included, most recently updated first", async () => {
    const answer = await readPreviewEntries(
      { collection: "posts" },
      listReads()
    );
    // Ties on updatedAt (c and d) by id. The draft is listed, and the entry
    // the caller may not read is not, though it is the most recent.
    expect(answer.items.map(item => item.id)).toEqual(["b", "a", "c", "d"]);
    expect(answer.items.map(item => item.id)).not.toContain("hidden");
  });

  it("asks for the most recent twenty, newest first, the columns it shows and no others", async () => {
    const find = callerFind();
    await readPreviewEntries({ collection: "posts" }, listReads({ find }));
    const [first] = find.mock.calls[0] ?? [];
    expect(first).toMatchObject({
      collection: "posts",
      sort: ["-updatedAt", "id"],
      limit: TEMPLATE_PREVIEW_LIMIT,
      select: { id: true, title: true, status: true, updatedAt: true },
    });
    expect(Object.keys(first?.select ?? {}).sort()).toEqual([
      "id",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  it("marks a draft, a published entry, and one waiting on a working draft as the admin names them", async () => {
    const answer = await readPreviewEntries(
      { collection: "posts" },
      listReads()
    );
    const status = Object.fromEntries(
      answer.items.map(item => [item.id, item.status])
    );
    expect(status).toEqual({
      b: "draft",
      a: "published",
      c: "changed",
      d: "published",
    });
    expect(answer.items[0]).toEqual({
      id: "b",
      title: "Release notes: September",
      status: "draft",
      updatedAt: "2026-11-07T08:00:00.000Z",
    });
  });

  it("asks which entries wait on a working draft over the listed ids, as the caller", async () => {
    const find = callerFind();
    await readPreviewEntries({ collection: "posts" }, listReads({ find }));
    const pendingAsk = find.mock.calls
      .map(([args]) => args)
      .find(args => at(args.where, "_pendingChange") === true);
    expect(pendingAsk?.where).toEqual({
      id: { in: ["b", "a", "c", "d"] },
      _pendingChange: true,
    });
    expect(pendingAsk?.select).toEqual({ id: true });
  });

  it("searches the title field, case-insensitively, on the server", async () => {
    const find = callerFind();
    const answer = await readPreviewEntries(
      { collection: "posts", search: "NOTES" },
      listReads({ find })
    );
    expect(find.mock.calls[0]?.[0].where).toEqual({
      title: { contains: "NOTES" },
    });
    expect(answer.items.map(item => item.id)).toEqual(["b", "c"]);
  });

  it("says the caller may create where the framework says so, and not where it does not", async () => {
    const asked: string[] = [];
    const allowed = await readPreviewEntries(
      { collection: "posts" },
      listReads({
        mayCreate: async collection => {
          asked.push(collection);
          return true;
        },
      })
    );
    const refused = await readPreviewEntries(
      { collection: "posts" },
      listReads({ mayCreate: async () => false })
    );
    expect(allowed.meta.mayCreate).toBe(true);
    expect(refused.meta.mayCreate).toBe(false);
    // Asked of the template's own collection.
    expect(asked).toEqual(["posts"]);
  });

  it("names the collection by its labels, for the empty state and New", async () => {
    const answer = await readPreviewEntries(
      { collection: "posts" },
      listReads({ find: callerFind([]) })
    );
    expect(answer.items).toEqual([]);
    expect(answer.meta.labels).toEqual({ singular: "Post", plural: "Posts" });
  });

  it("names the collection's top-level blocks fields, for Entry content's Field menu", async () => {
    // Body and a blocks field inside an unnamed group (presentation only,
    // stored on the entry itself) count; one inside a named group is stored
    // under the group and does not, nor does any other kind of field.
    const withBlocks = {
      ...POSTS,
      fields: [
        ...POSTS.fields,
        { name: "body", type: "blocks", label: "Body" },
        {
          type: "group",
          fields: [{ name: "sidebar", type: "blocks" }],
        },
        {
          name: "hero",
          type: "group",
          fields: [{ name: "intro", type: "blocks" }],
        },
      ],
    };
    const answer = await readPreviewEntries(
      { collection: "posts" },
      listReads({
        find: callerFind([]),
        collections: {
          ...collections,
          readCollection: async slug =>
            slug === "posts" ? withBlocks : collections.readCollection(slug),
        },
      })
    );
    expect(answer.meta.blocksFields).toEqual([
      { name: "body", label: "Body" },
      { name: "sidebar", label: "Sidebar" },
    ]);
  });

  it("names no blocks field for a collection with none (the control)", async () => {
    const answer = await readPreviewEntries(
      { collection: "posts" },
      listReads({ find: callerFind([]) })
    );
    expect(answer.meta.blocksFields).toEqual([]);
  });

  it("refuses an unknown collection with the same words as one the caller may not read", async () => {
    const unknown = await refusalOf(() =>
      readPreviewEntries({ collection: "nope" }, listReads())
    );
    const unreadable = await refusalOf(() =>
      readPreviewEntries({ collection: "secrets" }, listReads())
    );
    // The control: a readable collection is not refused at all.
    await expect(
      readPreviewEntries({ collection: "posts" }, listReads())
    ).resolves.toBeDefined();
    expect(unknown.code).toBe("FORBIDDEN");
    expect(unreadable.code).toBe(unknown.code);
    expect(unreadable.publicMessage).toBe(unknown.publicMessage);
    expect(unreadable.statusCode).toBe(unknown.statusCode);
  });

  it("refuses the plugin's own collections before reading a row", async () => {
    const find = callerFind();
    const refused = await refusalOf(() =>
      readPreviewEntries({ collection: "pages" }, listReads({ find }))
    );
    expect(refused.code).toBe("FORBIDDEN");
    expect(find).not.toHaveBeenCalled();
  });
});

/** The editor's and the public's reads of one entry, modelled as core answers them. */
function entryReads(
  overrides: Partial<PreviewEntryReads> = {}
): PreviewEntryReads {
  return {
    collections,
    editorEntry: async request =>
      request.id === "c"
        ? {
            id: "c",
            title: "Field notes, the draft's title",
            status: "published",
            _isWorkingDraft: true,
          }
        : request.id === "b"
          ? { id: "b", title: "Release notes: September", status: "draft" }
          : null,
    publicEntry: async request =>
      request.id === "c"
        ? {
            id: "c",
            title: "Field notes: a week with the editor",
            status: "published",
          }
        : null,
    publicFields: async () => [{ name: "title", type: "text" }],
    ...overrides,
  };
}

describe("the entry a template previews", () => {
  it("answers the caller's values with the working draft's, and the public's published ones", async () => {
    const answer = await readPreviewEntry(
      { collection: "posts", id: "c" },
      entryReads()
    );
    expect(answer.editorValues.title).toBe("Field notes, the draft's title");
    expect(answer.publicValues?.title).toBe(
      "Field notes: a week with the editor"
    );
    expect(answer.status).toBe("changed");
    expect(answer.title).toBe("Field notes, the draft's title");
  });

  it("answers no public values for an entry only drafted, and the draft's own to the caller", async () => {
    const answer = await readPreviewEntry(
      { collection: "posts", id: "b" },
      entryReads()
    );
    expect(answer.publicValues).toBeNull();
    expect(answer.editorValues.title).toBe("Release notes: September");
    expect(answer.status).toBe("draft");
  });

  it("answers the public's field shapes, and none where the public may read nothing", async () => {
    const shown = await readPreviewEntry(
      { collection: "posts", id: "c" },
      entryReads()
    );
    const none = await readPreviewEntry(
      { collection: "posts", id: "c" },
      entryReads({ publicFields: async () => undefined })
    );
    expect(shown.fields).toEqual([{ name: "title", type: "text" }]);
    expect(none.fields).toEqual([]);
  });

  it("refuses an entry the caller may not read as it refuses a missing one", async () => {
    const missing = await refusalOf(() =>
      readPreviewEntry({ collection: "posts", id: "gone" }, entryReads())
    );
    const unreadable = await refusalOf(() =>
      readPreviewEntry(
        { collection: "posts", id: "hidden" },
        entryReads({
          editorEntry: async () => {
            throw NextlyError.forbidden({ logContext: { reason: "test" } });
          },
        })
      )
    );
    expect(unreadable.code).toBe(missing.code);
    expect(unreadable.publicMessage).toBe(missing.publicMessage);
  });
});

describe("where an entry stands", () => {
  it("names the admin's three states, and a collection without drafts as published", () => {
    expect(previewStatusOf("draft", false)).toBe("draft");
    expect(previewStatusOf("published", false)).toBe("published");
    expect(previewStatusOf("published", true)).toBe("changed");
    // A draft with a working draft is still a draft: it was never live.
    expect(previewStatusOf("draft", true)).toBe("draft");
    expect(previewStatusOf(undefined, false)).toBe("published");
  });
});

describe("the list route reads AS THE CALLER", () => {
  beforeEach(() => {
    nextly.find.mockReset();
    nextly.find.mockResolvedValue({
      items: [],
      meta: {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  });

  it("says overrideAccess: false, every status, with the identity the caller resolved", async () => {
    const identity = { user: { id: "u1", roles: ["editor"] } };
    const can = vi.fn(async () => false);
    const ctx = {
      self: { collections: {} },
      caller: {
        authMethod: "session",
        can,
        identity: async () => identity,
      },
    } as unknown as PluginRouteContext;
    const response = await templatePreviewEntriesRoute({
      guard: () => ({
        templatesCollection: "templates",
        holderOf: async () => null,
        // An own design's lookups and the address reads, which the
        // preview's list never makes.
        entryExists: async () => true,
        holdEntry: async () => true,
        declaredAddresses: new Map(),
        addressHolderOf: async () => null,
        ...collections,
      }),
    }).handler(
      new Request(
        `http://nextly.test/plugins/x${TEMPLATE_PREVIEW_ENTRIES_PATH}`,
        { method: "POST", body: JSON.stringify({ collection: "posts" }) }
      ),
      ctx
    );
    expect(nextly.find).toHaveBeenCalled();
    for (const [args] of nextly.find.mock.calls) {
      expect(args).toMatchObject({
        collection: "posts",
        overrideAccess: false,
        user: identity.user,
        status: "all",
      });
    }
    // The create right is the framework's own answer for this collection.
    expect(can).toHaveBeenCalledWith("create", "posts");
    const body = (await response.json()) as { meta: { mayCreate: boolean } };
    expect(body.meta.mayCreate).toBe(false);
  });
});
