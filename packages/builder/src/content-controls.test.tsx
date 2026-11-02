// @vitest-environment jsdom

/**
 * The Content tab's controls registry, and the rule every inspector label
 * keeps: it names a control that is actually drawn.
 *
 * - Each prop type the registry knows resolves to its control, and the
 *   inspection marks exactly those types supported, from the same list.
 * - A prop of a type the registry does not know is still listed, by name,
 *   with no `<label for>` pointing at nothing.
 * - Every `<label for>` and `aria-labelledby` in the inspector resolves to an
 *   element in the page.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { CONTENT_CONTROL_TYPES, contentControlFor } from "./content-controls";
import type { EditorState } from "./editor-state";
import { inspectSelection } from "./inspector";
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

/** A block with one prop of every type given. */
function register(types: readonly string[]): void {
  registerBlocks(
    [
      {
        name: "acme/every",
        version: 1,
        description: "A prop of every kind.",
        example: { props: {} },
        editor: { label: "Every" },
        props: Object.fromEntries(
          types.map(type =>
            type === "select"
              ? [`a_${type}`, { type, options: ["one", "two"] }]
              : [`a_${type}`, { type }]
          )
        ),
        render: () => null,
      },
    ] as never,
    { source: "content-controls-test" }
  );
}

function editorFor(document: BlockDocument): EditorState {
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
  } as unknown as EditorState;
}

const documentOf = (): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/every", version: 1, props: {} } as BlockNode,
    ],
  }) as BlockDocument;

describe("the controls registry", () => {
  it("has a control for each type it lists", () => {
    // The positive control: the list is not empty.
    expect(CONTENT_CONTROL_TYPES.length).toBeGreaterThan(5);
    for (const type of CONTENT_CONTROL_TYPES) {
      expect(contentControlFor(type), type).toBeDefined();
    }
  });

  it("has none for a type it does not list", () => {
    expect(contentControlFor("acme-unknown")).toBeUndefined();
    // An inherited name must not resolve to something that is not a control.
    expect(contentControlFor("constructor")).toBeUndefined();
  });

  it("marks a prop supported exactly when the registry has its type", () => {
    register([...CONTENT_CONTROL_TYPES, "acme-unknown"]);
    const inspection = inspectSelection(documentOf(), "a");
    const supported = Object.fromEntries(
      (inspection?.props ?? []).map(prop => [prop.schema.type, prop.supported])
    );
    for (const type of CONTENT_CONTROL_TYPES)
      expect(supported[type], type).toBe(true);
    expect(supported["acme-unknown"]).toBe(false);
  });
});

describe("every label names a drawn control", () => {
  it("draws a control for each known type", () => {
    register(CONTENT_CONTROL_TYPES);
    const { container } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );
    const fields = container.querySelectorAll("[data-content-control]");
    expect(
      [...fields]
        .map(field => field.getAttribute("data-content-control"))
        .sort()
    ).toEqual([...CONTENT_CONTROL_TYPES].sort());
  });

  it("leaves no label pointing at nothing, an unsupported prop included", () => {
    register([...CONTENT_CONTROL_TYPES, "acme-unknown"]);
    const { container } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );

    // The positive control: there are labels to check.
    const labels = [...container.querySelectorAll("label[for]")];
    expect(labels.length).toBeGreaterThan(3);
    const dangling = labels
      .map(label => label.getAttribute("for") ?? "")
      .filter(id => document.getElementById(id) === null);
    expect(dangling).toEqual([]);

    const labelledBy = [...container.querySelectorAll("[aria-labelledby]")]
      .flatMap(element =>
        (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)
      )
      .filter(id => id !== "" && document.getElementById(id) === null);
    expect(labelledBy).toEqual([]);

    // The unsupported prop is still listed, with its type.
    expect(container.textContent).toContain("acme-unknown");
  });
});
