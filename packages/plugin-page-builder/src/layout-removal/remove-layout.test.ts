/**
 * Remove Layout's steps, its move of the pages to the site default, and the
 * sweep that finishes a removal left part-way, against an in-memory site and
 * fence.
 *
 * The fence here keeps the stored one's rules (one row per Layout, every step
 * change a compare-and-set on token and step), so the route's decisions can be
 * watched one at a time: when the default is read, what stops a removal, what
 * the write carries, and what a race leaves behind. What the table holds on
 * each dialect, and the guard and the route together over REST, are the
 * integration suite's (`__tests__/layout-removal.integration.test.ts`).
 *
 * @module layout-removal/remove-layout.test
 */
import {
  NextlyError,
  type FieldRewriteCopy,
  type FieldRewriteRequest,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { DefaultLayoutDirectApi } from "../default-layout/store";

import { readableTitles, scanLayoutReferences } from "./layout-references";
import { LAYOUT_REMOVAL_CONTEXT_KEY } from "./layout-removal-guard";
import {
  movePages,
  PAGES_PER_TICK,
  type MoveDeps,
  type MoveProgress,
  type MoveRequest,
} from "./move-pages";
import { removeLayout } from "./remove-layout";
import { settleLayoutRemovals } from "./settle";
import {
  mayTakeOver,
  REMOVAL_LEASE_MS,
  type LayoutRemoval,
  type LayoutRemovalStore,
} from "./store";
import {
  ALREADY_BEING_REMOVED,
  CANT_EDIT_PAGE,
  CHANGED_WHILE_REMOVING,
  KEPT_AS_DEFAULT,
  NOT_PUBLISHED,
  NO_USABLE_DEFAULT,
  PAGE_KEPT_CHANGING,
} from "./words";

type Row = Record<string, unknown> & { id: string };

/** The fence, in memory, with the stored one's compare-and-set rules. */
function memoryStore(): LayoutRemovalStore & {
  rows: Map<string, LayoutRemoval>;
  renewals: { layoutId: string; token: string; step: string }[];
} {
  const rows = new Map<string, LayoutRemoval>();
  const renewals: { layoutId: string; token: string; step: string }[] = [];
  const put = (removal: LayoutRemoval, patch: Partial<LayoutRemoval>) => {
    rows.set(removal.layoutId, { ...removal, ...patch, updatedAt: new Date() });
  };
  const held = (layoutId: string, token: string, step: string) => {
    const removal = rows.get(layoutId);
    return removal !== undefined &&
      removal.token === token &&
      removal.step === step
      ? removal
      : undefined;
  };
  return {
    rows,
    renewals,
    removalOf: async id => rows.get(id) ?? null,
    mark: async input => {
      const { layoutId, action, token, startedBy, now } = input;
      const existing = rows.get(layoutId);
      if (existing !== undefined && !mayTakeOver(existing, input)) {
        return { kind: "busy", removal: existing };
      }
      rows.set(layoutId, {
        layoutId,
        action,
        step: "marked",
        token,
        startedBy,
        pagesLeft: null,
        copy: null,
        copyVersion: null,
        settledAt: null,
        updatedAt: now,
      });
      return { kind: "marked" };
    },
    advance: async ({ layoutId, token, from, to, set = {} }) => {
      const removal = held(layoutId, token, from);
      if (removal === undefined) return false;
      put(removal, { step: to, ...set });
      return true;
    },
    settle: async (layoutId, token, from = "removed") => {
      const removal = held(layoutId, token, from);
      if (removal === undefined) return false;
      put(removal, { step: "removed", settledAt: new Date(), copy: null });
      return true;
    },
    stop: async (layoutId, token) => {
      if (rows.get(layoutId)?.token !== token) return false;
      rows.delete(layoutId);
      return true;
    },
    stopStale: async observed => {
      const removal = held(observed.layoutId, observed.token, observed.step);
      if (removal?.updatedAt.getTime() !== observed.updatedAt.getTime()) {
        return false;
      }
      rows.delete(observed.layoutId);
      return true;
    },
    renew: async (layoutId, token, step) => {
      const removal = held(layoutId, token, step);
      if (removal === undefined) return false;
      renewals.push({ layoutId, token, step });
      put(removal, {});
      return true;
    },
    releaseTombstone: async layoutId => {
      const removal = rows.get(layoutId);
      if (removal?.step === "removed" && removal.action === "unpublish") {
        rows.delete(layoutId);
      }
    },
    unsettled: async () =>
      [...rows.values()].filter(removal => removal.settledAt === null),
    removalsOf: async ids =>
      [...rows.values()].filter(removal => ids.includes(removal.layoutId)),
    tombstones: async () =>
      [...rows.values()].filter(
        removal =>
          removal.step === "removed" &&
          removal.action === "unpublish" &&
          removal.settledAt !== null
      ),
  };
}

/** One site: its Layouts, their drafts, its pages and its default. */
interface Site {
  layouts: Map<string, Row>;
  layoutDrafts: Map<string, Row>;
  pages: Row[];
  pageDrafts: Map<string, Row>;
  /** Pages the remover may not read. */
  hidden: Set<string>;
  /** Layouts the remover may not read. */
  hiddenLayouts?: Set<string>;
  defaultLayout: string | null;
  /** Called when the default is read, before it answers. */
  onDefaultRead?: () => void;
  /** Called with each delete or update of a Layout, before it lands. */
  onLayoutWrite?: (args: Record<string, unknown>) => void;
  writes: Record<string, unknown>[];
  created: number;
  /** A write that commits and then rejects, as a failure after the commit does. */
  failAfterWrite?: boolean;
  /** Pages the remover may read but not edit. */
  readOnly?: Set<string>;
  /** Every page write, as the Direct API was asked for it. */
  pageWrites?: Record<string, unknown>[];
  /** Pages the remover may edit but not publish: their rewrite is refused. */
  mayNotPublish?: Set<string>;
  /** How many more rewrites of a page meet a save made since their read. */
  savedSinceRead?: Map<string, number>;
  /** Every field rewrite, as it was asked for. */
  rewrites?: FieldRewriteRequest[];
}

function site(): Site {
  return {
    layouts: new Map([
      [
        "landing",
        {
          id: "landing",
          title: "Landing",
          slug: "landing",
          status: "published",
          areas: [{ id: "row-1", area: "header", component: "c-1" }],
          updatedAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    ]),
    layoutDrafts: new Map(),
    pages: [],
    pageDrafts: new Map(),
    hidden: new Set(),
    defaultLayout: "seed",
    writes: [],
    created: 0,
  };
}

/** A page of `items`, as the Direct API pages a list. */
function paged(rows: Row[], args: Record<string, unknown>) {
  const items =
    args.sort === "id"
      ? [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      : rows;
  const limit = Number(args.limit ?? 10);
  const page = Number(args.page ?? 1);
  return {
    items: items.slice((page - 1) * limit, page * limit),
    meta: { hasNext: page * limit < items.length },
  };
}

/** The `where` a call filters by: an id, an id list, an id cursor, or a Layout. */
function filterBy(items: Row[], where: unknown): Row[] {
  const w = (where ?? {}) as Record<
    string,
    { equals?: unknown; in?: unknown; greater_than?: unknown }
  >;
  const after = w.id?.greater_than;
  return items.filter(
    item =>
      (w.id?.equals === undefined || item.id === w.id.equals) &&
      (typeof after !== "string" || String(item.id) > after) &&
      (!Array.isArray(w.id?.in) || w.id.in.includes(item.id)) &&
      (w.layout?.equals === undefined || item.layout === w.layout.equals)
  );
}

/** A page write: into its working draft when it has one, else its row. */
function updatePage(s: Site, id: string, data: Record<string, unknown>) {
  const draft = s.pageDrafts.get(id);
  if (draft !== undefined) {
    s.pageDrafts.set(id, { ...draft, ...data });
    return { item: { id } };
  }
  const index = s.pages.findIndex(page => page.id === id);
  const current = s.pages[index];
  if (current === undefined) throw NextlyError.notFound();
  s.pages[index] = { ...current, ...data };
  return { item: { id } };
}

/** The Direct API over `s`, as much of it as a removal calls. */
function directApi(s: Site): DefaultLayoutDirectApi {
  const api = {
    find: async (args: Record<string, unknown>) => {
      if (args.collection === "layouts") {
        let items = filterBy([...s.layouts.values()], args.where);
        if (args.overrideAccess === false) {
          items = items.filter(row => s.hiddenLayouts?.has(row.id) !== true);
        }
        if (args.status === "published") {
          items = items.filter(row => row.status === "published");
        }
        return paged(items, args);
      }
      let items = filterBy(s.pages, args.where);
      if (args.status === "published") {
        items = items.filter(row => row.status === "published");
      }
      if (args.overrideAccess === false) {
        items = items.filter(row => !s.hidden.has(row.id));
      }
      return paged(items, args);
    },
    findByID: async (args: { collection: string; id: string }) => {
      const drafts =
        args.collection === "layouts" ? s.layoutDrafts : s.pageDrafts;
      const draft = drafts.get(args.id);
      // A page's version, as every read gives it; a Layout's is not asked.
      const rev = args.collection === "layouts" ? {} : { _rev: "7" };
      if (draft !== undefined) {
        return { ...draft, ...rev, _isWorkingDraft: true };
      }
      const row =
        args.collection === "layouts"
          ? s.layouts.get(args.id)
          : s.pages.find(page => page.id === args.id);
      return row === undefined ? null : { ...row, ...rev };
    },
    findSingle: async () => {
      s.onDefaultRead?.();
      return { defaultLayout: s.defaultLayout };
    },
    updateSingle: async (args: { data: { defaultLayout?: string | null } }) => {
      if (args.data.defaultLayout !== undefined) {
        s.defaultLayout = args.data.defaultLayout;
      }
      return {};
    },
    create: async (args: { data: Record<string, unknown> }) => {
      s.created += 1;
      const id = `restored-${String(s.created)}`;
      s.layouts.set(id, {
        ...args.data,
        id,
        updatedAt: new Date().toISOString(),
      });
      return { item: { id } };
    },
    update: async (args: Record<string, unknown>) => {
      const id = String(args.id);
      const data = args.data as Record<string, unknown>;
      if (args.collection === "pages") {
        s.pageWrites?.push(args);
        if (args.overrideAccess === false && s.readOnly?.has(id) === true) {
          throw NextlyError.forbidden();
        }
        return updatePage(s, id, data);
      }
      if (args.context !== undefined) {
        s.onLayoutWrite?.(args);
        s.writes.push(args);
      }
      const live = s.layouts.get(id);
      if (live === undefined) throw NextlyError.notFound();
      if (data.status === undefined) {
        s.layoutDrafts.set(id, { ...live, ...data, id });
      } else {
        s.layouts.set(id, { ...live, ...data });
      }
      if (s.failAfterWrite === true && args.context !== undefined) {
        throw NextlyError.internal();
      }
      return { item: { id } };
    },
    delete: async (args: Record<string, unknown>) => {
      s.onLayoutWrite?.(args);
      s.writes.push(args);
      s.layouts.delete(String(args.id));
      if (s.failAfterWrite === true) throw NextlyError.internal();
      return { deleted: true };
    },
  };
  return api as unknown as DefaultLayoutDirectApi;
}

const PERSON = {
  overrideAccess: false as const,
  user: { id: "author", role: "editor" },
};

/**
 * Core's field rewrite over `s`, as the person: refused for a page they may
 * not edit or not publish, and for one saved since its read while
 * `savedSinceRead` says so; otherwise each copy, the live row and the
 * working draft, takes `set.from`'s answer for its own value, and the copies
 * whose value moved are answered.
 */
function rewriteOver(s: Site): MoveDeps["rewrite"] {
  return async request => {
    s.rewrites?.push(request);
    const { id } = request;
    if (s.readOnly?.has(id) === true || s.mayNotPublish?.has(id) === true) {
      throw NextlyError.forbidden();
    }
    const stale = s.savedSinceRead?.get(id) ?? 0;
    if (stale > 0) {
      s.savedSinceRead?.set(id, stale - 1);
      throw new NextlyError({
        code: "STALE_VERSION",
        publicMessage: "Someone else saved this.",
        logContext: { reason: "test" },
      });
    }
    if (!("from" in request.set)) throw new Error("the move gives set.from");
    const { from } = request.set;
    const copies: FieldRewriteCopy[] = [];
    const index = s.pages.findIndex(page => page.id === id);
    const live = s.pages[index];
    if (live === undefined) throw NextlyError.notFound();
    const liveValue = await from(live[request.field] ?? null, {
      form: "live",
      locale: null,
    });
    if (liveValue !== live[request.field]) {
      s.pages[index] = { ...live, [request.field]: liveValue };
      copies.push({ form: "live", locale: null });
    }
    const draft = s.pageDrafts.get(id);
    if (draft !== undefined) {
      const value = await from(draft[request.field] ?? null, {
        form: "draft",
        locale: null,
      });
      if (value !== draft[request.field]) {
        s.pageDrafts.set(id, { ...draft, [request.field]: value });
        copies.push({ form: "draft", locale: null });
      }
    }
    return { version: "8", copies };
  };
}

function deps(
  s: Site,
  store = memoryStore()
): MoveDeps & {
  store: ReturnType<typeof memoryStore>;
  warned: string[];
  pagesSlug: string;
} {
  const warned: string[] = [];
  let tokens = 0;
  return {
    nextly: directApi(s),
    store,
    slugs: { layouts: "layouts", settings: "settings", pages: "pages" },
    pagesSlug: "pages",
    person: { userId: "author", as: PERSON as never },
    // The author holds the removal's grants unless a test says otherwise.
    mayRemove: async () => true,
    rewrite: rewriteOver(s),
    warn: message => warned.push(message),
    warned,
    now: () => new Date(),
    newToken: () => {
      tokens += 1;
      return `token-${String(tokens)}`;
    },
  };
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error;
  }
}

const remove = (
  d: MoveDeps,
  action: "delete" | "unpublish" = "delete",
  dryRun = false
) => removeLayout(d, { layoutId: "landing", action, dryRun });

describe("Remove Layout, with nothing in the way", () => {
  it("deletes the Layout as the person, carrying the row's token, and settles the row", async () => {
    const s = site();
    const d = deps(s);

    const answer = await remove(d);

    expect(answer.message).toBe("The Layout was deleted.");
    expect(s.layouts.has("landing")).toBe(false);
    const [written] = s.writes;
    expect(written).toMatchObject({ overrideAccess: false, user: PERSON.user });
    const removal = d.store.rows.get("landing");
    expect(written?.context).toEqual({
      [LAYOUT_REMOVAL_CONTEXT_KEY]: removal?.token,
    });
    // Settled: the copy is dropped once the check after the write passed.
    expect(removal).toMatchObject({ step: "removed", copy: null });
    expect(removal?.settledAt).toBeInstanceOf(Date);
  });

  it("unpublishes it and keeps the row as a tombstone", async () => {
    const s = site();
    const d = deps(s);

    await remove(d, "unpublish");

    expect(s.layouts.get("landing")?.status).toBe("draft");
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      action: "unpublish",
    });
  });

  it("sends the unpublish with the version the copy was read at", async () => {
    // A save of the Layout since the copy refuses the unpublish, so the copy
    // never misses what it would have to put back.
    const s = site();
    const landing = s.layouts.get("landing");
    if (landing !== undefined) landing._rev = "5";
    const d = deps(s);

    await remove(d, "unpublish");

    expect(s.writes[0]?.data).toMatchObject({ status: "draft", _rev: "5" });
  });

  it("refuses an unpublish of a Layout that is not published, writing nothing", async () => {
    const s = site();
    const landing = s.layouts.get("landing");
    if (landing !== undefined) landing.status = "draft";
    const d = deps(s);

    const error = await refusal(remove(d, "unpublish"));

    expect((error as Error).message).toBe(NOT_PUBLISHED);
    expect(d.store.rows.size).toBe(0);
  });
});

describe("a Layout the remover may not read", () => {
  it("answers not found, before any read past their access", async () => {
    const s = site();
    s.hiddenLayouts = new Set(["landing"]);
    s.defaultLayout = "landing";
    let defaultRead = false;
    s.onDefaultRead = () => {
      defaultRead = true;
    };
    const d = deps(s);

    const dry = await refusal(remove(d, "delete", true));
    const real = await refusal(remove(d));

    expect(NextlyError.isCode(dry, "NOT_FOUND")).toBe(true);
    expect(NextlyError.isCode(real, "NOT_FOUND")).toBe(true);
    // Nothing about the Layout was looked up for them: not the default.
    expect(defaultRead).toBe(false);
    expect(d.store.rows.size).toBe(0);
  });
});

describe("a dry run", () => {
  it("answers the default and the pages, naming only the readable ones, and writes nothing", async () => {
    const s = site();
    s.defaultLayout = "landing";
    s.pages.push(
      { id: "p1", title: "Home", status: "published", layout: "landing" },
      { id: "p2", title: "Secret", status: "draft", layout: "landing" }
    );
    s.hidden.add("p2");
    const d = deps(s);

    const answer = await remove(d, "delete", true);

    expect(answer.item.check).toEqual({
      isDefault: true,
      pages: [{ id: "p1", title: "Home", state: "published" }],
      unreadable: 1,
      complete: true,
      pagesCollection: "pages",
      liveRows: 1,
      // The Layout is the default itself: there is none to move pages to.
      siteDefault: null,
    });
    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
  });
});

describe("what stops a removal", () => {
  it("refuses the default, reading it only after the fence is up, and takes the fence down", async () => {
    const s = site();
    s.defaultLayout = "landing";
    const d = deps(s);
    // The order D23 depends on: a promotion committing before this read is
    // seen; one committing after it finds the fence.
    const fencedAtRead: boolean[] = [];
    s.onDefaultRead = () => fencedAtRead.push(d.store.rows.has("landing"));

    const error = await refusal(remove(d));

    expect((error as Error).message).toContain("Choose another default first");
    expect(fencedAtRead[0]).toBe(true);
    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
  });

  it.each([
    ["a live page", { status: "published", layout: "landing" }, null],
    ["an unpublished page", { status: "draft", layout: "landing" }, null],
    [
      "a published page's working draft only",
      { status: "published", layout: null },
      { layout: "landing" },
    ],
  ])(
    "refuses while %s names it, changing nothing",
    async (_label, page, draft) => {
      const s = site();
      s.pages.push({ id: "p1", title: "Home", ...page });
      if (draft !== null) s.pageDrafts.set("p1", { id: "p1", ...draft });
      const d = deps(s);

      const error = await refusal(remove(d));

      expect((error as Error).message).toBe(
        '1 page uses this Layout: "Home". Choose another Layout for it first.'
      );
      expect(d.store.rows.size).toBe(0);
      expect(s.layouts.has("landing")).toBe(true);
      expect(s.writes).toHaveLength(0);
    }
  );

  it("refuses when the scan runs out of budget, saying 'at least'", async () => {
    const s = site();
    for (let i = 0; i < 5; i += 1) {
      s.pages.push({
        id: `p${String(i)}`,
        title: `P${String(i)}`,
        status: "published",
        layout: null,
      });
    }
    s.pages.push({
      id: "p9",
      title: "Last",
      status: "published",
      layout: "landing",
    });
    const d = { ...deps(s), budget: 3 };

    const error = await refusal(remove(d));

    expect((error as Error).message).toContain("can't be removed yet");
    expect(s.layouts.has("landing")).toBe(true);
  });

  it("refuses a second removal while the first holds the fence", async () => {
    const s = site();
    const d = deps(s);
    await d.store.mark({
      layoutId: "landing",
      action: "delete",
      token: "other",
      startedBy: null,
      now: new Date(),
    });

    const error = await refusal(remove(d));

    expect((error as Error).message).toBe(ALREADY_BEING_REMOVED);
    // The other request's fence is left as it was.
    expect(d.store.rows.get("landing")?.token).toBe("other");
  });

  it("takes the fence down when the person may not write, and passes the refusal on", async () => {
    const s = site();
    s.onLayoutWrite = () => {
      throw NextlyError.forbidden();
    };
    const d = deps(s);

    const error = await refusal(remove(d));

    expect(NextlyError.isCode(error, "FORBIDDEN")).toBe(true);
    expect(d.store.rows.size).toBe(0);
  });
});

describe("a write that committed and then failed", () => {
  it("settles the removal rather than dropping its fence, when the delete took effect", async () => {
    const s = site();
    s.failAfterWrite = true;
    const d = deps(s);

    const answer = await remove(d);

    expect(answer.message).toBe("The Layout was deleted.");
    expect(s.layouts.has("landing")).toBe(false);
    expect(d.store.rows.get("landing")).toMatchObject({ step: "removed" });
  });

  it("keeps the copy for a promotion that raced it, and restores from it", async () => {
    const s = site();
    s.failAfterWrite = true;
    s.onLayoutWrite = () => {
      s.defaultLayout = "landing";
    };
    const d = deps(s);

    const error = await refusal(remove(d));

    expect((error as Error).message).toBe(KEPT_AS_DEFAULT);
    expect(s.defaultLayout).toBe("restored-1");
  });

  it("settles an unpublish that took effect before its failure", async () => {
    const s = site();
    s.failAfterWrite = true;
    const d = deps(s);

    await remove(d, "unpublish");

    expect(s.layouts.get("landing")?.status).toBe("draft");
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      action: "unpublish",
    });
  });
});

