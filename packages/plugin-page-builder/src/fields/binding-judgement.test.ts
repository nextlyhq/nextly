/**
 * A blocks write judged for what its bindings read, as the server judges it:
 * against each source's declared fields, reading only the sources it binds,
 * and keeping a break the stored page already held.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  composedBindingIssues,
  newBindingIssues,
  type DeclaredShapesReader,
} from "./binding-judgement";

/** As declared: `internalNote` is private but declared, so it may be bound. */
const DECLARED: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "internalNote", type: "text" },
    { name: "author", type: "relationship", relationTo: "users" },
    // Into a built-in collection, whose fields the registry does not hold.
    { name: "photo", type: "upload", relationTo: "media" },
    {
      name: "meta",
      type: "group",
      fields: [{ name: "editor", type: "relationship", relationTo: "users" }],
    },
  ],
  "collection:users": [{ name: "name", type: "text" }],
  "single:footer": [{ name: "tagline", type: "text" }],
};

const shapesOf: DeclaredShapesReader = async ref =>
  DECLARED[
    "collection" in ref
      ? `collection:${ref.collection}`
      : `single:${ref.single}`
  ];

function args(write: Partial<PluginFieldWrite> = {}): PluginFieldValidateArgs {
  return {
    data: {},
    req: {},
    path: "content",
    field: { name: "content", type: "blocks" },
    write: {
      kind: "collection",
      slug: "posts",
      inTransaction: false,
      readStored: async () => ({ kind: "absent" }),
      ...write,
    },
  } as unknown as PluginFieldValidateArgs;
}

const heading = (id: string, binding: Record<string, unknown>) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: "Own text", level: "h2" },
  bindings: { text: binding },
});

