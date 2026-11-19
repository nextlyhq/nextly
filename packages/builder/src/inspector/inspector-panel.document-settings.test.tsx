// @vitest-environment jsdom

/**
 * What the inspector shows with nothing selected: the host's view of the
 * open document's own settings, in the panel's frame, never a note.
 *
 * @module inspector-panel.document-settings.test
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "../editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { DocumentSettingsView } from "./inspector-panel-types";

beforeAll(() => {
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

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/card",
        version: 1,
        description: "A card.",
        example: { props: {} },
        editor: { label: "Card" },
        render: () => null,
        props: { title: { type: "text", role: "content" } },
      },
    ] as never,
    { source: "inspector-document-settings-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function documentOf(kind: "page" | "component"): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind,
    nodes: [{ id: "c1", type: "acme/card", version: 1, props: {} }],
  } as BlockDocument;
}

/** The host's view: a heading, and what the builder handed it, in place. */
const hostView: DocumentSettingsView = own => (
  <section aria-label="Settings of this document">
    <h2>Document settings</h2>
    {own === null ? <p>Nothing of the builder&apos;s own</p> : own}
  </section>
);

function mount(
  kind: "page" | "component",
  documentSettings?: DocumentSettingsView
): () => EditorState {
  const seen: { editor?: EditorState } = {};
  function Host() {
    const editor = useEditorState({ initialDocument: documentOf(kind) });
    seen.editor = editor;
    return (
      <InspectorPanel
        editor={editor}
        {...(documentSettings === undefined ? {} : { documentSettings })}
      />
    );
  }
  render(<Host />);
  return () => seen.editor!;
}

const hostRegion = () =>
  screen.queryByRole("region", { name: "Settings of this document" });

describe("the right panel with nothing selected", () => {
  it("draws the host's view of the document, and no note or tabs", () => {
    mount("page", hostView);
    const view = hostRegion();
    expect(view).not.toBeNull();
    expect(
      within(view!).getByText("Nothing of the builder's own")
    ).toBeTruthy();
    expect(screen.queryByText("Select a block to edit it.")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("draws it in the panel's frame, gone while a block is selected", () => {
    const editor = mount("page", hostView);
    const frame = hostRegion()?.closest(".nx-inspector");
    expect(frame?.getAttribute("data-empty")).toBe("no-selection");

    act(() => editor().select("c1"));
    expect(hostRegion()).toBeNull();
    expect(screen.getByRole("tab", { name: "Content" })).toBeTruthy();

    act(() => editor().select(null));
    expect(hostRegion()).not.toBeNull();
  });

  it("hands a component's own fields to the host, to place among its rows", () => {
    mount("component", hostView);
    const view = hostRegion();
    expect(view).not.toBeNull();
    expect(within(view!).getByRole("region", { name: "Fields" })).toBeTruthy();
    expect(
      within(view!).queryByText("Nothing of the builder's own")
    ).toBeNull();
    // One frame, not a frame inside a frame.
    expect(document.querySelectorAll(".nx-inspector")).toHaveLength(1);
  });

  it("shows a component's own fields alone where the host draws nothing", () => {
    mount("component");
    expect(screen.getByRole("region", { name: "Fields" })).toBeTruthy();
    expect(document.querySelectorAll(".nx-inspector")).toHaveLength(1);
  });

  it("keeps the empty frame, with no note, where the host draws nothing", () => {
    mount("page");
    const frame = document.querySelector('[data-empty="no-selection"]');
    expect(frame).not.toBeNull();
    expect(frame?.textContent).toBe("");
  });
});

describe("the right panel while a header or footer is selected", () => {
  /** The host's card for the selected region. */
  const card = (
    <section aria-label="Site header card">
      <h2>Site header</h2>
    </section>
  );

  function mountWithRegion(): {
    editor: () => EditorState;
    setCard: (next: React.ReactNode | undefined) => void;
  } {
    const seen: {
      editor?: EditorState;
      setCard?: (next: React.ReactNode | undefined) => void;
    } = {};
    function Host() {
      const editor = useEditorState({ initialDocument: documentOf("page") });
      const [regionCard, setCard] = React.useState<React.ReactNode>(card);
      seen.editor = editor;
      seen.setCard = setCard;
      return (
        <InspectorPanel
          editor={editor}
          documentSettings={hostView}
          {...(regionCard === undefined ? {} : { regionCard })}
        />
      );
    }
    render(<Host />);
    return { editor: () => seen.editor!, setCard: next => seen.setCard!(next) };
  }

  const regionCard = () =>
    screen.queryByRole("region", { name: "Site header card" });

  it("draws the host's region card in the panel's frame, in place of the document's settings", () => {
    mountWithRegion();
    expect(regionCard()).not.toBeNull();
    expect(hostRegion()).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    const frame = regionCard()?.closest(".nx-inspector");
    expect(frame?.getAttribute("data-empty")).toBe("region");
    expect(document.querySelectorAll(".nx-inspector")).toHaveLength(1);
  });

  it("never draws it beside a selected block's settings", () => {
    const { editor } = mountWithRegion();
    act(() => editor().select("c1"));
    expect(regionCard()).toBeNull();
    expect(screen.getByRole("tab", { name: "Content" })).toBeTruthy();
  });

  it("goes back to the document's settings once no region is selected", () => {
    const { setCard } = mountWithRegion();
    act(() => setCard(undefined));
    expect(regionCard()).toBeNull();
    expect(hostRegion()).not.toBeNull();
  });
});
