/**
 * Binding a prop and unbinding it, as the inspector and the page actions API
 * both write them.
 */
import {
  applyOps,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { bindOp, unbindOp } from "./binding-ops";

const page = (node: Record<string, unknown>): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "h", type: "core/heading", version: 1, ...node }],
  }) as BlockDocument;

const nodeOf = (document: BlockDocument) =>
  document.nodes[0] as unknown as {
    props: Record<string, unknown>;
    bindings?: Record<string, unknown>;
  };

describe("bindOp", () => {
  it("binds a prop, keeping the block's other bindings", () => {
    const document = page({
      props: { text: "Own" },
      bindings: { level: { $bind: "rank" } },
    });
    const op = bindOp(document, "h", "text", { $bind: "title" });
    const next = applyOps(document, [op!]).document;
    expect(nodeOf(next).bindings).toEqual({
      level: { $bind: "rank" },
      text: { $bind: "title" },
    });
    // The prop's own value stays, as the value shown when the binding can't be.
    expect(nodeOf(next).props.text).toBe("Own");
  });

  it("replaces a binding the prop already had", () => {
    const document = page({
      props: { text: "Own" },
      bindings: { text: { $bind: "title" } },
    });
    const op = bindOp(document, "h", "text", { $bind: "excerpt" });
    expect(nodeOf(applyOps(document, [op!]).document).bindings).toEqual({
      text: { $bind: "excerpt" },
    });
  });

  it("names no block that is not there", () => {
    expect(bindOp(page({ props: {} }), "gone", "text", { $bind: "x" })).toBe(
      null
    );
  });
});

describe("unbindOp", () => {
  it("removes the binding and keeps the value given in the prop", () => {
    const document = page({
      props: { text: "Own" },
      bindings: { text: { $bind: "title" }, level: { $bind: "rank" } },
    });
    const op = unbindOp(document, "h", "text", {
      set: { text: "Spring sale" },
    });
    const node = nodeOf(applyOps(document, [op!]).document);
    expect(node.props.text).toBe("Spring sale");
    expect(node.bindings).toEqual({ level: { $bind: "rank" } });
  });

  it("stores no bindings once the last is gone", () => {
    const document = page({
      props: { text: "Own" },
      bindings: { text: { $bind: "title" } },
    });
    const op = unbindOp(document, "h", "text", { set: { text: "Kept" } });
    const node = nodeOf(applyOps(document, [op!]).document);
    expect(node).not.toHaveProperty("bindings");
    expect(node.props.text).toBe("Kept");
  });

  it("keeps an image's address in its address prop, the media prop emptied", () => {
    const document = page({
      props: { mediaId: "m1", alt: "Cover" },
      bindings: { mediaId: { $bind: "cover" } },
    });
    const op = unbindOp(document, "h", "mediaId", {
      set: { src: "https://cdn.example.com/cover.jpg" },
      empty: ["mediaId"],
    });
    const node = nodeOf(applyOps(document, [op!]).document);
    expect(node.props).toEqual({
      alt: "Cover",
      src: "https://cdn.example.com/cover.jpg",
    });
  });
});
