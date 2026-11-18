// @vitest-environment jsdom

/**
 * An Accordion's settings and its Questions' in the block panel: Open, First
 * open and Titles as in Behaviour, Icon in Content (Icon position stays in
 * Style), a Question named as one, and its "Open by default" offered only
 * while the Accordion opens many.
 *
 * @module accordion-question-settings.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccordionIconField } from "./accordion-icon-field";
import { accordionIconOf, planAccordionIcon } from "./accordion-icon";
import type { EditorState } from "./editor-state";
import { builderContentSectionsOf, inspectSelection } from "./inspector";
import { inspectStyle } from "./style-inspector";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A page of one accordion holding one question. */
function page(
  accordionProps: Record<string, unknown>,
  styles?: BlockNode["styles"]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "acc",
        type: "core/accordion",
        version: 1,
        props: accordionProps,
        ...(styles === undefined ? {} : { styles }),
        slots: {
          children: [
            {
              id: "q",
              type: "core/accordion-item",
              version: 1,
              props: { title: "Question 1", open: false },
              slots: { children: [] },
            },
          ],
        },
      },
    ],
  } as unknown as BlockDocument;
}

/** The rows of one Content section, by setting name. */
function contentRows(document: BlockDocument, id: string, section: string) {
  const inspection = inspectSelection(document, id);
  return (
    inspection?.sections.content
      .find(each => each.label === section)
      ?.rows.map(row => row.name) ?? []
  );
}

/** Whether a setting is offered for the selected block. */
function offered(document: BlockDocument, id: string, name: string): boolean {
  return (
    inspectSelection(document, id)?.props.find(prop => prop.name === name)
      ?.offered ?? false
  );
}

describe("an Accordion's Behaviour", () => {
  it("offers Open, First open and Titles as, in that order", () => {
    expect(contentRows(page({ openMode: "one" }), "acc", "Behaviour")).toEqual([
      "openMode",
      "firstOpen",
      "titlesAs",
    ]);
  });

  it("reads a stored accordion with none set as it draws: Many, Plain text, first closed", () => {
    const props = inspectSelection(page({}), "acc")?.props ?? [];
    const shown = (name: string) => {
      const prop = props.find(each => each.name === name);
      return prop?.value ?? prop?.defaultValue;
    };
    expect(shown("openMode")).toBe("many");
    expect(shown("titlesAs")).toBe("text");
    expect(shown("firstOpen")).toBe(false);
  });
});

describe("a Question", () => {
  it("is called Question, its title too", () => {
    const inspection = inspectSelection(page({ openMode: "many" }), "q");
    expect(inspection?.label).toBe("Question");
    expect(inspection?.sections.content.map(each => each.label)).toEqual([
      "Question",
    ]);
  });

  it("hides Open by default while the Accordion opens one at a time", () => {
    expect(offered(page({ openMode: "one" }), "q", "open")).toBe(false);
  });

  it("shows Open by default while the Accordion opens many", () => {
    expect(offered(page({ openMode: "many" }), "q", "open")).toBe(true);
  });

  it("shows it for an accordion stored before Open, which opens many", () => {
    expect(offered(page({}), "q", "open")).toBe(true);
  });
});

