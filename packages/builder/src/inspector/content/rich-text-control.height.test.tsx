// @vitest-environment jsdom
/**
 * A Rich text's field in the panel is at least four lines high, grows with
 * its words, and is the same size focused as before: it never looks like a
 * one-line input, and focusing it does not make it jump.
 *
 * jsdom lays nothing out and applies no custom properties, so the height is
 * asserted where it is decided: the field's rules in the composed chrome
 * stylesheet (four of the field's own lines at least, no fixed or largest
 * height, nothing a focus or an attached editor changes the box by), and the
 * words it shows before the editor attaches (one line per block, as the
 * editor lays them out after). The browser test measures the pixels
 * (`e2e/tests/builder-rich-text-toolbar.spec.ts`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentServices } from "./content-services";
import { passagePreview, RichTextField } from "./rich-text-control";
import { chromeStylesheetSource } from "../../styles/chrome-stylesheet";

afterEach(() => cleanup());

const SHEET = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

/** Every style rule of the sheet, innermost, with its declarations. */
function rules(sheet: string): Rule[] {
  const found: Rule[] = [];
  for (const match of sheet.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const part of (match[2] ?? "").split(";")) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      declarations.set(
        part.slice(0, colon).trim(),
        part
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, " ")
      );
    }
    found.push({
      selector: (match[1] ?? "").trim().replace(/\s+/g, " "),
      declarations,
    });
  }
  return found;
}

const FIELD = ".nx-inspector__rich-text";
const FIELD_RULES = rules(SHEET).filter(rule => rule.selector.includes(FIELD));

/** The field's own rule, the one that draws it. */
function fieldRule(): Rule {
  const own = FIELD_RULES.filter(rule => rule.selector === FIELD);
  expect(own).toHaveLength(1);
  return own[0] as Rule;
}

/** Properties that change the size of the field's box. */
const SIZING = [
  "height",
  "min-height",
  "max-height",
  "block-size",
  "min-block-size",
  "max-block-size",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-block",
  "border",
  "border-width",
  "border-top",
  "border-bottom",
  "border-block",
  "font-size",
  "line-height",
  "font",
];

describe("the field's height", () => {
  it("is at least four of its own lines, with its padding and edge", () => {
    const rule = fieldRule();
    expect(rule.declarations.get("line-height")).toBe(
      "var(--nx-builder-line-height)"
    );
    expect(rule.declarations.get("min-height")).toBe(
      "calc(4 * var(--nx-builder-line-height) + 0.75rem + 2px)"
    );
    // The 0.75rem and 2px are the padding and the edge it declares.
    expect(rule.declarations.get("padding")).toBe("0.375rem 0.5rem");
    expect(rule.declarations.get("border")).toBe("1px solid var(--nx-input)");
  });

  it("grows with its words: no fixed or largest height, nothing clipped", () => {
    for (const rule of FIELD_RULES) {
      for (const property of [
        "height",
        "max-height",
        "block-size",
        "max-block-size",
        "overflow",
        "overflow-y",
      ]) {
        expect(
          rule.declarations.has(property),
          `${rule.selector} sets ${property}`
        ).toBe(false);
      }
    }
  });

  it("is not changed by focus, nor by the editor attaching", () => {
    const changing = FIELD_RULES.filter(rule =>
      /:focus|\[contenteditable|\[data-lexical-editor|\[aria-busy|\[style/.test(
        rule.selector
      )
    );
    // The focus ring is the one rule, and it moves no edge.
    expect(changing.length).toBeGreaterThan(0);
    for (const rule of changing) {
      for (const property of SIZING) {
        expect(
          rule.declarations.has(property),
          `${rule.selector} sets ${property}`
        ).toBe(false);
      }
      const offset = rule.declarations.get("outline-offset");
      if (offset !== undefined)
        expect(Number.parseFloat(offset)).toBeLessThanOrEqual(0);
    }
  });

  it("keeps the editor's blocks on the field's own lines", () => {
    const blocks = FIELD_RULES.find(rule =>
      rule.selector.includes(`${FIELD} > :is(p, h1, h2`)
    );
    expect(blocks?.declarations.get("margin-block")).toBe("0");
    expect(blocks?.declarations.get("font-size")).toBe("inherit");
    expect(blocks?.declarations.get("line-height")).toBe("inherit");
    expect(fieldRule().declarations.get("white-space")).toBe("pre-wrap");
  });
});

const text = (words: string) => ({ type: "text", text: words, format: 0 });

const PASSAGE = {
  root: {
    type: "root" as const,
    children: [
      { type: "paragraph", children: [text("One")] },
      { type: "heading", tag: "h2", children: [text("Two")] },
      {
        type: "list",
        listType: "bullet",
        children: [
          { type: "listitem", children: [text("Three")] },
          { type: "listitem", children: [text("Four")] },
        ],
      },
    ],
  },
};

describe("the field's words before and after focus", () => {
  it("shows one line per block and per list item, as the editor will", () => {
    expect(passagePreview(PASSAGE)).toBe("One\nTwo\nThree\nFour");
  });

  it("is drawn with them unfocused, and handed to the editor whole on focus", async () => {
    const attach = vi.fn(() => ({
      status: "attached" as const,
      session: {
        focus: vi.fn(),
        read: vi.fn(() => PASSAGE),
        detach: vi.fn(),
        hold: vi.fn(),
      },
    }));
    const services = {
      loadRichTextEditor: vi.fn(async () => ({ attach })),
    } as unknown as ContentServices;
    render(
      <>
        <span id="content-label">Text</span>
        <RichTextField
          id="content"
          labelledBy="content-label"
          value={PASSAGE}
          disabled={false}
          onCommit={() => undefined}
          services={services}
        />
      </>
    );
    const box = screen.getByRole("textbox", { name: "Text" });
    expect(box.textContent).toBe("One\nTwo\nThree\nFour");
    const before = {
      className: box.className,
      style: box.getAttribute("style"),
    };
    await act(async () => {
      fireEvent.focus(box);
    });
    expect(attach).toHaveBeenCalledWith(box, PASSAGE);
    // The field keeps its class and gains no inline size of its own.
    expect({
      className: box.className,
      style: box.getAttribute("style"),
    }).toEqual(before);
  });
});