describe("a Layout that changes while it is removed", () => {
  // As core hands a hook's refusal back: a conflict whose own details are
  // replaced on the way out, so the removal decides by reading the Layout.
  const moved = () =>
    NextlyError.conflict({
      logContext: {
        legacyMessage: "Use Remove Layout… on the Layout's screen",
      },
    });

  it("passes on a refusal that changed nothing, rather than taking the copy again", async () => {
    const s = site();
    let writes = 0;
    s.onLayoutWrite = () => {
      writes += 1;
      throw moved();
    };
    const d = deps(s);

    const error = await refusal(remove(d));

    expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
    expect(writes).toBe(1);
    expect(s.layouts.has("landing")).toBe(true);
    expect(d.store.rows.size).toBe(0);
  });

  it("takes the copy again and removes it", async () => {
    const s = site();
    let refusals = 1;
    s.onLayoutWrite = () => {
      if (refusals-- > 0) {
        s.layoutDrafts.set("landing", {
          id: "landing",
          title: "Edited",
          updatedAt: "2026-11-01T11:00:00.000Z",
        });
        throw moved();
      }
    };
    const d = deps(s);
    const copies: unknown[] = [];
    const advance = d.store.advance;
    d.store.advance = async change => {
      if (change.to === "final") copies.push(change.set?.copy);
      return advance(change);
    };

    await remove(d);

    expect(s.layouts.has("landing")).toBe(false);
    expect(copies).toHaveLength(2);
    // The second copy holds the edit the first did not.
    expect(copies[1]).toMatchObject({ draft: { title: "Edited" } });
  });

  it("takes the copy again when the write is refused as made from an out-of-date version, though the content is as it was", async () => {
    // A save that left the Layout's content unchanged still moves its version,
    // so the copy is no longer the one the write was made from.
    const s = site();
    let refusals = 1;
    s.onLayoutWrite = () => {
      if (refusals-- > 0) {
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "This document changed since the version you gave.",
        });
      }
    };
    const d = deps(s);
    const copies: unknown[] = [];
    const advance = d.store.advance;
    d.store.advance = async change => {
      if (change.to === "final") copies.push(change.set?.copy);
      return advance(change);
    };

    await remove(d, "unpublish");

    expect(s.layouts.get("landing")?.status).toBe("draft");
    expect(copies).toHaveLength(2);
  });

  it("gives up after three copies, saying to try again, and takes the fence down", async () => {
    const s = site();
    let edits = 0;
    // Every write meets an edit made since its copy.
    s.onLayoutWrite = () => {
      edits += 1;
      s.layoutDrafts.set("landing", {
        id: "landing",
        title: `Edited ${String(edits)}`,
        updatedAt: "2026-11-01T11:00:00.000Z",
      });
      throw moved();
    };
    const d = deps(s);

    const error = await refusal(remove(d));

    expect((error as Error).message).toBe(CHANGED_WHILE_REMOVING);
    expect(s.layouts.has("landing")).toBe(true);
    expect(d.store.rows.size).toBe(0);
  });
});

