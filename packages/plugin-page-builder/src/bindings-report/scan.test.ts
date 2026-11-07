/**
 * The check of every document for the bindings report: nothing to do while
 * the schema is unchanged, a walk once it changes, resumed where a pass
 * stopped, never writing over a save judged after it read the document, and
 * rows of documents no longer there dropped once it completes.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { HostAddress } from "../host-rewrite/contract";
import type { HostDocument } from "../host-rewrite/rewrite";

import type { BindingReportRow } from "./rows";
import { runFullCheck, type BindingReportDeps } from "./scan";
import type { BindingReportStore, FullCheck, ReportedDocument } from "./store";

/** The store, in memory, with each row's time of record and the store's fence. */
function memoryStore() {
  const rows = new Map<
    string,
    { document: ReportedDocument; rows: readonly BindingReportRow[]; at: Date }
  >();
  let check: FullCheck = {
    checked: null,
    completedAt: null,
    checking: null,
    cursor: null,
    startedAt: null,
  };
  const store: BindingReportStore = {
    record: async (document, found, readAt) => {
      const held = rows.get(document.documentKey);
      // Fenced as the table is: a row judged since the read is kept.
      if (
        readAt !== undefined &&
        held !== undefined &&
        held.at.getTime() >= readAt.getTime() - 1000
      ) {
        return;
      }
      rows.set(document.documentKey, { document, rows: found, at: new Date() });
    },
    list: async () =>
      [...rows.values()]
        .filter(row => row.rows.length > 0)
        .map(({ document, rows: found, at }) => ({
          ...document,
          rows: found,
          checkedAt: at,
        })),
    get: async () => undefined,
    fullCheck: async () => check,
    setFullCheck: async state => {
      check = state;
    },
    dropCheckedBefore: async at => {
      for (const [key, row] of rows) {
        if (row.at.getTime() < at.getTime() - 1000) rows.delete(key);
      }
    },
  };
  return { store, rows, check: () => check };
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

/** A site of pages, each with its content, and the documents it read. */
function site(contents: Record<string, unknown>, fingerprint: () => string) {
  const host = (id: string): HostAddress => ({
    kind: "collection",
    slug: "pages",
    id,
    path: ["content"],
  });
  const documents = Object.keys(contents).map(
    (id): HostDocument => ({
      key: `collection:pages:${id}`,
      hosts: [{ host: host(id), access: "scan" }],
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
        { host: host(at.id ?? ""), access: "scan" as const },
      ],
      read: async (address: HostAddress) => {
        read.push(address.id ?? "");
        return {
          published: {
            kind: "value" as const,
            value: contents[address.id ?? ""],
          },
          draft: null,
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
      "collection:pages:a",
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
    ).toEqual(["collection:pages:a", "collection:pages:b"]);
  });

  it("keeps a save judged after the check read the document", async () => {
    const memory = memoryStore();
    const pages = site({ a: pageBinding("headline") }, () => "v1");
    // A save judged the page whole while the check was reading it.
    const saved: ReportedDocument = {
      documentKey: "collection:pages:a",
      kind: "collection",
      slug: "pages",
      documentId: "a",
      place: "pages",
    };
    const reading = {
      ...pages.reading,
      read: async (address: HostAddress) => {
        const answer = await pages.reading.read(address);
        await memory.store.record(saved, []);
        return answer;
      },
    };
    expect(
      await runFullCheck(pages.walk, deps(memory.store, reading), LATER())
    ).toBe("complete");
    expect(await memory.store.list()).toEqual([]);
  });

  it("drops a document's row once a complete check no longer finds it", async () => {
    const memory = memoryStore();
    await memory.store.record(
      {
        documentKey: "collection:pages:gone",
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
      ]
    );
    // Recorded well before the check starts.
    const held = memory.rows.get("collection:pages:gone");
    if (held !== undefined) held.at = new Date(Date.now() - 10_000);
    const pages = site({ a: pageBinding("title") }, () => "v2");
    expect(
      await runFullCheck(pages.walk, deps(memory.store, pages.reading), LATER())
    ).toBe("complete");
    expect(await memory.store.list()).toEqual([]);
  });
});
