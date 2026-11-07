/**
 * The check of every document for the bindings report: nothing to do while
 * the schema is unchanged, a walk once it changes, resumed where a pass
 * stopped, and rows of documents no longer there dropped once it completes.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { HostDocument } from "../host-rewrite/rewrite";

import type { BindingReportRow } from "./rows";
import { runFullCheck, type BindingReportDeps } from "./scan";
import type { BindingReportStore, FullCheck, ReportedDocument } from "./store";

/** The store, in memory, with each row's time of record. */
function memoryStore() {
  const rows = new Map<
    string,
    { document: ReportedDocument; rows: readonly BindingReportRow[]; at: Date }
  >();
  let check: FullCheck = {
    checked: null,
    checking: null,
    cursor: null,
    startedAt: null,
    at: null,
  };
  const store: BindingReportStore = {
    record: async (document, found) => {
      if (found.length === 0) rows.delete(document.documentKey);
      else
        rows.set(document.documentKey, {
          document,
          rows: found,
          at: new Date(),
        });
    },
    list: async () =>
      [...rows.values()].map(({ document, rows: found, at }) => ({
        ...document,
        rows: found,
        checkedAt: at,
      })),
    fullCheck: async () => check,
    setFullCheck: async state => {
      check = { ...state, at: new Date() };
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

/** A site of pages, each with its content. */
function site(contents: Record<string, unknown>, fingerprint: () => string) {
  const documents = Object.keys(contents).map(
    (id): HostDocument => ({
      key: `collection:pages:${id}`,
      hosts: [
        {
          host: { kind: "collection", slug: "pages", id, path: ["content"] },
          access: "scan",
        },
      ],
    })
  );
  const read: string[] = [];
  return {
    read,
    site: {
      documents: async function* (cursor: string | null) {
        const from =
          cursor === null ? 0 : documents.findIndex(d => d.key === cursor) + 1;
        for (const document of documents.slice(from)) yield document;
      },
      cursorOf: (document: HostDocument) => document.key,
      read: async (host: { id?: string }) => {
        read.push(host.id ?? "");
        return {
          published: { kind: "value" as const, value: contents[host.id ?? ""] },
          draft: null,
          liveState: null,
        };
      },
      fingerprint: async () => fingerprint(),
    },
  };
}

function deps(store: BindingReportStore): BindingReportDeps {
  return {
    store: () => store,
    shapesOf: async ref => ("collection" in ref ? POSTS : undefined),
    limits: () => ({ maxNodes: 2000 }) as never,
    placeOf: () => "pages",
  };
}

const LATER = () => new Date(Date.now() + 60_000);

describe("the check of every document", () => {
  it("walks every document once the schema changes, and then does nothing", async () => {
    const memory = memoryStore();
    const walk = site(
      { a: pageBinding("headline"), b: pageBinding("title") },
      () => "v1"
    );
    expect(await runFullCheck(walk.site, deps(memory.store), LATER())).toBe(
      "complete"
    );
    expect([...memory.rows.keys()]).toEqual(["collection:pages:a"]);
    expect(memory.check()).toMatchObject({ checked: "v1", checking: null });

    walk.read.length = 0;
    expect(await runFullCheck(walk.site, deps(memory.store), LATER())).toBe(
      "current"
    );
    expect(walk.read).toEqual([]);
  });

  it("stops at the deadline and resumes after the last document it judged", async () => {
    const memory = memoryStore();
    const walk = site(
      { a: pageBinding("headline"), b: pageBinding("headline") },
      () => "v1"
    );
    // A deadline already past: the pass stops before judging anything.
    expect(await runFullCheck(walk.site, deps(memory.store), new Date(0))).toBe(
      "paused"
    );
    expect(memory.check()).toMatchObject({ checking: "v1", cursor: null });
    expect(await runFullCheck(walk.site, deps(memory.store), LATER())).toBe(
      "complete"
    );
    expect([...memory.rows.keys()].sort()).toEqual([
      "collection:pages:a",
      "collection:pages:b",
    ]);
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
    const walk = site({ a: pageBinding("title") }, () => "v2");
    expect(await runFullCheck(walk.site, deps(memory.store), LATER())).toBe(
      "complete"
    );
    expect(memory.rows.size).toBe(0);
  });
});