describe("a promotion landing between the last look at the default and the write", () => {
  it("restores a deleted Layout from its copy under a new id and points the default at it", async () => {
    const s = site();
    s.layoutDrafts.set("landing", {
      id: "landing",
      title: "Landing (edited)",
      areas: [],
      updatedAt: "2026-11-01T10:30:00.000Z",
    });
    s.onLayoutWrite = () => {
      s.defaultLayout = "landing";
    };
    const d = deps(s);

    const error = await refusal(remove(d));

    expect((error as Error).message).toBe(KEPT_AS_DEFAULT);
    expect(s.layouts.has("landing")).toBe(false);
    const restored = s.layouts.get("restored-1");
    expect(restored).toMatchObject({
      title: "Landing",
      slug: "landing",
      status: "published",
      // The repeater row's own id is the deleted Layout's, and is dropped.
      areas: [{ area: "header", component: "c-1" }],
    });
    // Its working draft is a working draft again, not its published form.
    expect(s.layoutDrafts.get("restored-1")).toMatchObject({
      title: "Landing (edited)",
    });
    expect(s.defaultLayout).toBe("restored-1");
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      copy: null,
    });
  });

  it("keeps the areas when the copy holds them as JSON text, as SQLite answers a repeater", async () => {
    const s = site();
    const landing = s.layouts.get("landing");
    if (landing !== undefined) {
      landing.areas = JSON.stringify([
        { id: "row-1", area: "header", component: "c-1" },
      ]);
    }
    s.onLayoutWrite = () => {
      s.defaultLayout = "landing";
    };
    const d = deps(s);

    await refusal(remove(d));

    expect(s.layouts.get("restored-1")?.areas).toEqual([
      { area: "header", component: "c-1" },
    ]);
  });

  it("restores the working draft's own address too", async () => {
    const s = site();
    s.layoutDrafts.set("landing", {
      id: "landing",
      title: "Landing",
      slug: "landing-renamed",
      areas: [],
      updatedAt: "2026-11-01T10:30:00.000Z",
    });
    s.onLayoutWrite = () => {
      s.defaultLayout = "landing";
    };
    const d = deps(s);

    await refusal(remove(d));

    expect(s.layouts.get("restored-1")?.slug).toBe("landing");
    expect(s.layoutDrafts.get("restored-1")).toMatchObject({
      slug: "landing-renamed",
    });
  });

  it("leaves an unpublish to the default repair, since undoing it would publish the draft", async () => {
    const s = site();
    s.onLayoutWrite = () => {
      s.defaultLayout = "landing";
    };
    const d = deps(s);

    const answer = await remove(d, "unpublish");

    expect(answer.message).toBe("The Layout was unpublished.");
    expect(s.created).toBe(0);
    expect(d.warned.some(m => m.includes("default repair"))).toBe(true);
  });
});

