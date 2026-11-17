// @vitest-environment jsdom

/**
 * An Image's "When clicked" in the Content tab, drawn for the real
 * `core/image`: Nothing, Link or Enlarge, read as the block's render reads
 * it, with the shared link settings shown only while Link is the choice.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { image } from "@nextlyhq/blocks-react/blocks";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
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
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A frame whose slot lets only content change, as a template's area does. */
const FRAME = {
  name: "acme/frame",
  version: 1,
  description: "A frame.",
  editor: { label: "Frame" },
  props: {},
  example: { props: {} },
  slots: { body: { allow: ["core/image"], lock: "contentOnly" } },
  render: () => null,
};

function mount(
  props: Record<string, unknown>,
  bindings?: Record<string, unknown>,
  { contentOnly = false }: { contentOnly?: boolean } = {}
) {
  registerBlocks([image, FRAME] as never, { source: "when-clicked-test" });
  const picture = {
    id: "a",
    type: "core/image",
    version: 1,
    props,
    ...(bindings === undefined ? {} : { bindings }),
  } as BlockNode;
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: contentOnly
      ? [
          {
            id: "f",
            type: "acme/frame",
            version: 1,
            props: {},
            slots: { body: [picture] },
          } as BlockNode,
        ]
      : [picture],
  } as BlockDocument;
  const editor = {
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
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(<InspectorPanel editor={editor} contentServices={{}} />);
  // Opened as an author opens it: a section holding nothing starts folded.
  const heading = screen.getByRole("button", { name: /^When clicked/ });
  if (heading.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(heading);
  }
  return editor;
}

const choices = () => screen.getByRole("radiogroup", { name: "When clicked" });
const chosen = () =>
  within(choices())
    .getAllByRole("radio")
    .filter(radio => radio.getAttribute("aria-checked") === "true")
    .map(radio => radio.textContent);

/** Whether the shared link settings are drawn: the link's own field. */
const linkShown = () =>
  screen.queryByRole("button", { name: /^Link: / }) !== null;

describe("an Image's When clicked", () => {
  it("offers Nothing, Link and Enlarge, in that order", () => {
    mount({ src: "https://example.test/a.png" });
    expect(
      within(choices())
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["Nothing", "Link", "Enlarge"]);
  });

  it("reads Nothing, with no link settings, for a new Image", () => {
    mount({ src: "https://example.test/a.png" });
    expect(chosen()).toEqual(["Nothing"]);
    expect(linkShown()).toBe(false);
    expect(screen.queryByText("Open in new tab")).toBeNull();
  });

  it("reads Link, with the link settings, for an Image stored with a link", () => {
    mount({ src: "https://example.test/a.png", href: "/about" });
    expect(chosen()).toEqual(["Link"]);
    expect(linkShown()).toBe(true);
    expect(screen.getByText("Open in new tab")).not.toBeNull();
  });

  it("reads Link for an Image whose link is bound", () => {
    mount({ src: "https://example.test/a.png" }, { href: { $bind: "url" } });
    expect(chosen()).toEqual(["Link"]);
  });

  it("shows the link settings only for Link", () => {
    for (const [whenClicked, shown] of [
      ["nothing", false],
      ["link", true],
      ["enlarge", false],
    ] as const) {
      mount({ src: "https://example.test/a.png", href: "/about", whenClicked });
      expect(linkShown()).toBe(shown);
      cleanup();
      clearBlocks();
    }
  });

  it("writes the choice, and only the choice, keeping a stored link", () => {
    const editor = mount({
      src: "https://example.test/a.png",
      href: "/about",
    });
    fireEvent.click(within(choices()).getByRole("radio", { name: "Nothing" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(
      (editor.apply.mock.calls[0]?.[0] as { patch: { props: object } }).patch
        .props
    ).toEqual({
      src: "https://example.test/a.png",
      href: "/about",
      whenClicked: "nothing",
    });
  });

  it("stays a choice an author can make where only content may change", () => {
    // Picking Link is how a link is added; a content-only area allows links.
    const editor = mount({ src: "https://example.test/a.png" }, undefined, {
      contentOnly: true,
    });
    const link = within(choices()).getByRole("radio", { name: "Link" });
    expect(link.hasAttribute("disabled")).toBe(false);
    expect(link.closest("fieldset[disabled]")).toBeNull();
    fireEvent.click(link);
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("draws Caption in a section of its own after When clicked", () => {
    mount({ src: "https://example.test/a.png" });
    const content = screen.getByRole("tabpanel", { name: "Content" });
    const headings = [
      ...content.querySelectorAll(".nx-style-inspector__section-label"),
    ].map(label => label.textContent);
    expect(headings.indexOf("When clicked")).toBeGreaterThan(-1);
    expect(headings.indexOf("Caption")).toBeGreaterThan(
      headings.indexOf("When clicked")
    );
  });
});
