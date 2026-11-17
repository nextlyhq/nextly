/**
 * The check of every document for the bindings report: nothing to do while
 * the schema is unchanged, a walk once it changes, resumed where a pass
 * stopped, never writing over a save judged after it read the document, and
 * rows of documents no longer there dropped once it completes; and, in the
 * same pass, where each document binds a Single, settled with its row.
 */
import {
  createBlockRegistry,
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { documentKeyOf, type HostAddress } from "../host-rewrite/contract";
import type { HostDocument } from "../host-rewrite/rewrite";

import type { BindingReportRow } from "./rows";
import { runFullCheck, type BindingReportDeps } from "./scan";
import type { BindingReportStore, FullCheck, ReportedDocument } from "./store";
import type { DocumentUse } from "./uses-store";

/** A page's key in the report, as the check writes it. */
const keyOf = (id: string): string =>
  documentKeyOf({ kind: "collection", slug: "pages", id });

/** The store, in memory, keeping its marks as the table does. */
function memoryStore() {
  const rows = new Map<
    string,
    {
      document: ReportedDocument;
      rows: readonly BindingReportRow[];
      at: Date;
      dirty: string | null;
    }
  >();
  let check: FullCheck = {
    checked: null,
    completedAt: null,
    checking: null,
    cursor: null,
    startedAt: null,
    usesPending: false,
  };
  let tokens = 0;
  let filled = 0;
  const uses = new Map<string, readonly DocumentUse[]>();
  const store: BindingReportStore = {
    record: async (document, found, used) => {
      const held = rows.get(document.documentKey);
      // A row a write marked is the judgement's to settle.
      if (held !== undefined && held.dirty !== null) return;
      rows.set(document.documentKey, {
        document,
        rows: found,
        at: new Date(),
        dirty: null,
      });
      uses.set(document.documentKey, used);
    },
    markDirty: async document => {
      tokens += 1;
      const held = rows.get(document.documentKey);
      const token = `t${String(tokens)}`;
      rows.set(document.documentKey, {
        document,
        rows: held?.rows ?? [],
        at: held?.at ?? new Date(),
        dirty: token,
      });
      return token;
    },
    dirty: async (limit, after) =>
      [...rows.entries()]
        .filter(
          ([key, row]) =>
            row.dirty !== null && (after === undefined || key > after)
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, row]) => row)
        .slice(0, limit)
        .map(row => ({ document: row.document, token: row.dirty ?? "" })),
    settle: async (marked, found, used) => {
      const held = rows.get(marked.document.documentKey);
      if (held === undefined || held.dirty !== marked.token) return false;
      rows.set(marked.document.documentKey, {
        document: held.document,
        rows: found,
        at: new Date(),
        dirty: null,
      });
      uses.set(marked.document.documentKey, used);
      return true;
    },
    keepUses: async (marked, used) => {
      const held = rows.get(marked.document.documentKey);
      if (held === undefined || held.dirty !== marked.token) return false;
      uses.set(marked.document.documentKey, used);
      return true;
    },
    list: async () =>
      [...rows.values()]
        .filter(row => row.rows.length > 0)
        .map(({ document, rows: found, at }) => ({
          ...document,
          rows: found,
          checkedAt: at,
        })),
    get: async key => {
      const held = rows.get(key);
      return held === undefined || held.rows.length === 0
        ? undefined
        : { ...held.document, rows: held.rows, checkedAt: held.at };
    },
    fullCheck: async () => check,
    setFullCheck: async state => {
      check = state;
    },
    dropCheckedBefore: async at => {
      for (const [key, row] of rows) {
        if (row.dirty === null && row.at.getTime() < at.getTime() - 1000) {
          rows.delete(key);
          uses.delete(key);
        }
      }
    },
    markUsesFilled: async () => {
      filled += 1;
    },
  };
  return { store, rows, uses, filled: () => filled, check: () => check };
}

const POSTS: readonly BindingFieldShape[] = [{ name: "title", type: "text" }];

/** A page binding `path` on its one heading. */
const pageBinding = (path: string) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: 2 },
      bindings: { text: { $bind: path } },
    },
  ],
});

/** A page whose heading, named `name`, shows a Single's field. */
const pageShowing = (single: string, path: string, name?: string) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "core/heading",
      version: 1,
      ...(name === undefined ? {} : { name }),
      props: { text: "Own", level: 2 },
      bindings: { text: { $bind: path, source: "single", sourceKey: single } },
    },
  ],
});