describe("a page write in flight when the fence went up", () => {
  it("is cleared after the delete when it left an unpublished page or a working draft on the Layout, and a live row is left", async () => {
    const s = site();
    // Committed after the final scan and before the delete: the pages name
    // the Layout only once the scan has passed.
    s.onLayoutWrite = () => {
      s.pages.push(
        { id: "u1", title: "Unpublished", status: "draft", layout: "landing" },
        { id: "d1", title: "Drafted", status: "published", layout: null },
        { id: "l1", title: "Live", status: "published", layout: "landing" }
      );
      s.pageDrafts.set("d1", { id: "d1", layout: "landing" });
    };
    const d = deps(s);

    await remove(d);

    expect(s.pages.find(page => page.id === "u1")?.layout).toBeNull();
    expect(s.pageDrafts.get("d1")?.layout).toBeNull();
    // A live row is never written without publishing its draft; it draws the
    // site default once the Layout is gone.
    expect(s.pages.find(page => page.id === "l1")?.layout).toBe("landing");
    expect(s.pageDrafts.has("l1")).toBe(false);
  });
});

describe("the scan", () => {
  it("is complete when it reads its whole budget and no page is left", async () => {
    const s = site();
    for (let i = 0; i < 3; i += 1) {
      s.pages.push({
        id: `p${String(i)}`,
        title: "P",
        status: "published",
        layout: null,
      });
    }

    const scan = await scanLayoutReferences({
      nextly: directApi(s),
      pages: "pages",
      layoutId: "landing",
      budget: 3,
    });

    expect(scan).toEqual({ references: [], complete: true, unread: [] });
  });

  it("is incomplete when the budget runs out with a page left", async () => {
    const s = site();
    for (let i = 0; i < 4; i += 1) {
      s.pages.push({
        id: `p${String(i)}`,
        title: "P",
        status: "published",
        layout: null,
      });
    }

    const scan = await scanLayoutReferences({
      nextly: directApi(s),
      pages: "pages",
      layoutId: "landing",
      budget: 3,
    });

    expect(scan.complete).toBe(false);
  });

  it("counts a published page's working draft only when it is one", async () => {
    const s = site();
    s.pages.push(
      { id: "p1", title: "A", status: "published", layout: null },
      { id: "p2", title: "B", status: "published", layout: null }
    );
    // p1 has a working draft naming the Layout; p2's by-id read falls back to
    // its live row, which names none.
    s.pageDrafts.set("p1", { id: "p1", layout: "landing" });

    const scan = await scanLayoutReferences({
      nextly: directApi(s),
      pages: "pages",
      layoutId: "landing",
    });

    expect(scan).toEqual({
      references: [{ id: "p1", title: "A", place: "draft" }],
      complete: true,
      unread: [],
    });
  });
});

