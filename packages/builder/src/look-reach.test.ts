// @vitest-environment jsdom

import type { BlockDocument, NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { LOOK_REACH_ATTRIBUTE, lookReach, markLookReach } from "./look-reach";

const primary = {
  id: "look:core/button:primary",
  blockType: "core/button",
  own: true,
};
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: {},
};

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "plain", type: "core/button", version: 1, props: {} },
    {
      id: "outlined",
      type: "core/button",
      version: 1,
      props: {},
      classes: [outline.id],
    },
    {
      id: "box",
      type: "core/section",
      version: 1,
      props: {},
      slots: {
        children: [
          { id: "nested", type: "core/button", version: 1, props: {} },
          { id: "text", type: "core/text", version: 1, props: {} },
        ],
      },
    },
  ],
} as unknown as BlockDocument;

describe("the blocks an edit to a look reaches", () => {
  it("are every block of the type, for its own look, which every other look is laid on", () => {
    expect([...lookReach(page, [outline], primary)].sort()).toEqual([
      "nested",
      "outlined",
      "plain",
    ]);
  });

  it("are every block wearing it, for any other look", () => {
    expect([
      ...lookReach(page, [outline], {
        id: outline.id,
        blockType: "core/button",
        own: false,
      }),
    ]).toEqual(["outlined"]);
  });
});

describe("a block listing two looks of its type", () => {
  it("is reached by an edit to either, since both are applied", () => {
    const text: NamedClass = {
      ...outline,
      id: "look:core/button:text",
      slug: "button-text",
      orderIndex: 2,
    };
    const stacked = {
      ...page,
      nodes: [
        {
          id: "both",
          type: "core/button",
          version: 1,
          props: {},
          classes: [outline.id, text.id],
        },
      ],
    } as unknown as BlockDocument;
    const reach = (id: string) => [
      ...lookReach(stacked, [outline, text], {
        id,
        blockType: "core/button",
        own: false,
      }),
    ];
    expect(reach(outline.id)).toEqual(["both"]);
    expect(reach(text.id)).toEqual(["both"]);
  });
});

describe("marking them on the canvas", () => {
  it("marks exactly the blocks named, and clears the marks after", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-nx-node="plain"></div><div data-nx-node="outlined"></div>';
    markLookReach(root, new Set(["plain"]));
    const marked = () =>
      [...root.querySelectorAll(`[${LOOK_REACH_ATTRIBUTE}]`)].map(element =>
        element.getAttribute("data-nx-node")
      );
    expect(marked()).toEqual(["plain"]);
    markLookReach(root, new Set(["outlined"]));
    expect(marked()).toEqual(["outlined"]);
    markLookReach(root, null);
    expect(marked()).toEqual([]);
  });
});