const page = (...nodes: unknown[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

describe("a write's bindings judged against the declared schema", () => {
  it("refuses a binding to a field the source does not declare", async () => {
    const issues = await newBindingIssues(
      page(
        heading("missing", { $bind: "headline" }),
        // Declared but private: binding it is allowed (it shows its fallback).
        heading("private", { $bind: "internalNote" }),
        heading("relation", { $bind: "author.name" })
      ),
      args(),
      "Content",
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: "content",
      code: "binding-field-missing",
    });
    expect(issues[0]?.message).toContain("/nodes/0/bindings/text");
  });

  it("reads only the sources the write binds, each once", async () => {
    const read = vi.fn(shapesOf);
    await newBindingIssues(
      page(
        heading("a", { $bind: "author.name" }),
        heading("b", {
          $bind: "tagline",
          source: "single",
          sourceKey: "footer",
        })
      ),
      args(),
      "Content",
      { shapesOf: read }
    );
    // The entry and the Single first, then where the relation leads.
    expect(read.mock.calls.map(([ref]) => ref)).toEqual([
      { collection: "posts" },
      { single: "footer" },
      { collection: "users" },
    ]);
  });

  it("reads where a relation inside a group leads, and judges the field there", async () => {
    const issues = await newBindingIssues(
      page(
        heading("missing", { $bind: "meta.editor.nickname" }),
        heading("found", { $bind: "meta.editor.name" })
      ),
      args(),
      "Content",
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    expect(issues.map(issue => issue.message)).toEqual([
      expect.stringContaining("/nodes/0/bindings/text"),
    ]);
  });

  it("refuses a metadata binding to a field the source does not declare", async () => {
    const issues = await newBindingIssues(
      {
        ...page(),
        settings: { seo: { title: [{ $bind: "headline" }] } },
      },
      args(),
      "Content",
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "binding-field-missing",
        message: expect.stringContaining("/settings/seo/title/0"),
      }),
    ]);
  });

  it("judges the stored forms against the same read of the schema", async () => {
    // A read that fails after the first: had the stored forms' judgement read
    // again, the related collection would be unknown and the break pass.
    let reads = 0;
    const once: DeclaredShapesReader = async ref => {
      reads += 1;
      if (reads > 2) throw new Error("registry unavailable");
      return shapesOf(ref);
    };
    const issues = await newBindingIssues(
      page(heading("h", { $bind: "author.nickname" })),
      args(),
      "Content",
      {
        shapesOf: once,
        storedForms: async () => ({
          readable: true,
          forms: [page(heading("h", { $bind: "title" })) as never],
        }),
      }
    );
    expect(issues.map(issue => issue.code)).toEqual(["binding-field-missing"]);
    expect(reads).toBe(2);
  });

  it("reads no source for a block past the document's node cap", async () => {
    const read = vi.fn(shapesOf);
    await newBindingIssues(
      page(
        heading("a", { $bind: "title" }),
        heading("b", {
          $bind: "tagline",
          source: "single",
          sourceKey: "footer",
        })
      ),
      args(),
      "Content",
      { shapesOf: read, maxNodes: 1 }
    );
    expect(read.mock.calls.map(([ref]) => ref)).toEqual([
      { collection: "posts" },
    ]);
  });

  it("keeps a break the stored page already held, so the page still saves", async () => {
    // `headline` was renamed after this page was saved.
    const value = page(heading("h", { $bind: "headline" }));
    const issues = await newBindingIssues(value, args(), "Content", {
      shapesOf,
      storedForms: async () => ({ readable: true, forms: [value as never] }),
    });
    expect(issues).toEqual([]);
  });

  it("judges no entry binding in a component's own document", async () => {
    // A placed component reads the entry of each page placing it.
    const issues = await newBindingIssues(
      { ...page(heading("h", { $bind: "headline" })), kind: "component" },
      args(),
      "Content",
      { shapesOf }
    );
    expect(issues).toEqual([]);
  });

  it("refuses nothing when the stored page cannot be read", async () => {
    const kept = vi.fn();
    const issues = await newBindingIssues(
      page(heading("h", { $bind: "headline" })),
      args(),
      "Content",
      {
        shapesOf,
        storedForms: async () => ({ readable: false, forms: [] }),
        onUnjudged: kept,
      }
    );
    expect(issues).toEqual([]);
    expect(kept).toHaveBeenCalledWith(1);
  });

  it("refuses a binding to a Single that does not exist", async () => {
    const issues = await newBindingIssues(
      page(
        heading("h", { $bind: "tagline", source: "single", sourceKey: "gone" })
      ),
      args(),
      "Content",
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    expect(issues.map(issue => issue.code)).toEqual(["binding-field-missing"]);
  });

  it("judges nothing in a write made inside a transaction", async () => {
    // Its schema would be read on another connection, which can wait behind
    // the one the transaction holds.
    const read = vi.fn(shapesOf);
    const issues = await newBindingIssues(
      page(heading("h", { $bind: "headline" })),
      args({ inTransaction: true }),
      "Content",
      { shapesOf: read }
    );
    expect(issues).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a document binding more sources than one save reads", async () => {
    const many = Array.from({ length: 33 }, (_unused, index) =>
      heading(`h${String(index)}`, {
        $bind: "tagline",
        source: "single",
        sourceKey: `s${String(index)}`,
      })
    );
    const issues = await newBindingIssues(page(...many), args(), "Content", {
      shapesOf,
    });
    expect(issues.map(issue => issue.code)).toEqual([
      "binding-sources-over-limit",
    ]);
  });

  it("lets a path into a built-in collection through, its fields kept apart", async () => {
    const issues = await newBindingIssues(
      page(heading("h", { $bind: "photo.url" })),
      args(),
      "Content",
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    expect(issues).toEqual([]);
  });
});

describe("the bindings a page's placed components bring", () => {
  // As the page composes: the placed component's heading, marked with the
  // placement it came through.
  const composed = (path: string) =>
    page(heading("own", { $bind: "headline" }), {
      ...heading("placed", { $bind: path }),
      instanceOf: "i1",
    });
  const host = page({
    id: "i1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card" },
  }) as never;

  it("judges them against the page's entry, naming the component", async () => {
    const issues = await composedBindingIssues(
      composed("headline"),
      host,
      args().write!,
      { shapesOf, storedForms: async () => ({ readable: true, forms: [] }) }
    );
    // The page's own heading is the page's own check's.
    expect(issues).toEqual([
      {
        code: "binding-field-missing",
        message: expect.stringContaining('Component "card"'),
      },
    ]);
    expect(
      await composedBindingIssues(composed("title"), host, args().write!, {
        shapesOf,
      })
    ).toEqual([]);
  });
});