describe("a long scan under the fence", () => {
  it("renews the row's lease as it goes, so it never looks stopped", async () => {
    const s = site();
    for (let i = 0; i < 250; i += 1) {
      s.pages.push({
        id: `p${String(i).padStart(3, "0")}`,
        title: "P",
        status: "published",
        layout: null,
      });
    }
    // Two minutes pass between every look at the clock.
    let minutes = 0;
    const started = Date.now();
    const d = {
      ...deps(s),
      now: () => {
        minutes += 2;
        return new Date(started + minutes * 60_000);
      },
    };

    const answer = await removeLayout(d, {
      layoutId: "landing",
      action: "delete",
      dryRun: false,
    });

    expect(answer.message).toBe("The Layout was deleted.");
    expect(d.store.renewals).toContainEqual({
      layoutId: "landing",
      token: "token-1",
      step: "checked",
    });
  });
});

describe("a page deleted while the scan reads it", () => {
  /** The Direct API over `s`, with `gone` deleted after it was listed. */
  function deletedAfterListing(s: Site, gone: string) {
    const api = directApi(s);
    const findByID = api.findByID.bind(api);
    return Object.assign(Object.create(api) as object, {
      findByID: async (args: Parameters<typeof api.findByID>[0]) => {
        if (args.id === gone) {
          s.pages = s.pages.filter(page => page.id !== gone);
          throw NextlyError.notFound();
        }
        return findByID(args);
      },
    }) as typeof api;
  }

  /**
   * The Direct API over `s`, where reading `page` by id answers not found
   * though the page is still there, as a read hook about something it relates
   * to can.
   */
  function unreadable(s: Site, page: string) {
    const api = directApi(s);
    const findByID = api.findByID.bind(api);
    return Object.assign(Object.create(api) as object, {
      findByID: async (args: Parameters<typeof api.findByID>[0]) => {
        if (args.id === page) throw NextlyError.notFound();
        return findByID(args);
      },
    }) as typeof api;
  }

  it("says the scan is incomplete when a page still there can't be read", async () => {
    const s = site();
    s.pages.push(
      { id: "p1", title: "Unreadable", status: "published", layout: null },
      { id: "p2", title: "Kept", status: "published", layout: null }
    );
    s.pageDrafts.set("p1", { id: "p1", layout: "landing" });

    const scan = await scanLayoutReferences({
      nextly: unreadable(s, "p1"),
      pages: "pages",
      layoutId: "landing",
    });

    expect(scan.complete).toBe(false);
  });

  it("reads on past it, still finding a later page's working draft", async () => {
    const s = site();
    s.pages.push(
      { id: "p1", title: "Gone", status: "published", layout: null },
      { id: "p2", title: "Kept", status: "published", layout: null }
    );
    s.pageDrafts.set("p2", { id: "p2", layout: "landing" });

    const scan = await scanLayoutReferences({
      nextly: deletedAfterListing(s, "p1"),
      pages: "pages",
      layoutId: "landing",
    });

    expect(scan).toEqual({
      references: [{ id: "p2", title: "Kept", place: "draft" }],
      complete: true,
      unread: [],
    });
  });

  it("lets the removal through when the only page naming the Layout is deleted after it was listed", async () => {
    const s = site();
    s.pages.push({
      id: "p1",
      title: "Gone",
      status: "draft",
      layout: "landing",
    });
    const d = deps(s);
    const api = d.nextly;
    const find = api.find.bind(api);
    // The page is deleted right after the scan lists the rows naming the
    // Layout, once.
    let deleted = false;
    const nextly = Object.assign(Object.create(api) as object, {
      find: async (args: Parameters<typeof find>[0]) => {
        const answered = await find(args);
        const where = args.where as { layout?: unknown } | undefined;
        if (!deleted && where?.layout !== undefined) {
          deleted = true;
          s.pages = s.pages.filter(page => page.id !== "p1");
        }
        return answered;
      },
    }) as typeof api;

    const answer = await removeLayout(
      { ...d, nextly },
      { layoutId: "landing", action: "delete", dryRun: false }
    );

    expect(deleted).toBe(true);
    expect(answer.message).toBe("The Layout was deleted.");
    expect(s.layouts.has("landing")).toBe(false);
  });

  it("keeps a removal to retry when the scan after its write can't read a page still there", async () => {
    const s = site();
    s.layouts.delete("landing");
    s.pages.push({
      id: "p1",
      title: "Unreadable",
      status: "published",
      layout: null,
    });
    s.pageDrafts.set("p1", { id: "p1", layout: "landing" });
    const logged: { message: string; meta?: Record<string, unknown> }[] = [];
    const d = {
      ...deps(s),
      warn: (message: string, meta?: Record<string, unknown>) => {
        logged.push({ message, ...(meta === undefined ? {} : { meta }) });
      },
    };
    await d.store.mark({
      layoutId: "landing",
      action: "delete",
      token: "stopped",
      startedBy: null,
      now: new Date(),
    });
    const removal = d.store.rows.get("landing");
    if (removal === undefined) throw new Error("no row");
    const copy = { live: { id: "landing", title: "Landing" }, draft: null };
    d.store.rows.set("landing", { ...removal, step: "removed", copy });

    await settleLayoutRemovals({
      ...d,
      nextly: unreadable(s, "p1"),
      now: () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000),
    });

    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      settledAt: null,
      copy,
    });
    expect(logged).toContainEqual({
      message: expect.stringContaining("could not read every page"),
      meta: expect.objectContaining({ layoutId: "landing", unread: ["p1"] }),
    });
  });

  it("still clears the other pages a removal left on the Layout", async () => {
    const s = site();
    s.layouts.delete("landing");
    s.pages.push(
      { id: "p1", title: "Gone", status: "draft", layout: "landing" },
      { id: "p2", title: "Kept", status: "draft", layout: "landing" }
    );
    const d = deps(s);
    await d.store.mark({
      layoutId: "landing",
      action: "delete",
      token: "stopped",
      startedBy: null,
      now: new Date(),
    });
    const removal = d.store.rows.get("landing");
    if (removal === undefined) throw new Error("no row");
    d.store.rows.set("landing", { ...removal, step: "removed" });

    await settleLayoutRemovals({
      ...d,
      nextly: deletedAfterListing(s, "p1"),
      now: () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000),
    });

    expect(s.pages.find(page => page.id === "p2")?.layout).toBeNull();
  });
});

describe("the scan's cursor", () => {
  it("still reads a later page's working draft when a page it passed is deleted", async () => {
    const s = site();
    for (let i = 0; i < 150; i += 1) {
      s.pages.push({
        id: `p${String(i).padStart(3, "0")}`,
        title: `Page ${String(i)}`,
        status: "published",
        layout: null,
      });
    }
    // The first page of the published walk is p000 to p099; p100 opens the
    // second, and only its working draft names the Layout.
    s.pageDrafts.set("p100", { id: "p100", layout: "landing" });
    const api = directApi(s);
    const find = api.find.bind(api);
    let publishedReads = 0;
    const deleting = Object.assign(Object.create(api) as object, {
      find: async (args: Parameters<typeof api.find>[0]) => {
        const answered = await find(args);
        if (args.status === "published") {
          publishedReads += 1;
          // A page the walk already passed is deleted before the next read.
          if (publishedReads === 1) {
            s.pages = s.pages.filter(page => page.id !== "p005");
          }
        }
        return answered;
      },
    }) as typeof api;

    const scan = await scanLayoutReferences({
      nextly: deleting,
      pages: "pages",
      layoutId: "landing",
    });

    expect(scan).toEqual({
      references: [{ id: "p100", title: "Page 100", place: "draft" }],
      complete: true,
      unread: [],
    });
  });
});

