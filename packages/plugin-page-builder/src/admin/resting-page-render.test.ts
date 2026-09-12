/**
 * Which documents make the entry form read this site's component tier.
 *
 * Asserted apart from the render because the interesting case is the one a
 * render cannot reach cheaply: a document past the site's node cap, where the
 * usage walk answers with a PREFIX and "names no component" is exactly what an
 * unread document looks like.
 *
 * @module admin/resting-page-render.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { placesComponents } from "./use-resting-page-render";

const text = (id: string): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
});
const instance = (id: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "header" },
});
const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

describe("placesComponents", () => {
  it("is false for a page of blocks, and for an empty one", () => {
    expect(placesComponents(page([]), DEFAULT_LIMITS.maxNodes)).toBe(false);
    expect(
      placesComponents(page([text("a"), text("b")]), DEFAULT_LIMITS.maxNodes)
    ).toBe(false);
  });

  it("is true for a page that places one, at the root or inside a slot", () => {
    expect(
      placesComponents(page([instance("i1")]), DEFAULT_LIMITS.maxNodes)
    ).toBe(true);
    const nested: BlockNode = {
      ...text("box"),
      type: "core/box",
      slots: { children: [instance("i1")] },
    };
    expect(placesComponents(page([nested]), DEFAULT_LIMITS.maxNodes)).toBe(
      true
    );
  });

  it("is true for a document the cap could not read whole, whatever the prefix held", () => {
    // The fail-open half. Read under a cap the walk cannot finish, a page of
    // instances and a page of blocks both answer "names nothing" — so the
    // read is made and the miniature draws its components, rather than a
    // screen of could-not-be-loaded markers on the largest pages a site has.
    const long = page([text("a"), text("b"), text("c"), instance("i1")]);
    expect(placesComponents(long, 2)).toBe(true);

    const blocksOnly = page([text("a"), text("b"), text("c"), text("d")]);
    expect(placesComponents(blocksOnly, 2)).toBe(true);
    // And the control: read whole, the same blocks-only page needs nothing.
    expect(placesComponents(blocksOnly, DEFAULT_LIMITS.maxNodes)).toBe(false);
  });
});
