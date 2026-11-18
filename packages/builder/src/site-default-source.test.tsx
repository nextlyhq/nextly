// @vitest-environment jsdom

/**
 * Where a new Section's padding comes from, in the Style tab: "Site default:
 * Section spacing" under the spacing box, each padding side named by the
 * variable it reads, and nothing of the kind on a new Box, whose padding is
 * 0. The cascade is the one the canvas compiles, from the core blocks.
 *
 * @module site-default-source.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  defaultSiteTokens,
  registerBlocks,
  type BlockDocument,
  type StyleTraceEntry,
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

import type { EditorState } from "./editor-state";
import { siteDefaultSource } from "./site-default-source";
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

/** A block as the Add panel inserts it: its type's default props, and nothing set. */
function inserted(type: string): BlockDocument {
  const block = coreBlocks.find(each => each.name === type);
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type,
        version: block?.version ?? 1,
        props: { ...(block?.defaultProps as object) },
        slots: { children: [] },
      },
    ],
  } as unknown as BlockDocument;
}

/** The Style tab of the only block, with the cascade the canvas compiles. */
function styleTab(page: BlockDocument): HTMLElement {
  const cascade = pageStyleTrace({
    document: page,
    styleContext: {
      breakpoints: {
        viewport: [{ id: BASE_BREAKPOINT, label: "Desktop" }],
        container: [],
      },
    },
    site: undefined,
    blocks: createBlockResolver(coreBlocks as never),
  });
  expect(cascade).toBeDefined();
  const editor = {
    document: page,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => page),
    select: vi.fn(),
    apply: vi.fn(() => page),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
  render(
    <StyleInspectorPanel
      editor={editor}
      tokens={{ tokens: defaultSiteTokens() }}
      sideOrientation={LTR}
      cascade={cascade}
    />
  );
  const spacing = screen.getByRole("button", { name: /^Spacing/ });
  if (spacing.getAttribute("aria-expanded") !== "true")
    fireEvent.click(spacing);
  const box = document.querySelector(".nx-spacing-box");
  if (!(box instanceof HTMLElement)) throw new Error("no spacing box drawn");
  return box;
}

/** What a padding side shows, by the name on its label: "Padding top". */
function sideText(box: HTMLElement, name: string): string {
  const label = [
    ...box.querySelectorAll(".nx-style-inspector__field-label-text"),
  ].find(each => each.textContent === name)?.parentElement;
  const button = box.querySelector(
    `[aria-labelledby^="${label?.id ?? "none"} "]`
  );
  if (button === null) throw new Error(`no side labelled ${name}`);
  return button.querySelector(".nx-spacing-side__text")?.textContent ?? "";
}

describe("a new Section's padding in the Style tab", () => {
  it('says it comes from "Site default: Section spacing", once, under the box', () => {
    const box = styleTab(inserted("core/section"));
    const line = box.querySelectorAll("[data-site-default]");
    expect([...line].map(each => each.textContent)).toEqual([
      "Site default: Section spacing",
    ]);
  });

  it("names each side by the variable it reads, rather than by its CSS", () => {
    const box = styleTab(inserted("core/section"));
    expect(sideText(box, "Padding top")).toBe(
      "Section padding (top and bottom)"
    );
    expect(sideText(box, "Padding left")).toBe("Section padding (sides)");
    expect(box.textContent).not.toContain("var(");
  });
});

describe("a new Section's padding side", () => {
  it('names its source "Site default" in brief, and in full on its dot', () => {
    const box = styleTab(inserted("core/section"));
    const sides = box.querySelectorAll('[data-property="padding"] [data-side]');
    expect(sides).toHaveLength(4);
    for (const side of sides) {
      expect(
        side.querySelector(".nx-style-inspector__provenance-source")
          ?.textContent
      ).toBe("Site default");
      expect(
        side
          .querySelector(".nx-style-inspector__provenance")
          ?.getAttribute("aria-label")
      ).toBe("Site default: Section spacing");
    }
  });
});

describe("a new Box's padding in the Style tab", () => {
  it("is 0, with no site default named", () => {
    const box = styleTab(inserted("core/box"));
    expect(box.querySelector("[data-site-default]")).toBeNull();
    expect(sideText(box, "Padding top")).toBe("–");
  });
});

describe("naming a site default", () => {
  const entry = (value: string): StyleTraceEntry =>
    ({
      origin: { kind: "blockType", type: "core/section" },
      property: "padding-block-start",
      value,
      state: "base",
      breakpoint: BASE_BREAKPOINT,
    }) as StyleTraceEntry;
  const fromDefaults = { kind: "blockType", type: "core/section" } as const;

  it("names a block default reading the section spacing under the compile's prefix", () => {
    for (const value of [
      "var(--site-space-section-y)",
      "var(--site-space-gutter)",
    ]) {
      expect(siteDefaultSource(fromDefaults, entry(value), "--site-")).toBe(
        "Site default: Section spacing"
      );
    }
    expect(
      siteDefaultSource(
        fromDefaults,
        entry("var(--brand-space-gutter)"),
        "--brand-"
      )
    ).toBe("Site default: Section spacing");
  });

  it("names nothing for another variable, another prefix, a typed value or another tier", () => {
    expect(
      siteDefaultSource(
        fromDefaults,
        entry("var(--site-space-card)"),
        "--site-"
      )
    ).toBeUndefined();
    expect(
      siteDefaultSource(
        fromDefaults,
        entry("var(--brand-space-gutter)"),
        "--site-"
      )
    ).toBeUndefined();
    expect(
      siteDefaultSource(fromDefaults, entry("48px"), "--site-")
    ).toBeUndefined();
    expect(
      siteDefaultSource(
        { kind: "node", id: "a" },
        entry("var(--site-space-gutter)"),
        "--site-"
      )
    ).toBeUndefined();
  });
});
