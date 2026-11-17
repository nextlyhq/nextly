// @vitest-environment jsdom

/**
 * "Find a setting" and "Only changed" at the top of the block panel, with
 * the real editor: what each tab shows while the panel is filtered, what it
 * says when nothing matches, and that clearing gives back the panel as the
 * author left it.
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

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

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
  vi.useRealTimers();
});

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: BASE_BREAKPOINT, label: "Desktop" },
    { id: "md", label: "Tablet", maxWidth: 1024 },
  ],
  container: [],
} as BreakpointSet;

function nodeOf(id: string, type: string, extra: Partial<BlockNode> = {}) {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props: {}, ...extra } as BlockNode;
}

/** A Button with a label, a link, a background at Desktop and a colour at Hover. */
const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("button", "core/button", {
      props: { label: "Buy", href: "/buy", type: "button" },
      styles: {
        base: { base: { backgroundColor: "#123456" } },
        hover: { base: { color: "#ffffff" } },
      },
    }),
    nodeOf("spacer", "core/spacer"),
  ],
} as BlockDocument;

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;
const onState = vi.fn<(state: StyleState) => void>();

function Host(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  return (
    <InspectorPanel
      editor={state}
      breakpoints={BREAKPOINTS}
      breakpoint={BASE_BREAKPOINT}
      styleState={{ state: "base", onChange: onState }}
    />
  );
}

function mount(id = "button"): void {
  render(<Host />);
  act(() => editor().select(id));
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^${name}`) });
}

function openTab(name: string): void {
  fireEvent.mouseDown(tab(name));
}

function search(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Find a setting" });
}

function type(text: string): void {
  fireEvent.change(search(), { target: { value: text } });
}

function shownPanel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

/** The Style properties drawn and not hidden. */
function shownProperties(): string[] {
  return [...shownPanel().querySelectorAll<HTMLElement>("[data-property]")]
    .filter(each => each.closest("[hidden]") === null)
    .map(each => each.getAttribute("data-property") ?? "");
}

describe("Find a setting", () => {
  it("sits under the tabs on every tab", () => {
    mount();
    for (const name of ["Content", "Style", "Advanced"]) {
      openTab(name);
      expect(search()).toBeDefined();
    }
  });

  it("shows only what matches in Style, opened, and counts the other tabs", () => {
    mount();
    openTab("Style");
    type("colour");
    const shown = shownProperties();
    expect(shown).toContain("backgroundColor");
    expect(shown).not.toContain("padding");
    // The panel stays on Style, and every tab says how many it holds.
    expect(tab("Style").getAttribute("data-state")).toBe("active");
    for (const name of ["Content", "Style", "Advanced"]) {
      expect(
        tab(name).querySelector(".nx-inspector__tab-count")
      ).not.toBeNull();
    }
  });

  it("says where the matches are when this tab has none, and goes there", () => {
    mount();
    openTab("Style");
    type("nofollow");
    expect(shownPanel().textContent).toContain("No setting matches here.");
    // A Button's Link relationship is drawn with its link, in Content.
    fireEvent.click(
      within(shownPanel()).getByRole("button", { name: "1 in Content" })
    );
    expect(tab("Content").getAttribute("data-state")).toBe("active");
    expect(shownPanel().textContent).not.toContain("No setting matches");
    // The link it is drawn with shows; the rest of Content doesn't.
    expect(screen.getByLabelText("Label").closest("[hidden]")).not.toBeNull();
    const kept = [...shownPanel().querySelectorAll(".nx-setting")].filter(
      slot => !slot.hasAttribute("hidden") && slot.childElementCount > 0
    );
    expect(kept).toHaveLength(1);
  });

  it("says when no tab has a match", () => {
    mount();
    type("qqqq");
    expect(shownPanel().textContent).toContain(
      "No setting matches. Try another word."
    );
  });

  it("clears on Escape and gives back the sections as they were", () => {
    mount();
    openTab("Style");
    const openBefore = openSections();
    type("colour");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search().value).toBe("");
    expect(openSections()).toEqual(openBefore);
  });

  it("opens a search's matches afresh when it is typed again", () => {
    mount();
    openTab("Style");
    type("colour");
    const opened = openSections();
    expect(opened.length).toBeGreaterThan(0);
    // Folded during the search, then the search cleared and typed again.
    const first = shownPanel().querySelector<HTMLElement>(
      `[data-section="${opened[0]}"] [data-slot="accordion-trigger"]`
    );
    fireEvent.click(first!);
    expect(openSections()).not.toContain(opened[0]);
    type("");
    type("colour");
    expect(openSections()).toContain(opened[0]);
  });

  it("stays while another block is selected", () => {
    mount();
    type("colour");
    act(() => editor().select("spacer"));
    expect(search().value).toBe("colour");
  });

  it("is reached with / from the panel, outside a text field", () => {
    mount();
    const panel = document.querySelector<HTMLElement>(".nx-inspector")!;
    fireEvent.keyDown(tab("Content"), { key: "/" });
    expect(document.activeElement).toBe(search());
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("announces what it found once typing pauses", () => {
    vi.useFakeTimers();
    mount();
    type("colour");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    const region = document.querySelector(
      '.nx-settings-search [aria-live="polite"]'
    );
    expect(region?.textContent).toMatch(/^\d+ settings? found: /);
  });
});

describe("Only changed", () => {
  function toggle(): HTMLElement {
    return screen.getByRole("button", { name: "Only changed" });
  }

  it("is a pressed button", () => {
    mount();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps in Style what is set here, and says where else, with links", () => {
    mount();
    openTab("Style");
    fireEvent.click(toggle());
    expect(shownProperties()).toEqual(["backgroundColor"]);
    const line = screen.getByText(/^Also changed on/);
    expect(line.textContent).toBe("Also changed on Hover (1)");
    fireEvent.click(within(line).getByRole("button", { name: "Hover (1)" }));
    expect(onState).toHaveBeenCalledWith("hover");
  });

  it("keeps in Content the settings the block holds", () => {
    mount();
    openTab("Content");
    fireEvent.click(toggle());
    expect(screen.getByLabelText("Label")).toBeDefined();
    expect(
      screen.queryByLabelText("Accessible label")?.closest("[hidden]")
    ).not.toBeNull();
  });

  it("says when a block holds nothing", () => {
    mount("spacer");
    fireEvent.click(toggle());
    expect(shownPanel().textContent).toContain(
      "Nothing changed on this block yet."
    );
  });
});

/** The Style tab's open sections, by key. */
function openSections(): string[] {
  return [
    ...shownPanel().querySelectorAll<HTMLElement>(
      '[data-section] > [data-state="open"], [data-section][data-state="open"]'
    ),
  ].map(
    each =>
      (each.closest("[data-section]") as HTMLElement).dataset.section ?? ""
  );
}
