import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../core/registry";
import {
  documentNodeClasses,
  documentKey,
  nodeClass,
  refNodeClass,
} from "../core/style-compiler";
import { makeNode } from "../core/tree";

import { RenderNode } from "./RenderNode";
import "./blocks";

describe("RenderNode node classes", () => {
  it("names a node from the threaded map, at depth", () => {
    // Absent a collision the map agrees with `nodeClass`, so a test comparing
    // the two passes whether or not the renderer ever reads it. A map holding a
    // name the digest would never produce is what tells them apart — and it has
    // to reach a nested node, because the map is threaded through recursion
    // rather than read from context.
    const heading = makeNode("core/heading", { text: "Hi", level: "h2" });
    const container = makeNode("core/container", {}, undefined, {
      default: [heading],
    });
    const html = renderToStaticMarkup(
      <RenderNode
        node={container}
        registry={defaultBlockRegistry}
        classes={
          new Map([
            [documentKey(container.id), "nx-pb-outer-from-map"],
            [documentKey(heading.id), "nx-pb-inner-from-map"],
          ])
        }
      />
    );
    expect(html).toContain("nx-pb-outer-from-map");
    expect(html).toContain("nx-pb-inner-from-map");
  });

  it("names a referenced node apart from a document node sharing its id", () => {
    // A block made reusable from a node that stayed put is the ordinary way to make one, so a
    // library subtree very often holds an id the document also holds. Naming both from the id
    // alone gave them the SAME class — and the referenced node silently wore the document node's
    // styles. Withholding the map did not fix that: for an id with no hash collision the plain
    // class and the map's entry are the same string.
    const shared = "pb-shared-id";
    const target = {
      ...makeNode("core/heading", { text: "Reused", level: "h2" }),
      id: shared,
    };
    const twin = {
      ...makeNode("core/heading", { text: "Original", level: "h2" }),
      id: shared,
    };
    const refNode = makeNode("core/ref", { refId: "r1" });
    const root = makeNode("core/container", {}, undefined, {
      default: [twin, refNode],
    });
    const refs = { r1: target };
    const html = renderToStaticMarkup(
      <RenderNode
        node={root}
        registry={defaultBlockRegistry}
        refs={refs}
        classes={documentNodeClasses({ root } as never, refs)}
      />
    );
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, "");

    // Positive control: the document's own node of that id IS named, so a fixture that reached
    // nothing could not satisfy the assertion below.
    expect(markup).toContain(nodeClass(shared));
    // The referenced node is named from its ref, not from the bare id.
    expect(markup).toContain(refNodeClass("r1", shared));
    // And the two names differ, which is the whole point.
    expect(refNodeClass("r1", shared)).not.toBe(nodeClass(shared));
  });

  it("falls back to the plain class for a node the map does not hold", () => {
    // A subtree reached through `core/ref` is not in the document walk, so it
    // is not in the map either. It still has to render with a class.
    const heading = makeNode("core/heading", { text: "Hi", level: "h2" });
    const html = renderToStaticMarkup(
      <RenderNode
        node={heading}
        registry={defaultBlockRegistry}
        classes={new Map()}
      />
    );
    expect(html).toContain(nodeClass(heading.id));
  });
});

describe("RenderNode bindings", () => {
  it("resolves a bound prop from the threaded loop item at depth", () => {
    const heading = makeNode("core/heading", { text: "fallback", level: "h2" });
    heading.bindings = { text: { source: "field", path: "title" } };
    const container = makeNode("core/container", {}, undefined, {
      default: [heading],
    });
    const html = renderToStaticMarkup(
      <RenderNode
        node={container}
        registry={defaultBlockRegistry}
        item={{ title: "From Item" }}
      />
    );
    expect(html).toContain("From Item");
    expect(html).not.toContain("fallback");
  });

  it("uses literal props when no item is threaded", () => {
    const heading = makeNode("core/heading", { text: "Static", level: "h2" });
    heading.bindings = { text: { source: "field", path: "title" } };
    const html = renderToStaticMarkup(
      <RenderNode node={heading} registry={defaultBlockRegistry} />
    );
    expect(html).toContain("Static");
  });
});
