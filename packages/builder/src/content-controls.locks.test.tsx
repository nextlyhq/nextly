// @vitest-environment jsdom

/**
 * Every Content-tab control is read-only under a Layers lock: the block's own
 * lock, and a lock it is held by from a block around it.
 *
 * The read-only state comes from one place (`propIsWritable`, through
 * `lockBlockingEdit`), and each control is handed it as `disabled`. What this
 * pins is that every control kind honours it, including the segmented choice,
 * the checkbox toggle, the media button, the list editor and the relation
 * search, so a click or a key on any of them reaches no write.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  CONTENT_CONTROL_TYPES,
  type ContentServices,
  type MediaPickerProps,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** One prop of every control kind, a short choice drawn as segments among them. */
function register(): void {
  const props: Record<string, unknown> = {};
  for (const type of CONTENT_CONTROL_TYPES) {
    props[`a_${type}`] =
      type === "select"
        ? { type, options: ["h1", "h2", "h3"] }
        : type === "relation"
          ? { type, relationTo: "posts" }
          : type === "array"
            ? { type, of: "text" }
            : { type };
  }
  // A choice too long to sit side by side: the menu, not the segments.
  props.long_select = {
    type: "select",
    options: [
      "a very long first choice",
      "a very long second choice",
      "a very long third choice",
    ],
  };
  registerBlocks(
    [
      {
        name: "acme/every",
        version: 1,
        description: "A prop of every kind.",
        example: { props: {} },
        editor: { label: "Every" },
        props,
        slots: { children: {} },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-locks-test" }
  );
}

/** The block `a`, holding values, locked itself or inside a locked `hero`. */
function documentOf(lock: "own" | "inherited" | "none"): BlockDocument {
  const a = {
    id: "a",
    type: "acme/every",
    version: 1,
    props: {
      a_select: "h2",
      a_checkbox: true,
      a_text: "Words",
      a_array: ["one", "two"],
      a_media: "m-1",
      a_relation: "p-1",
    },
    ...(lock === "own" ? { locked: true } : {}),
  } as BlockNode;
  const nodes =
    lock === "inherited"
      ? [
          {
            id: "hero",
            type: "acme/every",
            version: 1,
            props: {},
            locked: true,
            name: "Hero",
            slots: { children: [a] },
          } as BlockNode,
        ]
      : [a];
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
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
}

function Picker({ open }: MediaPickerProps): React.JSX.Element | null {
  return open ? <p>picker open</p> : null;
}

const SERVICES: ContentServices = {
  MediaPicker: Picker,
  findEntries: async () => [{ id: "p-1", title: "First post" }],
};

function mount(lock: "own" | "inherited" | "none") {
  register();
  const editor = editorFor(documentOf(lock));
  const { container } = render(
    <InspectorPanel editor={editor} contentServices={SERVICES} />
  );
  return { editor, container };
}

/** Every control in the Content tab a pointer or a key could act on. */
function controls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      "[data-content-control] :is(button, input, textarea, select, [role=combobox], [role=searchbox], [contenteditable])"
    ),
  ];
}

/** Whether an element takes no input: disabled, or said to be. */
function inert(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("contenteditable") === "false" ||
    element.hasAttribute("readonly")
  );
}

describe("every Content-tab control under a Layers lock", () => {
  for (const lock of ["own", "inherited"] as const) {
    it(`is read-only under the block's ${lock} lock, every kind of it`, () => {
      const { container } = mount(lock);
      // The positive control: every kind of control is drawn.
      const kinds = new Set(
        [...container.querySelectorAll("[data-content-control]")].map(field =>
          field.getAttribute("data-content-control")
        )
      );
      for (const type of CONTENT_CONTROL_TYPES) {
        expect(kinds.has(type), type).toBe(true);
      }
      const found = controls(container);
      expect(found.length).toBeGreaterThan(CONTENT_CONTROL_TYPES.length);
      const live = found
        .filter(element => !inert(element))
        .map(
          element =>
            `${element.closest("[data-content-control]")?.getAttribute("data-content-control")}: ${element.outerHTML.slice(0, 80)}`
        );
      expect(live).toEqual([]);
    });

    it(`writes nothing for a click or a key on any control, under the ${lock} lock`, () => {
      const { editor, container } = mount(lock);
      const segment = screen.getByRole("radio", { name: "h1" });
      fireEvent.click(segment);
      fireEvent.keyDown(screen.getByRole("radio", { name: "h2" }), {
        key: "ArrowRight",
      });
      for (const element of controls(container)) {
        fireEvent.click(element);
        fireEvent.keyDown(element, { key: "Enter" });
      }
      expect(editor.apply).not.toHaveBeenCalled();
      expect(screen.queryByText("picker open")).toBeNull();
    });
  }

  it("leaves every control live on a block nothing locks", () => {
    // The control for the cases above: a rule that disabled everything would
    // pass them, and this would fail.
    const { editor, container } = mount("none");
    expect(
      controls(container).filter(element => !inert(element)).length
    ).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole("radio", { name: "h1" }));
    expect(editor.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", kind: "update" })
    );
  });
});
