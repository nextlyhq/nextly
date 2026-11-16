// @vitest-environment jsdom

/**
 * "Never quote this" in the Content tab: offered on Section and Box only, a
 * switch that marks the block so its root carries `data-nosnippet`, stored
 * only while on, and a note where the block's tag is one Google does not
 * read the mark on.
 *
 * @module never-quote.test
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { NeverQuote } from "./never-quote";

afterEach(cleanup);

let editorRef: EditorState | null = null;

function Host({
  document,
  heldBy,
}: {
  document: BlockDocument;
  heldBy?: string;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return <NeverQuote editor={editor} nodeId="a" heldBy={heldBy} />;
}

function pageWith(
  type: string,
  props: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type, version: 1, props, ...extra }],
  } as BlockDocument;
}

const stored = () => findNode(editorRef!.document.nodes, "a");

describe("NeverQuote", () => {
  it.each(["core/section", "core/box"])("is offered on %s", type => {
    render(
      <Host
        document={pageWith(type, {
          as: type === "core/box" ? "div" : "section",
        })}
      />
    );
    expect(
      screen.getByRole("switch", { name: "Never quote this" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Google won't show this section's text under the page's link, or use it as a direct source in AI Overviews and AI Mode. Visitors still see it."
      )
    ).toBeTruthy();
  });

  it.each(["core/heading", "core/columns", "core/card"])(
    "is not offered on %s",
    type => {
      const { container } = render(<Host document={pageWith(type)} />);
      expect(container.innerHTML).toBe("");
    }
  );

  it("marks the block when turned on, and stores nothing once turned off", () => {
    render(<Host document={pageWith("core/section", { as: "section" })} />);
    const toggle = screen.getByRole("switch", { name: "Never quote this" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    act(() => toggle.click());
    expect(stored()?.nosnippet).toBe(true);
    expect(screen.getByText("data-nosnippet")).toBeTruthy();

    act(() => screen.getByRole("switch", { name: "Never quote this" }).click());
    expect(stored()).not.toHaveProperty("nosnippet");
  });

  it.each([
    ["core/section", { as: "header" }],
    ["core/section", { as: "main" }],
    ["core/box", { as: "article" }],
    ["core/box", { as: "div", link: "https://example.com" }],
  ])("says Google won't read the mark on %s with %j", (type, props) => {
    render(<Host document={pageWith(type, props, { nosnippet: true })} />);
    expect(
      screen.getByText(
        "Google reads this only when the HTML tag is section or div."
      )
    ).toBeTruthy();
  });

  it("says nothing more on a section or div tag", () => {
    render(
      <Host
        document={pageWith("core/box", { as: "div" }, { nosnippet: true })}
      />
    );
    expect(
      screen.queryByText(
        "Google reads this only when the HTML tag is section or div."
      )
    ).toBeNull();
  });

  it("is held while a lock holds the block's design", () => {
    render(
      <Host
        document={pageWith("core/section", { as: "section" })}
        heldBy="Locked"
      />
    );
    expect(
      screen
        .getByRole("switch", { name: "Never quote this" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
