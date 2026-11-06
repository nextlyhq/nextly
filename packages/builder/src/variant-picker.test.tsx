// @vitest-environment jsdom

/**
 * A placement's variant picker, in the placement's inspector.
 *
 * The properties under test: choosing a variant writes its key and keeps the
 * placement's own values and component, an empty variant is marked "(no
 * changes)", and a key the component no longer defines is said to be removed,
 * with Clear, rather than shown as no choice at all.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const card: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    { id: "h1", type: "acme/heading", version: 1, props: { text: "Plain" } },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "h1",
      propPath: "text",
      type: "text",
    },
  ],
  variants: {
    featured: { label: "Featured", overrides: { title: "Big" } },
    quiet: { label: "Quiet", overrides: {} },
  },
};

function placed(props: Record<string, unknown> = {}): BlockNode {
  return {
    id: "i1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card", overrides: { title: "Mine" }, ...props },
  };
}

function mount(node: BlockNode, definitions = new Map([["card", card]])) {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "i1",
    selection: { ids: ["i1"], primary: "i1" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{
        definitions,
        components: [{ id: "card", title: "Card", document: card }],
      }}
    />
  );
  return editor;
}

/** The props the one applied op writes. */
function written(editor: { apply: ReturnType<typeof vi.fn> }): unknown {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  return (editor.apply.mock.calls[0]?.[0] as { patch: { props: unknown } })
    .patch.props;
}

describe("a placement's variant picker", () => {
  it("is a row like the fields below it, its label beside the menu", () => {
    mount(placed());
    const picker = screen.getByRole("combobox", { name: "Variant" });
    const row = picker.parentElement;
    expect(row?.className).toBe("nx-inspector__field");
    // A field's label, not the capitalised heading above a group.
    const label = row?.querySelector("label");
    expect(label?.textContent).toBe("Variant");
    expect(label?.className).not.toContain("nx-inspector__heading");
    // Inside the fields' container, so it stacks with them in a narrow rail.
    expect(row?.parentElement?.className).toContain("nx-inspector__fields");
  });

  it("chooses a variant, keeping the placement's own values", () => {
    const editor = mount(placed());
    const picker = screen.getByRole("combobox", { name: "Variant" });
    expect(picker.textContent).toContain("Default");

    fireEvent.click(picker);
    expect(
      screen.getByRole("option", { name: "Quiet (no changes)" })
    ).toBeDefined();
    fireEvent.click(screen.getByRole("option", { name: "Featured" }));

    expect(written(editor)).toEqual({
      componentId: "card",
      overrides: { title: "Mine" },
      variant: "featured",
    });
  });

  it("says a removed variant is gone, and Clear lets it go", () => {
    const editor = mount(placed({ variant: "deleted" }));
    expect(screen.queryByRole("combobox", { name: "Variant" })).toBeNull();
    const notice = screen
      .getAllByRole("status")
      .find(node =>
        node.textContent?.includes("Variant removed, showing defaults")
      );
    expect(notice).toBeDefined();
    // Said once, by the notice with its Clear, not again under the title.
    expect(
      screen.getAllByText(/variant removed, showing defaults/i)
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Clear the removed variant" })
    );
    expect(written(editor)).toEqual({
      componentId: "card",
      overrides: { title: "Mine" },
    });
  });

  it("says nothing of a variant when the component could not be loaded", () => {
    mount(placed({ variant: "featured" }), new Map());
    expect(screen.queryByText("Variant removed, showing defaults")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Variant" })).toBeNull();
  });
});
