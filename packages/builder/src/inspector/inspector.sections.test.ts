/**
 * The inspection groups a block's settings by the tab and section each is
 * edited in, as the block declares them, with Content and a section named
 * after the block as the defaults.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  STYLE_SECTION_KEYS,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { inspectSelection } from "./inspector";
import { INSPECTOR_SECTIONS } from "./inspector-sections";

afterEach(() => clearBlocks());

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** Register a card declaring `props`, and inspect one of it. */
function inspectCard(props: Record<string, unknown>) {
  registerBlocks(
    [{ ...base, name: "acme/card", editor: { label: "Card" }, props }] as never,
    { source: "sections-test" }
  );
  return inspectSelection(
    {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/card", version: 1, props: {} } as BlockNode,
      ],
    },
    "a"
  );
}

/** Each tab's sections, as their labels and the names of their rows. */
function shapeOf(inspection: ReturnType<typeof inspectCard>) {
  const shape = (
    sections: readonly {
      label: string;
      key?: string;
      rows: readonly { name: string }[];
    }[]
  ) =>
    sections.map(section => ({
      label: section.label,
      ...(section.key === undefined ? {} : { key: section.key }),
      rows: section.rows.map(row => row.name),
    }));
  return {
    content: shape(inspection?.sections.content ?? []),
    advanced: shape(inspection?.sections.advanced ?? []),
    styleProps: shape(inspection?.sections.styleProps ?? []),
  };
}

describe("a block's settings by tab and section", () => {
  it("puts every setting in one Content section named after the block by default", () => {
    expect(
      shapeOf(inspectCard({ title: { type: "text" }, tag: { type: "select" } }))
    ).toEqual({
      content: [{ label: "Card", rows: ["title", "tag"] }],
      advanced: [],
      styleProps: [],
    });
  });

  it("puts a setting declared in Content in its own section", () => {
    expect(
      shapeOf(
        inspectCard({
          title: { type: "text" },
          link: { type: "url", section: "Link" },
          newTab: { type: "checkbox", group: "content", section: "Link" },
        })
      ).content
    ).toEqual([
      { label: "Card", rows: ["title"] },
      { label: "Link", rows: ["link", "newTab"] },
    ]);
  });

  it("puts a setting declared in Advanced in HTML, or its own section", () => {
    expect(
      shapeOf(
        inspectCard({
          tag: { type: "select", group: "advanced" },
          lazy: { type: "checkbox", group: "advanced", section: "Behaviour" },
        })
      )
    ).toEqual({
      content: [],
      advanced: [
        { label: "HTML", rows: ["tag"] },
        { label: "Behaviour", rows: ["lazy"] },
      ],
      styleProps: [],
    });
  });

  it("puts a setting declared in Style in the Style section it names", () => {
    expect(
      shapeOf(
        inspectCard({
          contained: { type: "checkbox", group: "style", section: "layout" },
          width: { type: "select", group: "style", section: "size" },
        })
      ).styleProps
    ).toEqual([
      { label: "Layout", key: "layout", rows: ["contained"] },
      { label: "Size", key: "size", rows: ["width"] },
    ]);
  });

  it("keeps every setting in the flat list, in declaration order", () => {
    const inspection = inspectCard({
      a: { type: "text" },
      b: { type: "checkbox", group: "advanced" },
      c: { type: "checkbox", group: "style", section: "layout" },
    });
    expect(inspection?.props.map(prop => prop.name)).toEqual(["a", "b", "c"]);
  });
});

describe("the Style sections a style setting names", () => {
  it("are the Style tab's own sections", () => {
    // The engine refuses a style setting naming anything else, so every one
    // it accepts is a section here. The Style tab's other three hold the
    // block's style tiles, how it sits in its parent, and other CSS
    // properties, which no setting of a block's own is drawn in.
    const keys = INSPECTOR_SECTIONS.map(section => section.key);
    for (const key of STYLE_SECTION_KEYS) expect(keys).toContain(key);
    expect(
      keys.filter(key => !STYLE_SECTION_KEYS.some(each => each === key))
    ).toEqual(["block-style", "inside-parent", "css-properties"]);
  });
});
