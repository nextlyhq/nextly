// @vitest-environment jsdom

/**
 * A heading's Text section while its size comes from Site text, with the
 * cascade the canvas compiles from the core blocks and a fresh site's rows.
 *
 * The heading rows point at the site's type sizes, so the size reaching an
 * empty Font size field is a variable, `var(--…-font-size-h2)`. The field
 * still offers its units, as over any empty field, and never shows that CSS:
 * it shows the size the canvas resolves the variable to where it is known,
 * and nothing where it is not.
 *
 * @module inherited-site-text-size.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  defaultSiteTokens,
  registerBlocks,
  STYLE_CATALOG,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { createBlockResolver, pageStyleTrace } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import type { EditorState } from "../../editor-state";
import { InheritedValue } from "./inherited-value";
import { RenderedLengths } from "./rendered-lengths";
import { styleControlsFor } from "../../style-controls";
import { NumericField } from "./style-numeric-field";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});
beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const LTR = { writingMode: "horizontal-tb", direction: "ltr" } as const;

/** One Heading 2 with nothing of its own set. */
const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "core/heading",
      version: 1,
      props: { text: "A heading", level: "h2" },
    },
  ],
} as unknown as BlockDocument;

/** The Style tab of the heading, its Text section open. */
function textSection(around?: (panel: React.JSX.Element) => React.JSX.Element) {
  const cascade = pageStyleTrace({
    document: PAGE,
    styleContext: {
      breakpoints: {
        viewport: [{ id: BASE_BREAKPOINT, label: "Desktop" }],
        container: [],
      },
    },
    site: undefined,
    blocks: createBlockResolver(coreBlocks as never),
  });
  const editor = {
    document: PAGE,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => PAGE),
    select: vi.fn(),
    apply: vi.fn(() => PAGE),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
  const panel = (
    <StyleInspectorPanel
      editor={editor}
      tokens={{ tokens: defaultSiteTokens() }}
      sideOrientation={LTR}
      renderedTag="h2"
      cascade={cascade}
    />
  );
  render(around === undefined ? panel : around(panel));
  const text = screen.getByRole("button", { name: /^Text(\s?has changes)?$/ });
  if (text.getAttribute("aria-expanded") !== "true") fireEvent.click(text);
}

/** The Font size field's text box. */
function fontSize(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: /^Font size/,
  }) as HTMLInputElement;
}

describe("a heading's Font size while Site text sets it", () => {
  it("is fed by Site text, as the fixture means", () => {
    // The control: the size reaching the field is the Site text row's.
    textSection();
    expect(
      screen.getByRole("textbox", {
        name: /^Font size\s*From Site text: Heading 2$/,
      })
    ).toBe(fontSize());
  });

  it("offers its units after the variables, as over any empty field", () => {
    textSection();
    const menu = screen.getByRole("combobox", { name: "Unit for Font size" });
    fireEvent.click(menu);
    const options = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(options).toContain("px");
    expect(options).toContain("rem");
  });

  it("never shows the CSS the size reaches it as", () => {
    textSection();
    expect(fontSize().placeholder).not.toContain("var(");
    expect(fontSize().placeholder).not.toContain("--");
  });

  it("shows the size the canvas draws it at, beside its unit", () => {
    // Where the canvas has measured the heading: 36px at this device.
    textSection(panel => (
      <RenderedLengths.Provider value={{ "font-size": "36px" }}>
        {panel}
      </RenderedLengths.Provider>
    ));
    expect(fontSize().placeholder).toBe("36");
    expect(
      screen.getByRole("combobox", { name: "Unit for Font size" }).textContent
    ).toBe("px");
  });
});

describe("a size field handed a variable as the value reaching it", () => {
  it("still lists its units: the next number takes the one chosen", () => {
    // Handed straight to the field, as a caller other than the Style tab's
    // fields may: the unit menu acts on an empty field over a variable.
    const property = STYLE_CATALOG.find(each => each.property === "fontSize");
    if (property === undefined) throw new Error("no fontSize in the catalog");
    const [control] = styleControlsFor(property).controls;
    if (control === undefined) throw new Error("fontSize has no control");
    render(
      <InheritedValue.Provider value="var(--site-font-size-h2)">
        <NumericField
          id="size"
          control={control}
          stored={undefined}
          tokens={undefined}
          actionName="Font size"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </InheritedValue.Provider>
    );
    expect(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    ).toBeDefined();
  });
});
