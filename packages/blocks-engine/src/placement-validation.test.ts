/**
 * The placement rule as a save judges it: a break a write introduces is an
 * error, and a break the stored page already held is a warning, so a page
 * saved before the rule still saves its other changes.
 *
 * Driven through `validateDocument` with the real registry, as the plugin's
 * validator calls it, rather than through the tracker alone: what matters is
 * the issue a write receives.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContentModel } from "./content-model";
import type { BlockDocument, BlockNode } from "./document";
import { placementBreaksIn, placementRefusal } from "./placement-breaks";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";
import { validateDocument } from "./validation";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "t/box",
        editor: { label: "Box" },
        slots: { children: {} },
        contentModel: (props: { link?: string }): ContentModel =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "t/button",
        editor: { label: "Button" },
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "t/heading", editor: { label: "Heading" } },
    ] as never,
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

const button = (): BlockNode => ({
  id: "btn",
  type: "t/button",
  version: 1,
  props: {},
});
const box = (
  id: string,
  props: Record<string, unknown>,
  children: BlockNode[] = []
) =>
  ({ id, type: "t/box", version: 1, props, slots: { children } }) as BlockNode;

function placementIssues(doc: BlockDocument, stored?: BlockDocument) {
  return validateDocument(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    mode: "strict",
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
    ...(stored === undefined ? {} : { stored: [stored] }),
  }).issues.filter(issue =>
    ["content-model", "undeclared-slot", "holds-no-blocks"].includes(issue.code)
  );
}

describe("a break a write introduces", () => {
  it("is an error, worded as the editor words it", () => {
    const doc = page([box("card", { link: "/go" }, [button()])]);
    expect(placementIssues(doc)).toEqual([
      expect.objectContaining({
        code: "content-model",
        severity: "error",
        path: "/nodes/0/slots/children/0",
        message:
          "A Button can't go inside this Box. Nothing clickable can sit inside a link or a button.",
      }),
    ]);
  });

  it("refuses a child in a slot its parent never declares", () => {
    const doc = page([
      {
        id: "h",
        type: "t/heading",
        version: 1,
        props: {},
        slots: { children: [button()] },
      },
    ]);
    expect(placementIssues(doc)).toEqual([
      expect.objectContaining({
        code: "holds-no-blocks",
        severity: "error",
        message: "Heading can't hold blocks.",
      }),
    ]);
  });
});

describe("a break the stored page already held", () => {
  const stored = page([box("card", { link: "/go" }, [button()])]);

  it("is a warning, so an unrelated save goes through", () => {
    const edited = page([
      box("card", { link: "/go" }, [button()]),
      { id: "new", type: "t/heading", version: 1, props: {} },
    ]);
    expect(placementIssues(edited, stored)).toEqual([
      expect.objectContaining({ code: "content-model", severity: "warning" }),
    ]);
  });

  it("is new again once the block moves under another link", () => {
    const moved = page([
      box("card", { link: "/go" }),
      box("other", { link: "/go" }, [button()]),
    ]);
    expect(placementIssues(moved, stored)).toEqual([
      expect.objectContaining({ code: "content-model", severity: "error" }),
    ]);
  });

  it("is new again once the block is converted in place", () => {
    const converted = page([
      box("card", { link: "/go" }, [
        { ...button(), type: "t/box", props: { link: "/x" } },
      ]),
    ]);
    const nested = page([
      box("card", { link: "/go" }, [box("btn", { link: "/x" })]),
    ]);
    expect(placementIssues(converted, stored)).toEqual([
      expect.objectContaining({ code: "content-model", severity: "error" }),
    ]);
    expect(placementIssues(nested, stored)).toHaveLength(1);
  });

  it("is new again once an ancestor's settings change what it is", () => {
    // Off in the stored page, so nothing was broken; turning it on breaks it.
    const unlinked = page([box("card", {}, [button()])]);
    const linked = page([box("card", { link: "/go" }, [button()])]);
    expect(placementIssues(linked, unlinked)).toEqual([
      expect.objectContaining({ severity: "error" }),
    ]);
  });
});

describe("the break an edit adds", () => {
  const sources = () => ({
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  });

  it("is none for an edit that leaves the stored break where it was", () => {
    const before = page([box("card", { link: "/go" }, [button()])]);
    const after = page([
      box("card", { link: "/go" }, [button()]),
      { id: "h", type: "t/heading", version: 1, props: {} },
    ]);
    expect(placementBreaksIn(after, sources())).toHaveLength(1);
    expect(placementRefusal(before, after, sources())).toBeUndefined();
  });

  it("is the moved Button, located, for a move under a link", () => {
    const before = page([box("card", { link: "/go" }), button()]);
    const after = page([box("card", { link: "/go" }, [button()])]);
    expect(placementRefusal(before, after, sources())).toMatchObject({
      id: "btn",
      parentId: "card",
      slot: "children",
      path: "/nodes/0/slots/children/0",
      verdict: { reason: "content-model" },
    });
  });
});
