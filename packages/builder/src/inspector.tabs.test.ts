/**
 * Which of the block panel's tabs a block has, and which of its settings
 * each tab draws: read from the inspection, so the panel and these tests ask
 * one question.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  advancedRowsOf,
  contentRowsOf,
  inspectorTabsOf,
  inspectSelection,
  type BlockInspection,
} from "./inspector";

afterEach(() => clearBlocks());

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** Register a block, and inspect one of it holding `values`. */
function inspect(
  props: Record<string, unknown> | undefined,
  {
    editor = {},
    values = {},
    name = "acme/block",
  }: {
    editor?: Record<string, unknown>;
    values?: Record<string, unknown>;
    name?: string;
  } = {}
): BlockInspection {
  registerBlocks(
    [
      {
        ...base,
        name,
        editor: { label: "Block", ...editor },
        ...(props === undefined ? {} : { props }),
      },
    ] as never,
    { source: "tabs-test" }
  );
  const inspection = inspectSelection(
    {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: name,
          version: 1,
          props: values,
        } as BlockNode,
      ],
    },
    "a"
  );
  if (inspection === null) throw new Error("the block is not inspectable");
  return inspection;
}

const names = (rows: readonly { name: string }[]): string[] =>
  rows.map(row => row.name);

describe("the tabs a block has", () => {
  it("are Content, Style and Advanced, in that order, for a block that says something", () => {
    expect(inspectorTabsOf(inspect({ label: { type: "text" } }))).toEqual([
      "content",
      "style",
      "advanced",
    ]);
  });

  it("leave out Content for a block that declares no settings", () => {
    expect(inspectorTabsOf(inspect(undefined))).toEqual(["style", "advanced"]);
  });

  it("leave out Content when every setting is placed in Advanced or Style", () => {
    expect(
      inspectorTabsOf(
        inspect({
          tag: { type: "select", group: "advanced", options: [] },
          contained: { type: "checkbox", group: "style", section: "layout" },
        })
      )
    ).toEqual(["style", "advanced"]);
  });

  it("keep Content for a block whose own inspector draws it, with no settings declared", () => {
    expect(
      inspectorTabsOf(
        inspect(undefined, { editor: { component: "acme/inspector" } })
      )
    ).toEqual(["content", "style", "advanced"]);
  });

  it("keep Content for a Columns row, whose layout the builder draws there, with every setting elsewhere", () => {
    expect(
      inspectorTabsOf(
        inspect(
          { as: { type: "select", group: "advanced", options: ["div"] } },
          { name: "core/columns" }
        )
      )
    ).toEqual(["content", "style", "advanced"]);
  });

  it("keep Content while a condition hides its only setting, so the tab list does not move", () => {
    // `onlyWithout` hides the address while an entry is set: the setting is
    // still the block's, and the tabs follow what the block is, not its
    // values.
    const inspection = inspect(
      {
        entry: { type: "text", group: "advanced" },
        href: { type: "url", onlyWithout: "entry" },
      },
      { values: { entry: "e1" } }
    );
    // The control: the address really is hidden right now.
    expect(inspection.props.find(prop => prop.name === "href")?.offered).toBe(
      false
    );
    expect(inspectorTabsOf(inspection)).toEqual([
      "content",
      "style",
      "advanced",
    ]);
  });
});

describe("the settings each tab draws", () => {
  it("draws Advanced's own settings in Advanced and Content's in Content, each in declaration order", () => {
    const inspection = inspect({
      title: { type: "text" },
      tag: { type: "select", group: "advanced", options: [] },
      link: { type: "url", section: "Link" },
      lazy: { type: "checkbox", group: "advanced", section: "Behaviour" },
    });
    expect(names(contentRowsOf(inspection))).toEqual(["title", "link"]);
    expect(names(advancedRowsOf(inspection))).toEqual(["tag", "lazy"]);
  });

  it("draws a setting placed in Style in neither", () => {
    // The Style tab draws a block's own Style settings beside its styles.
    const inspection = inspect({
      title: { type: "text" },
      contained: { type: "checkbox", group: "style", section: "layout" },
    });
    expect(names(contentRowsOf(inspection))).toEqual(["title"]);
    expect(names(advancedRowsOf(inspection))).toEqual([]);
  });
});