/**
 * A site of pages, each with its content (and a draft, where `drafts` holds
 * one), and the documents it read.
 */
function site(
  contents: Record<string, unknown>,
  fingerprint: () => string,
  drafts: Record<string, unknown> = {}
) {
  const host = (id: string): HostAddress => ({
    kind: "collection",
    slug: "pages",
    id,
    path: ["content"],
  });
  const documents = Object.keys(contents).map(
    (id): HostDocument => ({
      key: keyOf(id),
      hosts: [{ host: host(id), access: "write" }],
    })
  );
  const read: string[] = [];
  return {
    read,
    walk: {
      documents: async function* (cursor: string | null) {
        const from =
          cursor === null
            ? 0
            : documents.findIndex(document => document.key === cursor) + 1;
        for (const document of documents.slice(from)) yield document;
      },
      cursorOf: (document: HostDocument) => document.key,
      fingerprint: async () => fingerprint(),
    },
    reading: {
      hostsOf: async (at: { id?: string }) => [
        { host: host(at.id ?? ""), access: "write" as const },
      ],
      read: async (address: HostAddress) => {
        read.push(address.id ?? "");
        return {
          published: {
            kind: "value" as const,
            value: contents[address.id ?? ""],
          },
          draft:
            drafts[address.id ?? ""] === undefined
              ? null
              : { kind: "value" as const, value: drafts[address.id ?? ""] },
          liveState: null,
        };
      },
    },
  };
}

function deps(
  store: BindingReportStore,
  reading: ReturnType<typeof site>["reading"]
): BindingReportDeps {
  return {
    store: () => store,
    reading: () => reading,
    shapesOf: async ref => ("collection" in ref ? POSTS : undefined),
    limits: () => ({ maxNodes: 2000 }) as never,
    placeOf: () => "pages",
    // The site's block registry: it holds none.
    blocks: createBlockRegistry(),
  };
}

const LATER = () => new Date(Date.now() + 60_000);

