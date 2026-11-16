/**
 * The report's rows for one document: each broken binding once, with what is
 * wrong and what a visitor sees instead.
 */
import {
  clearBlocks,
  registerBlocks,
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DeclaredShapesReader } from "../fields/binding-judgement";

import { documentBindingReport } from "./rows";

const DECLARED: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "price", type: "text" },
  ],
};

const shapesOf: DeclaredShapesReader = async ref =>
  DECLARED[
    "collection" in ref
      ? `collection:${ref.collection}`
      : `single:${ref.single}`
  ];

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>,
  bindings: Record<string, unknown>
) => ({ id, type, version: 1, props, bindings });

const report = (nodes: unknown[], settings?: unknown) =>
  documentBindingReport(
    { nodes, ...(settings === undefined ? {} : { settings }) },
    { collection: "posts" },
    { shapesOf }
  );

describe("a document's bindings to fix", () => {
  // The core blocks, as the plugin registers them at boot: which props a
  // block has, and what each will take, is read from the block.
  beforeEach(() => {
    registerBlocks([...coreBlocks], { source: "bindings-report-test" });
  });
  afterEach(() => {
    clearBlocks();
  });

  it("lists a missing field with the fallback a visitor sees", async () => {
    const { rows } = await report([
      node(
        "h",
        "core/heading",
        { text: "Own", level: 2 },
        { text: { $bind: "headline", fallback: "Untitled" } }
      ),
      // The control: a binding that fits is not listed.
      node(
        "t",
        "core/heading",
        { text: "Own", level: 2 },
        {
          text: { $bind: "title" },
        }
      ),
    ]);
    expect(rows).toEqual([
      {
        nodeId: "h",
        blockType: "core/heading",
        prop: "text",
        binding: { source: "entry", path: "headline" },
        codes: ["binding-field-missing"],
        shows: { kind: "fallback", value: "Untitled" },
      },
    ]);
  });

  it("names the field a misfit reaches, and shows the block's own value for an invalid fallback", async () => {
    const { rows } = await report([
      node(
        "s",
        "core/heading",
        { text: "Own", level: 2 },
        // A heading's level is a choice; a text field cannot fill it.
        { level: { $bind: "price", fallback: "nine" } }
      ),
    ]);
    expect(rows[0]).toMatchObject({
      prop: "level",
      reaches: { name: "price", type: "text" },
      shows: { kind: "own", value: 2 },
    });
    expect(rows[0]?.codes).toContain("binding-fallback-invalid");
  });

  it("names the site setting a misfit reaches, and its type", async () => {
    const { rows } = await report([
      node(
        "s",
        "core/heading",
        { text: "Own", level: 2 },
        // A heading's level is a choice; the site's address cannot fill it.
        { level: { $bind: "siteUrl", source: "site" } }
      ),
    ]);
    expect(rows[0]).toMatchObject({
      prop: "level",
      binding: { source: "site", path: "siteUrl" },
      reaches: { name: "siteUrl", type: "url" },
    });
  });

  it("shows nothing for a prop the block no longer has", async () => {
    const { rows } = await report([
      node(
        "b",
        "core/heading",
        { text: "Own", level: 2 },
        {
          subtitle: { $bind: "title" },
        }
      ),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        codes: ["binding-prop-missing"],
        shows: { kind: "nothing" },
      }),
    ]);
  });

  it("lists a broken binding in the document's own metadata", async () => {
    const { rows } = await report([], {
      seo: { title: ["Read ", { $bind: "headline" }] },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        nodeId: "",
        blockType: "",
        prop: "seo.title",
        binding: { source: "entry", path: "headline" },
        codes: ["binding-field-missing"],
        // Metadata has no value of its own: with no fallback, nothing shows.
        shows: { kind: "nothing" },
      }),
    ]);
  });
});
