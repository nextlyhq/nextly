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
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
});
