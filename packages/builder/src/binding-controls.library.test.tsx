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
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource } from "./binding-services";
import type { EditorState } from "./editor-state";
import { inspectSelection, propLabel } from "./inspector";
import { InspectorPanel } from "./inspector-panel";
import { propGroupsOf } from "./prop-groups";

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

describe("the core block library's bind buttons", () => {
  it("offers one on every bindable prop of every core block, but the props a group draws without binding", () => {
    const unbound: string[] = [];
    for (const block of coreBlocks) {
      const document = drawn(block);
      const props = (inspectSelection(document, "n")?.props ?? []).filter(
        prop => prop.offered
      );
      // The groups as the panel finds them, so the walk follows each group's
      // own statement of what it binds rather than a copy of it.
      const groups = propGroupsOf(props);
      const grouped = new Set(groups.flatMap(group => [...group.drawn]));
      const binds = new Set(groups.flatMap(group => [...group.bindable]));
      for (const prop of props) {
        if (bindablePropKind(prop.schema) === undefined) continue;
        if (grouped.has(prop.name) && !binds.has(prop.name)) {
          unbound.push(`${block.name}.${prop.name}`);
          continue;
        }
        const buttons = screen.queryAllByRole("button", {
          name: `Bind ${propLabel(prop.name, prop.schema)} to a field`,
        });
        expect(buttons.length, `${block.name} ${prop.name}`).toBeGreaterThan(0);
      }
      cleanup();
    }
    // Named, with why, so neither a group binding nothing nor one binding
    // everything passes: a link's target, rel and entry qualify the address
    // its own button binds (the entry is bound from the Link's picker, which
    // writes both halves at once); an image's decorative mark is a mode of its
    // words' menu; a list's query is chosen, never filled from a field.
    expect(unbound.sort()).toEqual(
      [
        "core/button.entryCollection",
        "core/button.entryId",
        "core/button.rel",
        "core/button.target",
        "core/collection-loop.collection",
        "core/collection-loop.limit",
        "core/collection-loop.offset",
        "core/collection-loop.paginate",
        "core/collection-loop.sort",
        "core/heading.rel",
        "core/heading.target",
        "core/icon.entryCollection",
        "core/icon.entryId",
        "core/icon.rel",
        "core/icon.target",
        "core/image.decorative",
        "core/image.entryCollection",
        "core/image.entryId",
        "core/image.rel",
        "core/image.target",
      ].sort()
    );
  });
});