describe("the check of every document", () => {
  it("walks every document once the schema changes, and then does nothing", async () => {
    const memory = memoryStore();
    const pages = site(
      { a: pageBinding("headline"), b: pageBinding("title") },
      () => "v1"
    );
    const using = deps(memory.store, pages.reading);
    expect(await runFullCheck(pages.walk, using, LATER())).toBe("complete");
    expect((await memory.store.list()).map(row => row.documentKey)).toEqual([
      keyOf("a"),
    ]);
    expect(memory.check()).toMatchObject({ checked: "v1", checking: null });
    expect(memory.check().completedAt).not.toBeNull();

    pages.read.length = 0;
    expect(await runFullCheck(pages.walk, using, LATER())).toBe("current");
    expect(pages.read).toEqual([]);
  });

  it("stops at the deadline and resumes after the last document it judged", async () => {
    const memory = memoryStore();
    const pages = site(
      { a: pageBinding("headline"), b: pageBinding("headline") },
      () => "v1"
    );
    const using = deps(memory.store, pages.reading);
    // A deadline already past: the pass stops before judging anything.
    expect(await runFullCheck(pages.walk, using, new Date(0))).toBe("paused");
    expect(memory.check()).toMatchObject({ checking: "v1", cursor: null });
    expect(await runFullCheck(pages.walk, using, LATER())).toBe("complete");
    expect(
      (await memory.store.list()).map(row => row.documentKey).sort()
    ).toEqual([keyOf("a"), keyOf("b")]);
  });

  it("leaves a document a write marked during the check to the next pass, which settles it", async () => {
    const memory = memoryStore();
    const contents: Record<string, unknown> = { a: pageBinding("headline") };
    const pages = site(contents, () => "v1");
    const key = keyOf("a");
    const document: ReportedDocument = {
      documentKey: key,
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    };
    // A save that fixes the page lands while the check is reading it.
    const reading = {
      ...pages.reading,
      read: async (address: HostAddress) => {
        const answer = await pages.reading.read(address);
        contents.a = pageBinding("title");
        await memory.store.markDirty(document);
        return answer;
      },
    };
    const using = deps(memory.store, reading);
    await runFullCheck(pages.walk, using, LATER());
    // The check's stale reading did not land on the marked row.
    expect(memory.rows.get(key)?.dirty).not.toBeNull();
    expect(await memory.store.list()).toEqual([]);
    // The next pass judges the marked page as saved: whole.
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(memory.rows.get(key)?.dirty).toBeNull();
    expect(await memory.store.list()).toEqual([]);
  });

  it("settles a marked document on the next pass, and keeps one whose source could not be read marked", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageBinding("headline") }, () => "v1");
    const document: ReportedDocument = {
      documentKey: keyOf("a"),
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    };
    // The schema is current: only the marked document is judged.
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    await memory.store.markDirty(document);
    const failing: BindingReportDeps = {
      ...deps(memory.store, pages.reading),
      shapesOf: async () => {
        throw new Error("registry unavailable");
      },
    };
    await runFullCheck(pages.walk, failing, LATER());
    expect(memory.rows.get(document.documentKey)?.dirty).not.toBeNull();
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(memory.rows.get(document.documentKey)?.dirty).toBeNull();
    expect((await memory.store.list()).map(row => row.documentKey)).toEqual([
      keyOf("a"),
    ]);
  });

  it("keeps a document whose stored value could not be read marked, with its last rows", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageBinding("headline") }, () => "v1");
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    const key = keyOf("a");
    expect(memory.rows.get(key)?.rows).toHaveLength(1);
    await memory.store.markDirty({
      documentKey: key,
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    });
    const unreadable = {
      ...pages.reading,
      read: async () => {
        throw new Error("database unavailable");
      },
    };
    await runFullCheck(pages.walk, deps(memory.store, unreadable), LATER());
    // Not recorded clean: still marked, and the binding it had still listed.
    expect(memory.rows.get(key)?.dirty).not.toBeNull();
    expect(memory.rows.get(key)?.rows).toHaveLength(1);
  });

  it("reads each marked document once a pass, a document it can't judge included", async () => {
    const memory = memoryStore();
    const pages = site(
      {
        a: pageBinding("headline"),
        b: pageBinding("title"),
        c: pageBinding("title"),
      },
      () => "v1"
    );
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    for (const id of ["a", "b", "c"]) {
      await memory.store.markDirty({
        documentKey: keyOf(id),
        kind: "collection",
        slug: "pages",
        documentId: id,
        place: "pages",
      });
    }
    pages.read.length = 0;
    // "a" stays marked every time it is read; the pass must not loop on it.
    const reading = {
      ...pages.reading,
      read: async (address: HostAddress) => {
        if (address.id === "a") {
          pages.read.push("a");
          throw new Error("database unavailable");
        }
        return pages.reading.read(address);
      },
    };
    await runFullCheck(pages.walk, deps(memory.store, reading), LATER());
    expect([...pages.read].sort()).toEqual(["a", "b", "c"]);
    expect(memory.rows.get(keyOf("a"))?.dirty).not.toBeNull();
    expect(memory.rows.get(keyOf("b"))?.dirty).toBeNull();
  });

  it("drops a document's row once a complete check no longer finds it", async () => {
    const memory = memoryStore();
    await memory.store.record(
      {
        documentKey: keyOf("gone"),
        kind: "collection",
        slug: "pages",
        documentId: "gone",
        place: "pages",
      },
      [
        {
          nodeId: "h",
          blockType: "core/heading",
          prop: "text",
          binding: { source: "entry", path: "headline" },
          codes: ["binding-field-missing"],
          shows: { kind: "nothing" },
        },
      ],
      []
    );
    // Recorded well before the check starts.
    const held = memory.rows.get(keyOf("gone"));
    if (held !== undefined) held.at = new Date(Date.now() - 10_000);
    const pages = site({ a: pageBinding("title") }, () => "v2");
    expect(
      await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER())
    ).toBe("complete");
    expect(await memory.store.list()).toEqual([]);
  });

  it("records where each document binds a Single, named as Layers names its block", async () => {
    const memory = memoryStore();
    const pages = site(
      {
        a: pageShowing("homepage", "headline", "Hero headline"),
        b: pageBinding("title"),
      },
      () => "v1"
    );
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(memory.uses.get(keyOf("a"))).toEqual([
      {
        nodeId: "hero",
        blockType: "core/heading",
        blockName: "Hero headline",
        prop: "text",
        sourceKey: "homepage",
        path: "headline",
        version: "published",
        blocksField: "content",
      },
    ]);
    // A page binding only its entry binds no Single.
    expect(memory.uses.get(keyOf("b"))).toEqual([]);
  });

  it("records a draft's uses beside the published value's, and a draft like it once", async () => {
    const memory = memoryStore();
    const pages = site(
      { a: pageBinding("title"), b: pageShowing("homepage", "headline") },
      () => "v1",
      {
        a: pageShowing("homepage", "tagline"),
        b: pageShowing("homepage", "headline"),
      }
    );
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(
      memory.uses.get(keyOf("a"))?.map(use => [use.version, use.path])
    ).toEqual([["draft", "tagline"]]);
    expect(
      memory.uses.get(keyOf("b"))?.map(use => [use.version, use.path])
    ).toEqual([["published", "headline"]]);
  });

  it("settles a saved document's uses with its row, and drops them once the binding is gone", async () => {
    const memory = memoryStore();
    const contents: Record<string, unknown> = {
      a: pageShowing("homepage", "headline"),
    };
    const pages = site(contents, () => "v1");
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(memory.uses.get(keyOf("a"))).toHaveLength(1);
    // Saved without the binding: the write marks it, the next pass settles.
    contents.a = pageBinding("title");
    await memory.store.markDirty({
      documentKey: keyOf("a"),
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    });
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    expect(memory.uses.get(keyOf("a"))).toEqual([]);
  });

  it("marks the index filled only when a check of every document completes", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageShowing("homepage", "headline") }, () => "v1");
    const using = deps(memory.store, pages.reading);
    expect(await runFullCheck(pages.walk, using, new Date(0))).toBe("paused");
    expect(memory.filled()).toBe(0);
    expect(await runFullCheck(pages.walk, using, LATER())).toBe("complete");
    expect(memory.filled()).toBe(1);
    // Nothing changed: no check, and no second mark.
    expect(await runFullCheck(pages.walk, using, LATER())).toBe("current");
    expect(memory.filled()).toBe(1);
  });

  it("writes a document's uses while its judgement waits on a source, and keeps them while its value can't be read", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageShowing("homepage", "headline") }, () => "v1");
    const document: ReportedDocument = {
      documentKey: keyOf("a"),
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    };
    // The schema is current: only marked documents are judged.
    await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER());
    memory.uses.clear();
    await memory.store.markDirty(document);
    // The Single's fields can't be read: the report waits, the uses don't.
    const failing: BindingReportDeps = {
      ...deps(memory.store, pages.reading),
      shapesOf: async () => {
        throw new Error("registry unavailable");
      },
    };
    await runFullCheck(pages.walk, failing, LATER());
    expect(memory.rows.get(document.documentKey)?.dirty).not.toBeNull();
    expect(
      memory.uses.get(document.documentKey)?.map(use => use.sourceKey)
    ).toEqual(["homepage"]);
    // Its stored value can't be read: what was written stays.
    const unreadable = {
      ...pages.reading,
      read: async () => {
        throw new Error("database unavailable");
      },
    };
    await runFullCheck(pages.walk, deps(memory.store, unreadable), LATER());
    expect(memory.uses.get(document.documentKey)).toHaveLength(1);
  });

  it("writes a deferred document's uses during the check of every document", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageShowing("homepage", "headline") }, () => "v1");
    const failing: BindingReportDeps = {
      ...deps(memory.store, pages.reading),
      shapesOf: async () => {
        throw new Error("registry unavailable");
      },
    };
    expect(await runFullCheck(pages.walk, failing, LATER())).toBe("complete");
    // The report waits, marked; the uses are written, and the index filled.
    expect(memory.rows.get(keyOf("a"))?.dirty).not.toBeNull();
    expect(memory.uses.get(keyOf("a"))).toHaveLength(1);
    expect(memory.filled()).toBe(1);
  });

  it("fills the index only once a document the check couldn't read has been read", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageShowing("homepage", "headline") }, () => "v1");
    const unreadable = {
      ...pages.reading,
      read: async () => {
        throw new Error("database unavailable");
      },
    };
    expect(
      await runFullCheck(pages.walk, deps(memory.store, unreadable), LATER())
    ).toBe("complete");
    expect(memory.filled()).toBe(0);
    expect(memory.check().usesPending).toBe(true);
    // Still unreadable: still not filled.
    await runFullCheck(pages.walk, deps(memory.store, unreadable), LATER());
    expect(memory.filled()).toBe(0);
    // Read whole on a later pass: its uses written, the index filled.
    expect(
      await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER())
    ).toBe("current");
    expect(memory.uses.get(keyOf("a"))).toHaveLength(1);
    expect(memory.filled()).toBe(1);
    expect(memory.check().usesPending).toBe(false);
  });
});
