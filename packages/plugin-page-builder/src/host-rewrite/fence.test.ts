/**
 * The fence as the blocks field applies it: a write adding a reference to a
 * component being deleted is refused, judged against a fresh read of what is
 * stored; a reference the stored form already holds may stay; doubt refuses.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite, PluginStoredValue } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  COMPONENT_BEING_DELETED,
  fenceIssues,
  type FencedComponents,
} from "./fence";

const page = (...componentIds: string[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: componentIds.map((componentId, index) => ({
    id: `i${String(index)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  })),
});

/** A write to `pages/p1` whose stored forms are `stored` (by form). */
function writeOver(
  stored: Partial<Record<"published" | "draft", BlockDocument>>,
  reads: string[] = []
): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored: async (target): Promise<PluginStoredValue> => {
      reads.push(target.form);
      const value = stored[target.form];
      return value === undefined
        ? { kind: "absent" }
        : { kind: "value", value };
    },
  };
}

const fencing =
  (...ids: string[]) =>
  async (): Promise<FencedComponents> => ({ kind: "read", ids: new Set(ids) });

const judge = (
  document: BlockDocument,
  write: PluginFieldWrite,
  fenced: () => Promise<FencedComponents>,
  overrides: { path?: string; nextStatus?: string } = {}
) =>
  fenceIssues({
    document,
    write,
    path: overrides.path ?? "content",
    nextStatus: overrides.nextStatus,
    localized: false,
    maxNodes: 1000,
    fenced,
  });

describe("the fence on every write", () => {
  it("refuses a write adding a reference to a component being deleted", async () => {
    const issues = await judge(
      page("card"),
      writeOver({ draft: page() }),
      fencing("card")
    );

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
    expect(issues[0]?.message).toContain('"card"');
  });

  it("keeps a reference the stored form already holds", async () => {
    const issues = await judge(
      page("card"),
      writeOver({ draft: page("card") }),
      fencing("card")
    );

    expect(issues).toEqual([]);
  });

  it("judges against every form the write changes: a publish must not add one to the live row", async () => {
    const issues = await judge(
      page("card"),
      writeOver({ draft: page("card"), published: page() }),
      fencing("card"),
      { nextStatus: "published" }
    );

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("lets through references to components nobody is deleting, reading nothing stored", async () => {
    const reads: string[] = [];
    const issues = await judge(
      page("other"),
      writeOver({}, reads),
      fencing("card")
    );

    expect(issues).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("reads neither the fence nor the stored form for a write placing no component", async () => {
    let asked = 0;
    const issues = await judge(page(), writeOver({}), async () => {
      asked += 1;
      return { kind: "read", ids: new Set(["card"]) };
    });

    expect(issues).toEqual([]);
    expect(asked).toBe(0);
  });

  it("refuses a create placing a fenced component: nothing is stored to hold it", async () => {
    const create: PluginFieldWrite = { ...writeOver({}), id: undefined };

    const issues = await judge(page("card"), create, fencing("card"));

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("refuses every component a write places when the fence cannot be read", async () => {
    const issues = await judge(
      page("card", "other"),
      writeOver({ draft: page("card") }),
      async () => ({ kind: "unreadable" })
    );

    expect(issues.map(issue => issue.message)).toEqual([
      expect.stringContaining('"other"'),
    ]);
  });

  it("refuses where the stored form cannot be read: a field below the top level", async () => {
    const issues = await judge(
      page("card"),
      writeOver({ draft: page("card") }),
      fencing("card"),
      {
        path: "hero.body",
      }
    );

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("refuses where a stored read fails", async () => {
    const failing: PluginFieldWrite = {
      ...writeOver({}),
      readStored: async () => {
        throw new Error("connection lost");
      },
    };

    const issues = await judge(page("card"), failing, fencing("card"));

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("judges a write naming a public state by any other name against the live row too", async () => {
    // `live` is this site's public state. Read by its spelling, a publish
    // would be judged against the draft alone, which holds the reference.
    const issues = await judge(
      page("card"),
      writeOver({ draft: page("card"), published: page() }),
      fencing("card"),
      { nextStatus: "live" }
    );

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("refuses when neither the fence nor the whole document could be read", async () => {
    // The copy sits past the one node surveyed, so the surveyed prefix places
    // nothing at all.
    const document = page("other", "card");
    document.nodes = [
      { id: "t", type: "core/text", version: 1, props: {} },
      ...document.nodes,
    ];

    const issues = await fenceIssues({
      document,
      write: writeOver({ draft: page() }),
      path: "content",
      nextStatus: undefined,
      localized: false,
      maxNodes: 1,
      fenced: async () => ({ kind: "unreadable" }),
    });

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });

  it("refuses a write inside a transaction that keeps a stored fenced reference", async () => {
    // A bulk write may skip the hooks that re-queue the document, so even a
    // reference already stored may not stay in one.
    const write: PluginFieldWrite = {
      ...writeOver({ draft: page("card") }),
      inTransaction: true,
    };

    const issues = await judge(page("card"), write, fencing("card"));

    expect(issues.map(issue => issue.code)).toEqual([COMPONENT_BEING_DELETED]);
  });
});
