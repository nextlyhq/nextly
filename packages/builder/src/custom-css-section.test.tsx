// @vitest-environment jsdom

/**
 * Advanced › Custom CSS on a Button, through the real editor
 * (`useEditorState`), for a person given the access (a manager) and one
 * without it (an editor): where the section sits and how it folds, what
 * leaving the box or Apply stores, the Style tab's line and its Edit link,
 * and what "Find a setting" and "Only changed" make of it.
 *
 * The checker here is a stand-in that refuses by line as the page builder's
 * does; the plugin's own test runs the real one through the same access.
 *
 * @module custom-css-section.test
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BlockCustomCssAccess } from "./custom-css";
import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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
});

/** Refuses as the page builder's checker does: by line, with the reason. */
function refusedLines(css: string): string[] {
  return css.split("\n").flatMap((line, at) => {
    const number = at + 1;
    const text = line.trim();
    if (text.startsWith("@import")) {
      return [`Line ${String(number)}: @import isn't allowed.`];
    }
    if (/url\(\s*["']?(https?:)?\/\//.test(text)) {
      return [`Line ${String(number)}: url() must be a path on this site.`];
    }
    if (text.includes("{") && !text.startsWith("selector")) {
      return [`Line ${String(number)}: Start this rule from selector.`];
    }
    return [];
  });
}

const MANAGER: BlockCustomCssAccess = { check: refusedLines };

/** The CSS a Button already holds in the cases that start with some. */
const STORED = "selector { padding: 7px; }";

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;

function Host({
  page,
  access,
}: {
  page: BlockDocument;
  access: BlockCustomCssAccess | undefined;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  return (
    <InspectorPanel
      editor={state}
      {...(access === undefined ? {} : { customCss: access })}
    />
  );
}

/** A page with one Button, holding `css` when given, selected in the panel. */
function mount(access: BlockCustomCssAccess | undefined, css?: string): void {
  const block = coreBlocks.find(each => each.name === "core/button");
  if (block === undefined) throw new Error("core/button is not a core block");
  const button = {
    id: "button",
    type: "core/button",
    version: block.version,
    props: { label: "Get a quote" },
    ...(css === undefined ? {} : { customCss: css }),
  } as BlockNode;
  const page = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [button],
  } as BlockDocument;
  render(<Host page={page} access={access} />);
  act(() => editor().select("button"));
}

// By the start of its name: while a filter is on, a tab's name ends with its
// count of matches.
const choose = (name: string): void => {
  fireEvent.mouseDown(
    screen.getByRole("tab", { name: new RegExp(`^${name}`) })
  );
};
const panel = (name: string): HTMLElement =>
  screen.getByRole("tabpanel", { name });
const section = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-section="custom-css"]');
const header = (): HTMLElement =>
  section()!.querySelector<HTMLElement>('[data-slot="accordion-trigger"]')!;
const box = (): HTMLTextAreaElement =>
  screen.getByRole("textbox", { name: "Custom CSS" }) as HTMLTextAreaElement;
const stored = (): unknown =>
  findNode(editor().document.nodes, "button")?.customCss;

/** Advanced shown with Custom CSS opened, as an author opens it. */
function openSection(): void {
  choose("Advanced");
  if (header().getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header());
  }
}

/** Every value the panel's text boxes hold. */
const boxValues = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLTextAreaElement>("textarea, input")].map(
    field => field.value
  );

