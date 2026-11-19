/**
 * A block's custom CSS as the panel reads it, without a DOM: the one answer
 * to whether a block holds some, the op that stores it, where the settings
 * index places it in Advanced (last), and what "Find a setting" and "Only
 * changed" make of it, for a person given the access and one without.
 *
 * @module custom-css.test
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { customCssOp, holdsCustomCss } from "./custom-css";
import { inspectSelection } from "./inspector";
import { layersOf } from "../panels/layers/layers";
import { advancedEntries } from "./settings-entries";
import { filterEntries, type SettingEntry } from "./settings-index";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => clearBlocks());

/** A page with one Button, holding `css` when given. */
function pageWith(css?: string): BlockDocument {
  const block = coreBlocks.find(each => each.name === "core/button");
  if (block === undefined) throw new Error("core/button is not a core block");
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "button",
        type: "core/button",
        version: block.version,
        props: { label: "Get a quote" },
        ...(css === undefined ? {} : { customCss: css }),
      } as BlockNode,
    ],
  } as BlockDocument;
}

/** The Button's Advanced entries, for a person with the access or without. */
function entriesOf(css: string | undefined, access: boolean): SettingEntry[] {
  const page = pageWith(css);
  const inspection = inspectSelection(page, "button");
  if (inspection === null) throw new Error("the Button was not inspected");
  return advancedEntries(inspection, page.nodes[0], access);
}

const found = (entries: SettingEntry[], query: string): string[] =>
  filterEntries(entries, { query, onlyChanged: false }).map(each => each.id);

describe("holdsCustomCss", () => {
  it("is yes only for stored text with more than white space", () => {
    expect(holdsCustomCss({ customCss: "selector { padding: 1px; }" })).toBe(
      true
    );
    expect(holdsCustomCss({ customCss: " \n " })).toBe(false);
    expect(holdsCustomCss({})).toBe(false);
    expect(holdsCustomCss(undefined)).toBe(false);
  });

  it("is the answer the inspection and the Layers row read", () => {
    const css = "selector { padding: 1px; }";
    expect(inspectSelection(pageWith(css), "button")?.hasCustomCss).toBe(true);
    expect(inspectSelection(pageWith(" "), "button")?.hasCustomCss).toBe(false);
    expect(layersOf(pageWith(css))[0]?.customCss).toBe(true);
    expect(layersOf(pageWith())[0]?.customCss).toBeUndefined();
  });
});

describe("customCssOp", () => {
  it("stores the text as written, or removes it once emptied", () => {
    expect(customCssOp("a", "selector { padding: 1px; }")).toEqual({
      kind: "update",
      id: "a",
      patch: { customCss: "selector { padding: 1px; }" },
    });
    expect(customCssOp("a", "  ")).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["customCss"],
    });
  });
});

describe("the settings index", () => {
  it("places Advanced's sections in order: Visibility, HTML, Custom CSS last", () => {
    const sections = [
      ...new Set(entriesOf(undefined, true).map(each => each.section)),
    ];
    expect(sections).toEqual(["visibility", "html", "custom-css"]);
  });

  it.each(["Custom CSS", "CSS", "code", "custom css"])(
    "finds Custom CSS by %j for a person given the access",
    query => {
      expect(found(entriesOf(undefined, true), query)).toContain("customCss");
    }
  );

  it.each(["Custom CSS", "CSS", "code"])(
    "has no Custom CSS to find by %j for a person without it",
    query => {
      expect(found(entriesOf(undefined, false), query)).not.toContain(
        "customCss"
      );
    }
  );

  it("counts a block's custom CSS under Only changed", () => {
    const changed = (css: string | undefined) =>
      filterEntries(entriesOf(css, true), { query: "", onlyChanged: true }).map(
        each => each.id
      );
    expect(changed("selector { padding: 1px; }")).toContain("customCss");
    expect(changed(undefined)).not.toContain("customCss");
  });
});
