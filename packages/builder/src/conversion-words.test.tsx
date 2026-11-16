// @vitest-environment jsdom

/**
 * Each conversion between a selection, a saved section and a component is
 * named by one verb, the same on every surface that offers it.
 *
 * The bar, its ⋯ menu and the right-click menu draw `toolbarActions`' labels
 * (`block-context-menu.test` holds that the menu offers the bar's own list);
 * the command palette draws `builderCommands`' labels. So the words are held
 * here on both lists, and on the palette as it is drawn, for a plain block
 * and for a component placed on the page.
 *
 * @module conversion-words.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutProvider } from "@nextlyhq/ui";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { builderCommands, type CommandVerbs } from "./builder-commands";
import { CommandPalette } from "./command-palette";
import {
  toolbarActions,
  type ToolbarAction,
  type ToolbarActionId,
} from "./toolbar-actions";

afterEach(cleanup);

class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", InertResizeObserver);
Element.prototype.scrollIntoView = function scrollIntoView() {};

function node(
  id: string,
  type = "acme/heading",
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

const anyParent = { parentsOf: () => undefined };
const card = {
  formatVersion: 1,
  kind: "component",
  nodes: [node("t")],
} as unknown as BlockDocument;
const offer = {
  mayCreate: true,
  mayUpdatePattern: true,
  definitions: new Map([["card", card]]),
};

/** What the bar offers for a run of two plain blocks, and for one placement. */
function offered(): ToolbarAction[] {
  const plain = toolbarActions(
    documentOf([node("a"), node("b")]),
    "a",
    ["a", "b"],
    anyParent,
    true,
    undefined,
    offer
  );
  const placed = toolbarActions(
    documentOf([
      node("p", "nextly/component-instance", {
        props: { componentId: "card" },
      }),
    ]),
    "p",
    ["p"],
    anyParent,
    true,
    undefined,
    offer
  );
  return [...plain, ...placed];
}

const verbs: CommandVerbs = {
  selectParent: () => {},
  move: () => {},
  duplicate: () => {},
  saveAsPattern: () => {},
  delete: () => {},
};

const WORDS: ReadonlyArray<readonly [ToolbarActionId, string]> = [
  ["save-as-pattern", "Save as section…"],
  ["turn-into-component", "Turn into component…"],
  ["detach-component", "Detach from component"],
];

function labelOf(actions: readonly ToolbarAction[], id: ToolbarActionId) {
  return actions.find(action => action.id === id)?.label;
}

/** The palette over both selections' verbs, each verb once, as it lists them. */
function paletteOf(actions: readonly ToolbarAction[]) {
  const once = actions.filter(
    (action, at) => actions.findIndex(each => each.id === action.id) === at
  );
  return builderCommands({
    actions: once.map(action => ({ ...action, enabled: true })),
    verbs,
    undo: () => {},
    redo: () => {},
    canUndo: false,
    canRedo: false,
  });
}

describe("the conversion verbs", () => {
  it("are named in the bar and its menus with the decided words", () => {
    const actions = offered();
    for (const [id, words] of WORDS) {
      expect(labelOf(actions, id)).toBe(words);
    }
  });

  it("are named in the palette with the bar's own words", () => {
    const commands = paletteOf(offered());
    for (const [id, words] of WORDS) {
      expect(
        commands.find(command => command.id === `block.${id}`)?.label
      ).toBe(words);
    }
  });

  it("are drawn in the palette as the bar draws them", () => {
    render(
      <ShortcutProvider>
        <CommandPalette commands={paletteOf(offered())} />
      </ShortcutProvider>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    for (const [, words] of WORDS) {
      expect(screen.getByRole("option", { name: words })).toBeDefined();
    }
    expect(screen.queryByText(/pattern/i)).toBeNull();
  });
});