describe("the scan's reads", () => {
  it("reads working drafts in bounded batches, never one page at a time", async () => {
    const s = site();
    for (let i = 0; i < 45; i += 1) {
      s.pages.push({
        id: `p${String(i)}`,
        title: "P",
        status: "published",
        layout: null,
      });
    }
    const api = directApi(s);
    let inFlight = 0;
    let most = 0;
    const findByID = api.findByID.bind(api);
    const counted = Object.assign(Object.create(api) as object, {
      findByID: async (args: Parameters<typeof api.findByID>[0]) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight -= 1;
        return findByID(args);
      },
    }) as typeof api;

    await scanLayoutReferences({
      nextly: counted,
      pages: "pages",
      layoutId: "landing",
    });

    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(10);
  });

  it("names every readable page however many use the Layout, asking in chunks under the database's limits", async () => {
    const s = site();
    const references = [];
    for (let i = 0; i < 1200; i += 1) {
      const id = `p${String(i)}`;
      s.pages.push({
        id,
        title: `Page ${String(i)}`,
        status: "draft",
        layout: "landing",
      });
      references.push({
        id,
        title: `Page ${String(i)}`,
        place: "unpublished" as const,
      });
    }
    s.hidden.add("p7");
    const api = directApi(s);
    const asked: number[] = [];
    const find = api.find.bind(api);
    const counted = Object.assign(Object.create(api) as object, {
      find: async (args: Parameters<typeof api.find>[0]) => {
        const ids = (args.where as { id?: { in?: unknown[] } } | undefined)?.id
          ?.in;
        if (Array.isArray(ids)) asked.push(ids.length);
        // A read answers at most 500 rows, as collection reads clamp it.
        return find({
          ...args,
          limit: Math.min(Number(args.limit ?? 10), 500),
        });
      },
    }) as typeof api;

    const named = await readableTitles({
      nextly: counted,
      pages: "pages",
      references,
      asPerson: PERSON as never,
    });

    expect(named.readable).toHaveLength(1199);
    expect(named.unreadable).toBe(1);
    expect(Math.max(...asked)).toBeLessThanOrEqual(500);
  });
});

