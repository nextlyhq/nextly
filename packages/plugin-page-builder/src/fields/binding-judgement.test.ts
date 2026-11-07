/**
 * A blocks write judged for what its bindings read, as the server judges it:
 * against each source's declared fields, reading only the sources it binds,
 * and keeping a break the stored page already held.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  newBindingIssues,
  type DeclaredShapesReader,
} from "./binding-judgement";

/** As declared: `internalNote` is private but declared, so it may be bound. */
const DECLARED: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "internalNote", type: "text" },
    { name: "author", type: "relationship", relationTo: "users" },
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
    expect(read.mock.calls.map(([ref]) => ref)).toEqual([
      { collection: "posts" },
      { collection: "users" },
      { single: "footer" },
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
});
