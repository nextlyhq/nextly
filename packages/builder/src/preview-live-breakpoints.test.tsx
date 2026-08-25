// @vitest-environment jsdom
/**
 * That the inspector asks the queries the sheet was actually emitted under.
 *
 * The panel decides which declarations are LIVE, and that is a question about
 * the at-rules the compile wrote. Given only the breakpoint set, it compares the
 * WINDOW against `@media` rules a preview compile never wrote — which is not a
 * stale answer but a confident wrong one, and in a plausible direction: a narrow
 * admin window reports the small breakpoints live while a wide canvas box is
 * showing the large ones.
 *
 * Asserted through the panel rather than the helper, because the helper already
 * accepted the option while the panel could not supply it — a fix that reached
 * the lower level and stopped there.
 *
 * @module preview-live-breakpoints.test
 */
import { PREVIEW_VIEWPORT_CONTAINER } from "@nextlyhq/blocks-engine";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StyleInspectorPanel } from "./style-inspector-panel";
import type { BreakpointSet } from "./breakpoints";
import type { EditorState } from "./editor-state";

const BREAKPOINTS = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
} as unknown as BreakpointSet;

/** Every query asked of the window, in the order the panel asked. */
let asked: string[] = [];

/*
 * Only the WIDTH queries. The panel also asks `prefers-color-scheme` for its
 * colour controls, which has nothing to do with breakpoints — counting it would
 * make the preview case fail for a reason unrelated to the property under test.
 */
const widthQueries = (): string[] =>
  asked.filter(query => query.includes("width"));

beforeEach(() => {
  asked = [];
  // A NARROW admin window: every max-width query matches. That is the state in
  // which an unaware panel reports the small breakpoints live while a wide
  // canvas box is showing the large ones.
  vi.stubGlobal("matchMedia", (query: string) => {
    asked.push(query);
    return {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const editor = {
  document: { formatVersion: 1, kind: "page", nodes: [] },
  selection: { ids: [] },
  selectedId: null,
  apply: () => null,
  undoDepth: 0,
} as unknown as EditorState;

describe("what the inspector asks the window", () => {
  it("asks nothing at all while the canvas is previewing", () => {
    /*
     * Under a preview compile the viewport tiers are container queries, which a
     * `matchMedia` caller cannot answer — so the honest behaviour is to ask
     * nothing and report only the unconditional context.
     *
     * The population is the published case below: if the panel asked no queries
     * in EITHER mode, this assertion would pass while proving nothing.
     */
    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={BREAKPOINTS}
        previewContainer={PREVIEW_VIEWPORT_CONTAINER}
      />
    );

    expect(widthQueries()).toEqual([]);
  });

  it("asks the window's own queries when it is NOT previewing", () => {
    // The control, and the population for the case above.
    render(<StyleInspectorPanel editor={editor} breakpoints={BREAKPOINTS} />);

    expect(widthQueries().length).toBeGreaterThan(0);
    expect(widthQueries().join(" ")).toContain("max-width: 991px");
  });
});