describe("the sweep", () => {
  const stale = () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000);

  async function leftAt(
    store: ReturnType<typeof memoryStore>,
    step: LayoutRemoval["step"],
    copy: LayoutRemoval["copy"] = null
  ) {
    await store.mark({
      layoutId: "landing",
      action: "delete",
      token: "stopped",
      startedBy: null,
      now: new Date(),
    });
    const removal = store.rows.get("landing");
    if (removal !== undefined)
      store.rows.set("landing", { ...removal, step, copy });
  }

  it.each(["marked", "checked"] as const)(
    "clears a row left at %s past the lease, which changed nothing",
    async step => {
      const s = site();
      const d = deps(s);
      await leftAt(d.store, step);

      await settleLayoutRemovals({ ...d, now: stale });

      expect(d.store.rows.size).toBe(0);
      expect(s.layouts.has("landing")).toBe(true);
    }
  );

  it("leaves a row that moved on after the sweep read it", async () => {
    const s = site();
    const d = deps(s);
    await leftAt(d.store, "checked");
    const unsettled = d.store.unsettled.bind(d.store);
    // The request holding the row moves it on between the sweep's read and
    // its clear, as a long scan finishing would.
    d.store.unsettled = async () => {
      const read = await unsettled();
      await d.store.advance({
        layoutId: "landing",
        token: "stopped",
        from: "checked",
        to: "final",
      });
      return read;
    };

    await settleLayoutRemovals({ ...d, now: stale });

    expect(d.store.rows.get("landing")).toMatchObject({
      step: "final",
      token: "stopped",
    });
  });

  it("drops the tombstones of Layouts published again in chunks, past the database's bound parameters", async () => {
    const s = site();
    const d = deps(s);
    for (let i = 0; i < 450; i += 1) {
      const id = `t${String(i)}`;
      s.layouts.set(id, { id, title: id, status: "published" });
      d.store.rows.set(id, {
        layoutId: id,
        action: "unpublish",
        step: "removed",
        token: `token-${id}`,
        startedBy: null,
        pagesLeft: null,
        copy: null,
        copyVersion: null,
        settledAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const find = d.nextly.find.bind(d.nextly);
    const bounded = {
      ...d,
      nextly: Object.assign(Object.create(d.nextly) as object, {
        find: async (args: Parameters<typeof find>[0]) => {
          const ids = (args.where as { id?: { in?: unknown[] } } | undefined)
            ?.id?.in;
          // A database refuses a statement with more bound parameters than it
          // takes, as SQLite does past its limit.
          if (Array.isArray(ids) && ids.length > 250) {
            throw new Error("too many SQL variables");
          }
          return find(args);
        },
      }) as typeof d.nextly,
    };

    await settleLayoutRemovals(bounded);

    expect(d.store.rows.size).toBe(0);
  });

  it("undoes an unpublish it finishes when a page published meanwhile names the Layout", async () => {
    const s = site();
    const d = deps(s);
    const live = s.layouts.get("landing");
    await d.store.mark({
      layoutId: "landing",
      action: "unpublish",
      token: "stopped",
      startedBy: null,
      now: new Date(),
    });
    const removal = d.store.rows.get("landing");
    if (removal === undefined || live === undefined) throw new Error("no row");
    d.store.rows.set("landing", {
      ...removal,
      step: "final",
      copy: { live: { ...live }, draft: null },
    });
    // The unpublish landed, then the request stopped; a page published in
    // between names the Layout.
    s.layouts.set("landing", { ...live, status: "draft" });
    s.pages.push({
      id: "home",
      title: "Home",
      status: "published",
      layout: "landing",
    });

    await settleLayoutRemovals({ ...d, now: stale });

    expect(s.layouts.get("landing")?.status).toBe("published");
    expect(d.store.rows.has("landing")).toBe(false);
    expect(s.pages[0]?.layout).toBe("landing");
  });

  it("leaves a row inside its lease to the request that holds it", async () => {
    const s = site();
    const d = deps(s);
    await leftAt(d.store, "marked");

    await settleLayoutRemovals(d);

    expect(d.store.rows.get("landing")?.step).toBe("marked");
  });

  it("clears a final row whose delete never landed", async () => {
    const s = site();
    const d = deps(s);
    await leftAt(d.store, "final");

    await settleLayoutRemovals({ ...d, now: stale });

    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
  });

  it("finishes a final row whose delete landed, restoring it when the default names it", async () => {
    const s = site();
    const d = deps(s);
    const live = s.layouts.get("landing");
    await leftAt(d.store, "final", {
      live: { ...live, id: "landing" },
      draft: null,
    });
    s.layouts.delete("landing");
    s.defaultLayout = "landing";

    await settleLayoutRemovals({ ...d, now: stale });

    expect(s.defaultLayout).toBe("restored-1");
    expect(d.store.rows.get("landing")).toMatchObject({ step: "removed" });
    expect(d.store.rows.get("landing")?.settledAt).toBeInstanceOf(Date);
  });
});

describe("Move pages, then remove", () => {
  /** A site whose default is "Main", with `count` unpublished pages on Landing. */
  function movingSite(count: number): Site {
    const s = site();
    s.layouts.set("main", { id: "main", title: "Main", status: "published" });
    s.defaultLayout = "main";
    s.pageWrites = [];
    s.rewrites = [];
    for (let i = 0; i < count; i += 1) {
      s.pages.push({
        id: `u${String(i).padStart(3, "0")}`,
        title: `Page ${String(i)}`,
        status: "draft",
        layout: "landing",
      });
    }
    return s;
  }

  /** One tick, as the dialog calls it. */
  const tick = (d: MoveDeps, request: Partial<MoveRequest> = {}) =>
    movePages(d, { layoutId: "landing", action: "delete", ...request });

  /**
   * Tick as the dialog does until the move leaves `moving`, carrying the token
   * and the cursor each answer gives. Answers every tick's progress.
   */
  async function run(
    d: MoveDeps,
    action: "delete" | "unpublish" = "delete"
  ): Promise<MoveProgress[]> {
    const ticks: MoveProgress[] = [];
    let next: Partial<MoveRequest> = { action };
    for (let i = 0; i < 50; i += 1) {
      const move = (await tick(d, next)).item.move;
      if (move === undefined) throw new Error("a tick answered no move");
      ticks.push(move);
      if (move.state !== "moving") return ticks;
      next = { action, token: move.token, after: move.after };
    }
    throw new Error("the move never finished");
  }

  /** Where page `id` names a Layout now: its working draft's, else its row's. */
  function layoutOf(s: Site, id: string): unknown {
    const draft = s.pageDrafts.get(id);
    if (draft !== undefined) return draft.layout;
    return s.pages.find(page => page.id === id)?.layout;
  }

  it("dry-runs with each page's state, the live rows and the site default's name", async () => {
    const s = movingSite(1);
    s.pages.push(
      { id: "p1", title: "Pricing", status: "published", layout: "landing" },
      { id: "p2", title: "Home", status: "published", layout: "landing" }
    );
    s.pageDrafts.set("p2", { id: "p2", layout: "landing" });
    const d = deps(s);

    const answer = await remove(d, "delete", true);

    expect(answer.item.check).toEqual({
      isDefault: false,
      pages: [
        { id: "p1", title: "Pricing", state: "published" },
        { id: "p2", title: "Home", state: "edited" },
        { id: "u000", title: "Page 0", state: "unpublished" },
      ],
      unreadable: 0,
      complete: true,
      pagesCollection: "pages",
      liveRows: 2,
      siteDefault: "Main",
    });
  });

  it("moves every page, live copies and drafts alike, in bounded ticks, through the rewrite, then deletes the Layout", async () => {
    const s = movingSite(60);
    s.pages.push(
      { id: "live", title: "Live", status: "published", layout: "landing" },
      { id: "edited", title: "Edited", status: "published", layout: "landing" }
    );
    s.pageDrafts.set("edited", {
      id: "edited",
      title: "Unfinished",
      layout: "landing",
    });
    const d = deps(s);

    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({ state: "done", moved: expect.any(Number) });
    // Each tick answers what it moved; the dialog adds them up.
    expect(ticks.reduce((sum, progress) => sum + progress.moved, 0)).toBe(62);
    // No tick moved more than its bound, so the 62 took three of them.
    expect(Math.max(...ticks.map(progress => progress.moved))).toBe(
      PAGES_PER_TICK
    );
    expect(ticks).toHaveLength(3);
    expect(s.layouts.has("landing")).toBe(false);
    // Every page is off the Layout: each unpublished row, both live copies,
    // and the working draft, which is still a draft holding its own edit.
    expect(s.pages.map(page => page.layout)).toEqual(s.pages.map(() => null));
    expect(s.pageDrafts.get("edited")).toEqual({
      id: "edited",
      title: "Unfinished",
      layout: null,
    });
    expect(s.pages.find(page => page.id === "edited")).toMatchObject({
      status: "published",
    });
    // One rewrite of `layout` per page, from the version read, with the
    // reason the page's history keeps; no page was saved.
    expect(s.rewrites).toHaveLength(62);
    expect(s.rewrites?.[0]).toMatchObject({
      collection: "pages",
      field: "layout",
      expectedVersion: "7",
      reason:
        'Layout "Landing" is being deleted, so this page was moved to the site default.',
    });
    expect(s.pageWrites).toEqual([]);
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      pagesLeft: 0,
    });
  });

  it("keeps a copy that names another Layout", async () => {
    const s = movingSite(0);
    s.pages.push({
      id: "edited",
      title: "Edited",
      status: "published",
      layout: "landing",
    });
    s.pageDrafts.set("edited", { id: "edited", layout: "main" });
    const d = deps(s);

    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({ state: "done", moved: 1 });
    expect(s.pages[0]?.layout).toBeNull();
    expect(s.pageDrafts.get("edited")?.layout).toBe("main");
  });

  it("moves the draft of a page the person may not publish, leaves its live copy, finishes, and names it", async () => {
    const s = movingSite(1);
    s.pages.push(
      { id: "edited", title: "Edited", status: "published", layout: "landing" },
      { id: "live", title: "Live", status: "published", layout: "landing" },
      { id: "theirs", title: "Theirs", status: "published", layout: "landing" }
    );
    s.pageDrafts.set("edited", { id: "edited", layout: "landing" });
    // The person may publish "theirs", and only edit the other two.
    s.mayNotPublish = new Set(["edited", "live"]);
    const d = deps(s);

    const ticks = await run(d);

    // The draft moved as a save of it, as the person; both live copies were
    // left, and the removal finished all the same.
    expect(s.pageDrafts.get("edited")).toMatchObject({ layout: null });
    expect(
      s.pages
        .filter(page => page.status === "published")
        .map(page => [page.id, page.layout])
    ).toEqual([
      ["edited", "landing"],
      ["live", "landing"],
      ["theirs", null],
    ]);
    expect(s.pageWrites).toEqual([
      expect.objectContaining({
        id: "edited",
        overrideAccess: false,
        user: PERSON.user,
        data: expect.objectContaining({ layout: null }),
      }),
    ]);
    expect(s.layouts.has("landing")).toBe(false);
    // The pages whose live copy still names it, by the titles the person
    // reads, for someone who may publish them.
    expect(ticks.at(-1)).toEqual({
      state: "done",
      moved: 3,
      liveLeft: {
        pages: [
          { id: "edited", title: "Edited" },
          { id: "live", title: "Live" },
        ],
        unreadable: 0,
      },
    });
  });

  it("reads a page again when it was saved since its read, and moves it", async () => {
    const s = movingSite(2);
    s.savedSinceRead = new Map([["u001", 2]]);
    const d = deps(s);

    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({ state: "done", moved: 2 });
    expect(layoutOf(s, "u001")).toBeNull();
    // Two refused from a read the page had moved on from, the third applied.
    expect(s.rewrites?.filter(request => request.id === "u001")).toHaveLength(
      3
    );
  });

  it("stops reading a page that keeps being saved, names it with why, and keeps the Layout", async () => {
    const s = movingSite(2);
    s.savedSinceRead = new Map([["u001", 10]]);
    const d = deps(s);

    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({
      state: "refused",
      moved: 1,
      pages: [{ id: "u001", title: "Page 1", reason: PAGE_KEPT_CHANGING }],
      unreadable: 0,
      complete: true,
    });
    // A bounded number of reads, then the page is reported.
    expect(s.rewrites?.filter(request => request.id === "u001")).toHaveLength(
      3
    );
    expect(layoutOf(s, "u001")).toBe("landing");
    expect(s.layouts.has("landing")).toBe(true);
    expect(d.store.rows.size).toBe(0);
  });

  it("unpublishes the Layout after moving, a live copy the person may not publish notwithstanding", async () => {
    const s = movingSite(2);
    s.pages.push({
      id: "live",
      title: "Live",
      status: "published",
      layout: "landing",
    });
    s.mayNotPublish = new Set(["live"]);
    const d = deps(s);

    const ticks = await run(d, "unpublish");

    expect(ticks.at(-1)).toEqual({
      state: "done",
      moved: 2,
      liveLeft: { pages: [{ id: "live", title: "Live" }], unreadable: 0 },
    });
    expect(s.layouts.get("landing")?.status).toBe("draft");
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "removed",
      action: "unpublish",
    });
  });

  it("leaves a page the person may not edit, names it with why, and keeps the Layout", async () => {
    const s = movingSite(3);
    s.readOnly = new Set(["u001"]);
    const d = deps(s);

    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({
      state: "refused",
      moved: 2,
      pages: [{ id: "u001", title: "Page 1", reason: CANT_EDIT_PAGE }],
      unreadable: 0,
      complete: true,
    });
    expect(s.layouts.has("landing")).toBe(true);
    expect(layoutOf(s, "u000")).toBeNull();
    expect(layoutOf(s, "u001")).toBe("landing");
    // The fence came down: the move is over.
    expect(d.store.rows.size).toBe(0);
  });

  it("does not try a refused page again on every tick", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    s.readOnly = new Set(["u000"]);
    const d = deps(s);

    await run(d);

    const tried = (s.pageWrites ?? []).filter(write => write.id === "u000");
    expect(tried).toHaveLength(1);
  });

  it("refuses a person without the removal's grant before the fence or any page write", async () => {
    const s = movingSite(3);
    const asked: string[] = [];
    const d = {
      ...deps(s),
      mayRemove: async (action: string) => {
        asked.push(action);
        return false;
      },
    };

    const refused = await refusal(tick(d));

    expect(NextlyError.isCode(refused, "FORBIDDEN")).toBe(true);
    expect(asked).toEqual(["delete"]);
    expect(d.store.rows.size).toBe(0);
    expect(s.pageWrites).toEqual([]);
    expect(s.layouts.has("landing")).toBe(true);
  });

  it("refuses to start while the site has no published default, writing no page", async () => {
    for (const lacking of ["none", "unpublished"] as const) {
      const s = movingSite(3);
      if (lacking === "none") s.defaultLayout = null;
      else
        s.layouts.set("main", { id: "main", title: "Main", status: "draft" });
      const d = deps(s);

      const refused = await refusal(tick(d));

      expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
      expect((refused as NextlyError).publicMessage).toBe(NO_USABLE_DEFAULT);
      expect(d.store.rows.size).toBe(0);
      expect(s.pageWrites).toEqual([]);
    }
  });

  it("refuses the next tick once the default is unpublished mid-move, keeping the pages moved", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    const first = (await tick(d)).item.move;
    if (first?.state !== "moving") throw new Error("the move did not start");
    s.layouts.set("main", { id: "main", title: "Main", status: "draft" });
    const writes = s.pageWrites?.length;

    const refused = await refusal(
      tick(d, { token: first.token, after: first.after })
    );

    expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
    expect(s.pageWrites?.length).toBe(writes);
    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
  });

  it("stops between ticks, keeping the pages moved and the Layout", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    const first = (await tick(d)).item.move;
    if (first?.state !== "moving") throw new Error("the move did not start");

    const stopped = await tick(d, { token: first.token, stop: true });

    expect(stopped.item.move).toEqual({ state: "stopped", moved: 0 });
    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
    expect(s.pages.filter(page => page.layout === null)).toHaveLength(
      PAGES_PER_TICK
    );
  });

  it("answers a tick of a move the sweep cleared as stopped, writing nothing", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    const first = (await tick(d)).item.move;
    if (first?.state !== "moving") throw new Error("the move did not start");
    const writes = s.pageWrites?.length;

    // The dialog closed: the lease lapses, and the sweep takes the row away.
    await settleLayoutRemovals({
      ...d,
      now: () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000),
    });
    const late = await tick(d, { token: first.token, after: first.after });

    expect(late.item.move).toEqual({ state: "stopped", moved: 0 });
    expect(s.pageWrites?.length).toBe(writes);
    expect(s.layouts.has("landing")).toBe(true);
    expect(s.pages.filter(page => page.layout === null)).toHaveLength(
      PAGES_PER_TICK
    );
  });

  it("lets its starter start it again at once, picking up the pages left", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    const first = (await tick(d)).item.move;
    if (first?.state !== "moving") throw new Error("the move did not start");

    // The dialog closed without a Stop and was opened again in the lease.
    const ticks = await run(d);

    expect(ticks.at(-1)).toEqual({ state: "done", moved: 5 });
    expect(s.layouts.has("landing")).toBe(false);
  });

  it("refuses a second person while the move runs, and a plain removal too", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    const first = (await tick(d)).item.move;
    if (first?.state !== "moving") throw new Error("the move did not start");
    const other = {
      ...d,
      person: { userId: "someone-else", as: PERSON as never },
    };

    const started = await refusal(tick(other));
    const continued = await refusal(
      tick(other, { token: first.token, after: first.after })
    );
    const plain = await refusal(remove(d));

    expect((started as Error).message).toBe(ALREADY_BEING_REMOVED);
    expect((continued as Error).message).toBe(ALREADY_BEING_REMOVED);
    expect((plain as Error).message).toBe(ALREADY_BEING_REMOVED);
    expect(d.store.rows.get("landing")).toMatchObject({
      step: "moving",
      token: first.token,
    });
  });

  it("starts no new page save once a tick's time is spent, but always moves one", async () => {
    const s = movingSite(5);
    // Three seconds pass between every look at the clock.
    let seconds = 0;
    const started = Date.now();
    const d = {
      ...deps(s),
      now: () => {
        seconds += 3;
        return new Date(started + seconds * 1000);
      },
    };

    const first = (await tick(d)).item.move;

    expect(first).toMatchObject({ state: "moving", moved: 1, left: 4 });
  });

  it("refuses the site's default, putting no fence up", async () => {
    const s = movingSite(1);
    s.defaultLayout = "landing";
    const d = deps(s);

    const error = await refusal(tick(d));

    expect((error as Error).message).toContain("Choose another default first");
    expect(d.store.rows.size).toBe(0);
    expect(layoutOf(s, "u000")).toBe("landing");
  });

  it("clears a stale move without removing the Layout or undoing a page", async () => {
    const s = movingSite(PAGES_PER_TICK + 5);
    const d = deps(s);
    await tick(d);

    await settleLayoutRemovals({
      ...d,
      now: () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000),
    });

    expect(d.store.rows.size).toBe(0);
    expect(s.layouts.has("landing")).toBe(true);
    expect(s.pages.filter(page => page.layout === null)).toHaveLength(
      PAGES_PER_TICK
    );
  });
});

describe("a plain removal, with a page on the Layout only on its live row", () => {
  it("still refuses, as strict as without a move", async () => {
    const s = site();
    s.pages.push({
      id: "p1",
      title: "Live",
      status: "published",
      layout: "landing",
    });
    const d = deps(s);

    const error = await refusal(remove(d));

    expect((error as Error).message).toBe(
      '1 page uses this Layout: "Live". Choose another Layout for it first.'
    );
    expect(s.layouts.has("landing")).toBe(true);
  });
});