describe("an Accordion's Icon", () => {
  it("is a Content section the builder draws", () => {
    expect(builderContentSectionsOf("core/accordion")).toEqual(["Icon"]);
  });

  it("is no longer in Style, where Icon position stays", () => {
    const document = page({ openMode: "one" });
    const style = inspectStyle(document, "acc");
    const icon = style?.sections.find(section => section.key === "icon");
    const all = style?.sections.flatMap(section =>
      section.properties.map(each => each.property)
    );
    expect(all).not.toContain("disclosureIcon");
    expect(icon?.properties.map(each => each.property)).toEqual([
      "disclosurePosition",
    ]);
  });

  it("shows in Style a value held at another device, so it can be cleared", () => {
    const document = page(
      { openMode: "one" },
      { base: { tablet: { disclosureIcon: "chevron" } } }
    );
    const at = (breakpoint: string) =>
      inspectStyle(document, "acc", { breakpoint })
        ?.sections.flatMap(section => section.properties)
        .map(each => each.property);
    expect(at("tablet")).toContain("disclosureIcon");
    // The control: at the base values, where Content writes, it is not.
    expect(at(BASE_BREAKPOINT)).not.toContain("disclosureIcon");
  });

  it("stays in Style while a shared style is edited, which Content never writes", () => {
    const document = page({ openMode: "one" });
    const shared = {
      base: { [BASE_BREAKPOINT]: { disclosureIcon: "chevron" } },
    };
    const rows = (styles?: BlockNode["styles"]) =>
      inspectStyle(document, "acc", styles === undefined ? {} : { styles })
        ?.sections.find(section => section.key === "icon")
        ?.properties.map(each => each.property);
    // The shared style's own icon, at its base values, can be changed and
    // cleared here: the Content row writes only the block's own styles.
    expect(rows(shared)).toEqual(["disclosureIcon", "disclosurePosition"]);
    // A shared style holding no icon offers it too, so one can be set on it.
    expect(rows({})).toContain("disclosureIcon");
    // The control: the block's own styles leave it to Content.
    expect(rows()).toEqual(["disclosurePosition"]);
  });

  it("reads + / − while nothing is stored, and for a stored Browser default", () => {
    const node = (styles?: BlockNode["styles"]) =>
      page({}, styles).nodes[0] as BlockNode;
    expect(accordionIconOf(node())).toBe("plus");
    expect(
      accordionIconOf(
        node({ base: { [BASE_BREAKPOINT]: { disclosureIcon: "browser" } } })
      )
    ).toBe("plus");
    expect(
      accordionIconOf(
        node({ base: { [BASE_BREAKPOINT]: { disclosureIcon: " Chevron " } } })
      )
    ).toBe("chevron");
  });

  it("writes the accordion's own base value, whatever else is stored", () => {
    const node = page(
      {},
      { base: { [BASE_BREAKPOINT]: { disclosurePosition: "before" } } }
    ).nodes[0] as BlockNode;
    const op = planAccordionIcon(node, "chevron");
    expect(JSON.stringify(op)).toContain('"disclosureIcon":"chevron"');
    // The position the accordion stores is kept.
    expect(JSON.stringify(op)).toContain('"disclosurePosition":"before"');
  });

  it("offers + / −, Chevron and None, and writes the one chosen", () => {
    const document = page({ openMode: "one" });
    const apply = vi.fn(() => document);
    render(
      <AccordionIconField
        editor={{ document, apply } as unknown as EditorState}
        nodeId="acc"
        heldBy={undefined}
      />
    );
    const group = screen.getByRole("radiogroup", { name: "Icon" });
    const names = [...group.querySelectorAll('[role="radio"]')].map(
      each => each.textContent
    );
    expect(names).toEqual(["+ / −", "Chevron", "None"]);
    expect(
      screen.getByRole("radio", { name: "+ / −" }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(JSON.stringify(apply.mock.calls[0])).toContain(
      '"disclosureIcon":"none"'
    );
  });

  it("resets the accordion's own icon, so a shared style or the default shows again", () => {
    const document = page(
      { openMode: "one" },
      {
        base: {
          [BASE_BREAKPOINT]: {
            disclosureIcon: "chevron",
            disclosurePosition: "before",
          },
        },
      }
    );
    const apply = vi.fn(() => document);
    render(
      <AccordionIconField
        editor={{ document, apply } as unknown as EditorState}
        nodeId="acc"
        heldBy={undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Icon" }));
    const written = JSON.stringify(apply.mock.calls[0]);
    // The icon is removed, not written as + / −, and the position is kept.
    expect(written).not.toContain("disclosureIcon");
    expect(written).toContain('"disclosurePosition":"before"');
  });

  it("offers no reset while the accordion holds no icon of its own, or a lock holds it", () => {
    const own = { base: { [BASE_BREAKPOINT]: { disclosureIcon: "none" } } };
    const draw = (styles: BlockNode["styles"] | undefined, heldBy?: string) =>
      render(
        <AccordionIconField
          editor={
            {
              document: page({ openMode: "one" }, styles),
              apply: vi.fn(),
            } as unknown as EditorState
          }
          nodeId="acc"
          heldBy={heldBy}
        />
      );
    draw(undefined);
    expect(screen.queryByRole("button", { name: "Reset Icon" })).toBeNull();
    cleanup();
    draw(own, "held");
    expect(screen.queryByRole("button", { name: "Reset Icon" })).toBeNull();
    cleanup();
    // The control: with an icon of its own and no lock, it is offered.
    draw(own);
    expect(screen.getByRole("button", { name: "Reset Icon" })).not.toBeNull();
  });
});
