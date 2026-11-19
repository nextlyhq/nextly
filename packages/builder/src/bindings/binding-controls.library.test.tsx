// @vitest-environment jsdom

/**
 * The core block library, walked block by block: every prop of a bindable
 * type the inspector offers gets a bind button, but those a group draws and
 * says it does not bind, which are named here. A block added later that
 * loses its buttons by accident, or a group that starts swallowing one,
 * changes that list and fails.
 */
import {
  bindablePropKind,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource } from "./binding-services";
import type { EditorState } from "../editor-state";
import { inspectSelection, propLabel } from "../inspector/inspector";
import { InspectorPanel } from "../inspector/inspector-panel";
import { propGroupsOf } from "../inspector/content/prop-groups";

beforeAll(() => {
  // What Radix asks of an element, which jsdom does not draw.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  registerBlocks(coreBlocks as never, { source: "binding-library-walk-test" });
});

afterAll(() => {
  clearBlocks();
});

/** One source with one field: a host that lists fields, so buttons are drawn. */
const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Post",
    fields: [{ name: "title", type: "text", public: true }],
  },
];

/**
 * What a block holds beyond its example, where its example draws only part
 * of its controls: an Image placed with no picture shows the library side of
 * its Source, and its address field (with its own bind button) only once it
 * holds an address; its link (with its bind button) only while a click
 * follows it; and its Caption section, folded while it holds nothing, opens
 * on a caption.
 */
const HOLDING: Readonly<Record<string, Record<string, unknown>>> = {
  // A provider's link played on press: an Embed draws Load, Privacy mode
  // and Poster only for one.
  "core/embed": {
    src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    load: "click",
  },
  "core/image": {
    src: "https://cdn.example/a.png",
    whenClicked: "link",
    caption: "A caption",
  },
};

/** The block alone on a page, as its example fills it over its defaults. */
function drawn(block: (typeof coreBlocks)[number]): BlockDocument {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n",
        type: block.name,
        version: block.version,
        props: {
          ...(block.defaultProps as Record<string, unknown>),
          ...(block.example?.props as Record<string, unknown> | undefined),
          ...HOLDING[block.name],
        },
      },
    ],
  } as BlockDocument;
  render(
    <InspectorPanel
      editor={
        {
          document,
          selectedId: "n",
          selection: { ids: ["n"], primary: "n" },
          applyAll: vi.fn(() => document),
          select: vi.fn(),
          apply: vi.fn(() => document),
          undo: vi.fn(),
          redo: vi.fn(),
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          composed: () => undefined,
        } as unknown as EditorState
      }
      contentServices={{ listBindingFields: async () => SOURCES }}
    />
  );
  return document;
}

/**
 * Settings the builder draws as a choice of its own, which no field fills, or
 * only once that choice asks for them: a Form's After sending says what the
 * block does once a send is accepted, and its page is drawn (with its bind
 * button) only once it goes to a page.
 */
const CHOSEN_NEVER_FILLED: ReadonlySet<string> = new Set([
  "core/form.afterSending",
  "core/form.href",
]);

/** Every folded section of the tab showing unfolded, as an author opens one. */
function unfoldSections(): void {
  for (const trigger of screen.queryAllByRole("button", { expanded: false })) {
    if (trigger.classList.contains("nx-style-inspector__section-trigger")) {
      fireEvent.click(trigger);
    }
  }
}

describe("the core block library's bind buttons", () => {
  it("offers one on every bindable prop of every core block, but the props a group draws without binding", () => {
    const unbound: string[] = [];
    for (const block of coreBlocks) {
      const document = drawn(block);
      const inspection = inspectSelection(document, "n");
      // A Style setting (a container's Content width) is the block's own,
      // drawn by its Style control, and never filled from a field.
      const styled = new Set(
        (inspection?.sections.styleProps ?? []).flatMap(section =>
          section.rows.map(row => row.name)
        )
      );
      const props = (inspection?.props ?? []).filter(
        prop => prop.offered && !styled.has(prop.name)
      );
      // The groups as the panel finds them, so the walk follows each group's
      // own statement of what it binds rather than a copy of it.
      const groups = propGroupsOf(props);
      const grouped = new Set(groups.flatMap(group => [...group.drawn]));
      const binds = new Set(groups.flatMap(group => [...group.bindable]));
      // An Advanced setting (a container's HTML tag) is bound in the Advanced
      // tab, so it is looked for there, after every Content one.
      const advanced = new Set(
        (inspection?.sections.advanced ?? []).flatMap(section =>
          section.rows.map(row => row.name)
        )
      );
      const inTabOrder = [
        ...props.filter(prop => !advanced.has(prop.name)),
        ...props.filter(prop => advanced.has(prop.name)),
      ];
      let onAdvanced = false;
      // Every Content section unfolded, as an author opens one: a section
      // holding no value yet (a Form's After sending) starts folded.
      unfoldSections();
      for (const prop of inTabOrder) {
        if (bindablePropKind(prop.schema) === undefined) continue;
        if (CHOSEN_NEVER_FILLED.has(`${block.name}.${prop.name}`)) {
          unbound.push(`${block.name}.${prop.name}`);
          continue;
        }
        if (grouped.has(prop.name) && !binds.has(prop.name)) {
          unbound.push(`${block.name}.${prop.name}`);
          continue;
        }
        if (advanced.has(prop.name) && !onAdvanced) {
          fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
          // Its sections too: HTML holding nothing yet (a Heading's) is folded.
          unfoldSections();
          onAdvanced = true;
        }
        const buttons = screen.queryAllByRole("button", {
          name: `Bind ${propLabel(prop.name, prop.schema)} to a field`,
        });
        expect(buttons.length, `${block.name} ${prop.name}`).toBeGreaterThan(0);
      }
      cleanup();
    }
    // Named, with why, so neither a group binding nothing nor one binding
    // everything passes: a link's target and entry qualify the address
    // its own button binds (the entry is bound from the Link's picker, which
    // writes both halves at once; a link relationship, in Advanced, has a
    // button of its own); an image's decorative mark is a mode of its
    // words' menu; a list's query is chosen, never filled from a field.
    expect(unbound.sort()).toEqual(
      [
        "core/box.entryCollection",
        "core/box.entryId",
        "core/box.target",
        "core/button.entryCollection",
        "core/button.entryId",
        "core/button.target",
        "core/card.entryCollection",
        "core/card.entryId",
        "core/card.target",
        "core/collection-loop.collection",
        "core/collection-loop.limit",
        "core/collection-loop.offset",
        "core/collection-loop.paginate",
        "core/collection-loop.sort",
        "core/form.afterSending",
        "core/form.entryCollection",
        "core/form.entryId",
        "core/form.href",
        "core/heading.entryCollection",
        "core/heading.entryId",
        "core/heading.target",
        "core/icon.entryCollection",
        "core/icon.entryId",
        "core/icon.target",
        "core/image.decorative",
        "core/image.entryCollection",
        "core/image.entryId",
        "core/image.target",
        // What a click does is chosen, not filled from a field.
        "core/image.whenClicked",
        "core/quote.entryCollection",
        "core/quote.entryId",
        "core/quote.target",
      ].sort()
    );
  });
});
