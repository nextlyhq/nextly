/**
 * The selected block's settings as index entries: what each tab draws, and
 * what counts as set.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectSelection } from "./inspector";
import { contentEntries } from "./settings-entries";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => clearBlocks());

function pageWith(node: Partial<BlockNode> & { type: string }): BlockDocument {
  const block = coreBlocks.find(each => each.name === node.type);
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "a", version: block?.version ?? 1, props: {}, ...node }],
  } as BlockDocument;
}

function entriesOf(document: BlockDocument) {
  const inspection = inspectSelection(document, "a");
  if (inspection === null) throw new Error("nothing inspected");
  return contentEntries(inspection, findNode(document.nodes, "a"));
}

describe("a Columns row's Content", () => {
  it("indexes the builder's Layout and Stack on, set as the row stores them", () => {
    const entries = entriesOf(
      pageWith({
        type: "core/columns",
        props: { as: "div" },
        styles: { base: { base: { gridTemplateColumns: "1fr 2fr" } } },
        slots: { children: [] },
      })
    );
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    expect(byId.get("columnsLayout")).toMatchObject({
      tab: "content",
      label: "Layout",
      set: true,
    });
    expect(byId.get("columnsLayout")?.options).toContain("Wide left");
    // A site with no tablet or mobile tier draws no Stack on.
    expect(byId.has("stackOn")).toBe(false);
  });

  it("indexes Stack on where the site has a tier to stack at", () => {
    const document = pageWith({
      type: "core/columns",
      props: { as: "div" },
      slots: { children: [] },
    });
    const inspection = inspectSelection(document, "a")!;
    const entries = contentEntries(inspection, findNode(document.nodes, "a"), {
      viewport: [{ id: "md", label: "Tablet", maxWidth: 1024 }],
      container: [],
    } as never);
    expect(entries.find(entry => entry.id === "stackOn")).toMatchObject({
      set: false,
    });
  });
});

describe("a setting bound to data", () => {
  it("counts as set, with no value of its own", () => {
    const entries = entriesOf(
      pageWith({
        type: "core/button",
        props: { type: "button" },
        bindings: { label: { kind: "field", field: "title" } },
      } as never)
    );
    expect(entries.find(entry => entry.id === "label")).toMatchObject({
      set: true,
    });
  });
});

describe("Inside its parent's Width and Height under Only changed", () => {
  it("are set by what each axis writes, a width in Size included", async () => {
    const { styleEntries } = await import("./settings-entries");
    const { inspectStyle } = await import("./style-inspector");
    const document = pageWith({
      type: "core/button",
      props: { type: "button" },
      styles: { base: { base: { width: "200px", order: "2" } } },
    } as never);
    const inspection = inspectSelection(document, "a");
    const style = inspectStyle(document, "a");
    const entries = styleEntries(
      style?.sections ?? [],
      inspection,
      undefined,
      "row"
    );
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    expect(byId.get("child:width")?.set).toBe(true);
    // An order says nothing of the height.
    expect(byId.get("child:height")?.set).toBe(false);
  });
});
