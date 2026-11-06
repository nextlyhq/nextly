// @vitest-environment jsdom

/**
 * That the editor's surfaces READ their words from the catalogue.
 *
 * Comparing a surface's label with the catalogue passes just as well for a
 * label typed beside it, since both spell "Layers". So the catalogue is
 * replaced here with words no surface could have typed, and each surface must
 * show those.
 *
 * @module editor-words.surfaces.test
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

vi.mock("./editor-words", async importOriginal => {
  const real = await importOriginal<typeof import("./editor-words")>();
  return {
    ...real,
    EDITOR_WORDS: Object.fromEntries(
      Object.keys(real.EDITOR_WORDS).map(key => [key, `«${key}»`])
    ),
  };
});

const { panelLabel } = await import("./editor-rail");
const { inspectorTabLabels } = await import("./inspector-panel");
const { InsertPanel } = await import("./insert-panel");
const { LayersPanel } = await import("./layers-panel");
const { useEditorState } = await import("./editor-state");
const { HelpDialog } = await import("./help-dialog");
const { FontsPanel } = await import("./fonts-panel");
const { SharedStylesPanel } = await import("./shared-styles-panel");

afterEach(cleanup);

// jsdom draws no layout, and the palette scrolls its highlighted tile into view.
Element.prototype.scrollIntoView ??= () => {};

// One block, so the Layers tree has a row to draw.
const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/text", version: 1, props: {} }],
} as never;

function Panels(): React.JSX.Element {
  const editor = useEditorState({ initialDocument: PAGE });
  return (
    <>
      <InsertPanel editor={editor} />
      <LayersPanel editor={editor} />
    </>
  );
}

describe("the editor's surfaces read the catalogue", () => {
  it("names the rail's panels and the inspector's tabs from it", () => {
    expect(panelLabel("layers")).toBe("«layers»");
    expect(panelLabel("design")).toBe("«design»");
    expect(inspectorTabLabels()).toEqual(["«content»", "«style»"]);
  });

  it("names the Add panel, its tabs and the Layers tree from it", () => {
    render(<Panels />);

    expect(screen.getByRole("heading", { name: "«add»" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "«blocks»" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "«sections»" })).toBeTruthy();
    expect(screen.getByRole("tree", { name: "«layers»" })).toBeTruthy();
  });

  it("words the Add panel's search, headings and empty tab from it", () => {
    // The test block declares no category, so it sits under "More blocks".
    registerBlocks(
      [
        {
          name: "acme/text",
          version: 1,
          description: "A block.",
          example: { props: {} },
          render: () => null,
        },
      ] as never,
      { source: "words" }
    );
    render(<Panels />);

    expect(
      screen
        .getByRole("combobox", { name: "Insert a block" })
        .getAttribute("placeholder")
    ).toBe("Search «blocks» and «components»");
    expect(screen.getByText("More «blocks»")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "«sections»" }), {
      button: 0,
    });
    expect(screen.getByText("No «sections» are saved yet.")).toBeTruthy();
    clearBlocks();
  });

  it("words the Fonts tab's search, states and links from it", () => {
    const { unmount } = render(
      <FontsPanel faces={undefined} tokens={undefined} absence="pending" />
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Reading this site\u2019s «fonts»\u2026"
    );
    unmount();
    render(
      <FontsPanel
        faces={[]}
        tokens={{ tokens: [] }}
        readOnly
        onOpenTokens={() => undefined}
      />
    );
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe(
      "Search «fonts»"
    );
    expect(
      screen.getByText(
        "You can view the site\u2019s «fonts» but not change them."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "No «fonts» on this site yet, so pages use the system font."
      )
    ).toBeTruthy();
    expect(screen.getByText("Font «variables»")).toBeTruthy();
    expect(
      screen.getByText("No font «variables» yet. «variables» creates them.")
    ).toBeTruthy();
  });

  it("words the Shared styles tab's search, states and heading from it", () => {
    const blocks = { counts: new Map<string, number>(), complete: true };
    const { unmount } = render(
      <SharedStylesPanel library={undefined} pageBlocks={blocks} />
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Reading this site\u2019s «sharedstyles»\u2026"
    );
    unmount();
    render(<SharedStylesPanel library={[]} pageBlocks={blocks} readOnly />);
    expect(screen.getByRole("searchbox").getAttribute("aria-label")).toBe(
      "Search «sharedstyles»"
    );
    expect(
      screen.getByRole("heading", { name: "«sharedStyles»" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You can view the site\u2019s «sharedstyles» but not change them."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "No «sharedstyles» yet. Select a block and choose Save as shared style\u2026"
      )
    ).toBeTruthy();
  });

  it("titles the Help dialog from it", () => {
    render(
      <ShortcutProvider>
        <HelpDialog open onOpenChange={() => {}} />
      </ShortcutProvider>
    );

    expect(screen.getByRole("dialog", { name: "«help»" })).toBeTruthy();
  });
});