describe("Advanced › Custom CSS", () => {
  it("is the last section of a Button's Advanced, after Visibility and HTML", () => {
    mount(MANAGER);
    choose("Advanced");
    expect(
      [
        ...panel("Advanced").querySelectorAll(
          "[data-section] > h3 .nx-style-inspector__section-label"
        ),
      ].map(label => label.firstChild?.textContent)
    ).toEqual(["Visibility", "HTML", "Custom CSS"]);
  });

  it("stays folded while the block holds CSS, its dot showing", () => {
    mount(MANAGER, STORED);
    choose("Advanced");
    // Visibility opens as the tab's first section: folds still open by rule.
    expect(
      panel("Advanced")
        .querySelector(
          '[data-section="visibility"] [data-slot="accordion-trigger"]'
        )
        ?.getAttribute("aria-expanded")
    ).toBe("true");
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(within(header()).getByText("has changes")).toBeTruthy();
  });

  it("holds the hint and the box once opened", () => {
    mount(MANAGER);
    openSection();
    const opened = section()!;
    expect(opened.textContent).toContain(
      "Write selector for this block: selector { color: red; }. Applies to this block only, on every device."
    );
    expect(box().getAttribute("spellcheck")).toBe("false");
    expect(within(opened).getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("is not drawn for a person without the permission, nor is the CSS", () => {
    mount(undefined, STORED);
    for (const tab of ["Content", "Style", "Advanced"]) {
      choose(tab);
      expect(panel(tab).textContent).not.toContain("padding: 7px");
      expect(boxValues(panel(tab)).join("\n")).not.toContain("padding: 7px");
    }
    expect(section()).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Custom CSS", hidden: true })
    ).toBeNull();
  });
});

describe("leaving the box or pressing Apply", () => {
  it("stores accepted CSS in one undoable step, and undo and redo follow", async () => {
    mount(MANAGER);
    openSection();
    const before = editor().undoDepth;
    fireEvent.change(box(), { target: { value: STORED } });
    fireEvent.blur(box());
    expect(stored()).toBe(STORED);
    expect(editor().undoDepth).toBe(before + 1);

    await act(async () => {
      await editor().undo();
    });
    expect(stored()).toBeUndefined();
    expect(box().value).toBe("");

    await act(async () => {
      await editor().redo();
    });
    expect(stored()).toBe(STORED);
    expect(box().value).toBe(STORED);
  });

  it.each([
    [
      "an @import",
      "selector {\n  padding: 4px;\n}\n@import url(/x.css);",
      ["Line 4: @import isn't allowed."],
    ],
    [
      "a rule without selector",
      "selector { padding: 4px; }\nh2 { margin: 0; }",
      ["Line 2: Start this rule from selector."],
    ],
    [
      "a url() to another site",
      "selector {\n  background: url(https://elsewhere.test/a.png);\n}",
      ["Line 2: url() must be a path on this site."],
    ],
  ])(
    "names each refused line of %s and stores nothing",
    (_case, css, lines) => {
      mount(MANAGER);
      openSection();
      const before = editor().undoDepth;
      fireEvent.change(box(), { target: { value: css } });
      fireEvent.click(
        within(section()!).getByRole("button", { name: "Apply" })
      );
      const alert = within(section()!).getByRole("alert");
      expect(
        within(alert)
          .getAllByRole("listitem")
          .map(item => item.textContent)
      ).toEqual(lines);
      expect(stored()).toBeUndefined();
      expect(editor().undoDepth).toBe(before);
      // The author's text stays in the box to be fixed.
      expect(box().value).toBe(css);
    }
  );

  it("writes nothing when the box is left as it was filled", () => {
    // White space alone reads as no CSS, but leaving it untouched is no edit.
    mount(MANAGER, "  ");
    openSection();
    const before = editor().undoDepth;
    fireEvent.focus(box());
    fireEvent.blur(box());
    expect(editor().undoDepth).toBe(before);
    expect(stored()).toBe("  ");
  });

  it("empties the block's CSS when the box is cleared", () => {
    mount(MANAGER, STORED);
    openSection();
    fireEvent.change(box(), { target: { value: "  " } });
    fireEvent.blur(box());
    expect(
      Object.hasOwn(findNode(editor().document.nodes, "button")!, "customCss")
    ).toBe(false);
  });
});

describe("the Style tab", () => {
  it("tells a manager the block has custom CSS, and Edit opens and focuses the box", async () => {
    mount(MANAGER, STORED);
    choose("Style");
    const line = within(panel("Style")).getByText(
      "This block also has custom CSS ·",
      { exact: false }
    );
    expect(line.textContent).toBe("This block also has custom CSS · Edit");
    fireEvent.click(within(line).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(
      screen
        .getByRole("tab", { name: "Advanced" })
        .getAttribute("aria-selected")
    ).toBe("true");
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("tells an editor who can change it, with no link", () => {
    mount(undefined, STORED);
    choose("Style");
    const line = within(panel("Style")).getByText(
      "This block also has custom CSS, set by someone who can change site code."
    );
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("says nothing for a block without custom CSS", () => {
    mount(MANAGER);
    choose("Style");
    expect(
      within(panel("Style")).queryByText("This block also has custom CSS", {
        exact: false,
      })
    ).toBeNull();
  });

  it("never draws the CSS or a CSS box, even for a manager", () => {
    mount(MANAGER, STORED);
    choose("Style");
    const style = panel("Style");
    expect(style.textContent).not.toContain("padding: 7px");
    expect(boxValues(style).join("\n")).not.toContain("padding: 7px");
    expect(
      within(style).queryByRole("textbox", { name: "Custom CSS", hidden: true })
    ).toBeNull();
  });
});

describe("Find a setting and Only changed", () => {
  it('finds Custom CSS by "code" for a manager', () => {
    mount(MANAGER);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a setting" }),
      {
        target: { value: "code" },
      }
    );
    choose("Advanced");
    expect(section()?.hidden).toBe(false);
  });

  it("counts a block's custom CSS under Only changed, and not a block without", () => {
    mount(MANAGER, STORED);
    fireEvent.click(screen.getByRole("button", { name: "Only changed" }));
    choose("Advanced");
    expect(section()?.hidden).toBe(false);
    cleanup();
    clearBlocks();
    registerBlocks(coreBlocks as never, { source: "core" });
    mount(MANAGER);
    fireEvent.click(screen.getByRole("button", { name: "Only changed" }));
    choose("Advanced");
    expect(section()?.hidden).toBe(true);
  });
});
