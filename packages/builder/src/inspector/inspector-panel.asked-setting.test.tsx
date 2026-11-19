// @vitest-environment jsdom

/**
 * A setting asked for from outside the panel, as a page check's item asks
 * for the setting that fixes it: the panel shows its tab, opens its section,
 * clears a search that would hide it, and puts the cursor in its field, once
 * per ask.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { SettingAsked } from "../editor-asks";
import type { EditorState } from "../editor-state";
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

/** A picture, as `core/image` declares one, with a caption of its own. */
function register(): void {
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        example: { props: {} },
        editor: { label: "Picture" },
        props: {
          mediaId: {
            label: "Image",
            role: "content",
            type: "media",
            accept: "image/*",
          },
          src: { label: "Image address", role: "content", type: "url" },
          alt: { label: "Alt text", role: "content", type: "text" },
          decorative: { label: "Decorative, no alt text", type: "checkbox" },
          caption: {
            label: "Caption",
            role: "content",
            type: "text",
            section: "Caption",
          },
        },
        render: () => null,
      },
    ] as never,
    { source: "asked-setting-test" }
  );
}

function mount() {
  register();
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/picture",
        version: 1,
        props: { src: "/team.jpg" },
      } as BlockNode,
    ],
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
  } as unknown as EditorState;
  const view = render(<InspectorPanel editor={editor} />);
  const ask = (asked: SettingAsked) =>
    view.rerender(
      <InspectorPanel editor={{ ...editor, settingAsked: asked }} />
    );
  return { ask };
}

const tab = (name: string) => screen.getByRole("tab", { name });

/** A field by its label, not the section its label also names. */
const field = (label: string) =>
  screen.queryByLabelText(label, { selector: "input, textarea" });

describe("a setting asked for from a page check", () => {
  it("shows its tab and puts the cursor in its field", async () => {
    const { ask } = mount();
    fireEvent.mouseDown(tab("Advanced"));
    expect(tab("Advanced").getAttribute("aria-selected")).toBe("true");
    ask({ id: "a", tab: "content", setting: "alt", seq: 1 });
    expect(tab("Content").getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(field("Alt text")));
  });

  it("opens the section it is in, closed until then", async () => {
    const { ask } = mount();
    // Closed sections stay mounted, hidden.
    expect(field("Caption")?.closest("[hidden]")).not.toBeNull();
    ask({ id: "a", tab: "content", setting: "caption", seq: 1 });
    await waitFor(() => expect(document.activeElement).toBe(field("Caption")));
    expect(field("Caption")?.closest("[hidden]")).toBeNull();
  });

  it("clears a search that would hide it", async () => {
    const { ask } = mount();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "caption" },
    });
    ask({ id: "a", tab: "content", setting: "alt", seq: 1 });
    await waitFor(() => expect(document.activeElement).toBe(field("Alt text")));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("answers each ask once, and not an ask for another block", async () => {
    const { ask } = mount();
    ask({ id: "other", tab: "advanced", setting: "anchor", seq: 1 });
    expect(tab("Content").getAttribute("aria-selected")).toBe("true");
    ask({ id: "a", tab: "content", setting: "alt", seq: 2 });
    await waitFor(() => expect(document.activeElement).toBe(field("Alt text")));
    // The author goes on elsewhere; drawn again, the same ask moves nothing.
    fireEvent.mouseDown(tab("Advanced"));
    ask({ id: "a", tab: "content", setting: "alt", seq: 2 });
    expect(tab("Advanced").getAttribute("aria-selected")).toBe("true");
  });
});
