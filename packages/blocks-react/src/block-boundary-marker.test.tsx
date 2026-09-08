/**
 * What the boundary does with a marker it did not write.
 *
 * `BlockBoundary` is published, so a node reaches it that no pipeline pass
 * touched — an exported document replayed, a tree assembled by a host, content
 * hand-edited in storage. The composition marker is a render-time fact and
 * nothing strips it from stored content, so the string beside it is untrusted
 * input at this boundary even though every string the resolver writes is one of
 * six.
 */
import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlockBoundary } from "./block-boundary";
import type { PageContext } from "./context";
import { createBlockResolver } from "./resolver";

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

const marked = (reason: string) =>
  ({
    id: "n1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "hero" },
    unresolvedComponent: reason,
  }) as never;

describe("an unresolved marker whose reason came from storage", () => {
  it("draws the placeholder for a reason naming a prototype member", () => {
    // Read from a plain object, `__proto__` answers `Object.prototype` and
    // `constructor` answers a function. Either reaches the placeholder as its
    // detail, and React refuses an object for a child — so the one component
    // that exists to contain a failure is where the page dies.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={marked("__proto__")}
        context={context()}
        blocks={createBlockResolver([])}
        classes={{ n1: "nx-node" }}
      />
    );

    expect(html).toContain('data-nx-block-placeholder="unresolved-component"');
  });

  it("draws no explanation for a reason naming an inherited method", () => {
    // `constructor` answers a function rather than an object, so React renders
    // nothing for it instead of failing — and the boundary emits an EMPTY
    // explanation, which tells an author the cause is blank rather than
    // unrecognised.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={marked("constructor")}
        context={context()}
        blocks={createBlockResolver([])}
        classes={{ n1: "nx-node" }}
      />
    );

    expect(html).not.toContain("<div></div>");
  });

  it("CONTROL: still explains a reason the resolver actually writes", () => {
    // Without this the two above pass on a boundary that never shows a detail
    // at all, which costs an author the sentence naming the remedy.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={marked("cycle")}
        context={context()}
        blocks={createBlockResolver([])}
        classes={{ n1: "nx-node" }}
      />
    );

    expect(html).toContain("This component contains itself");
  });
});
