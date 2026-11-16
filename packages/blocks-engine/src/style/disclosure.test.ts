/**
 * An Accordion's icon choices: what each keyword writes on its sections, and
 * that nothing it writes reaches past its own sections.
 *
 * @module style/disclosure.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import { compileStyleValues } from "./declarations";
import {
  DISCLOSURE_ICON_EXPANSIONS,
  DISCLOSURE_ICON_PROPERTY,
  DISCLOSURE_POSITION_PROPERTY,
} from "./disclosure";
import { DISCLOSURE_ICON_CLASS, nodeClassName } from "./node-class";

/** The declarations one stored value writes, as `descendant { property: value }`. */
function written(values: Record<string, unknown>): string[] {
  return compileStyleValues(values, "/s").declarations.map(each =>
    `${each.descendant ?? ""} { ${each.property}: ${each.value} }`.trim()
  );
}

const ICON = `> details > summary > .${DISCLOSURE_ICON_CLASS}`;
const OPEN_ICON = `> details[open] > summary > .${DISCLOSURE_ICON_CLASS}`;

describe("an Accordion's icon", () => {
  it("is traced by its own property, carrying the keyword", () => {
    expect(written({ disclosureIcon: "plus" })[0]).toBe(
      `{ ${DISCLOSURE_ICON_PROPERTY}: plus }`
    );
  });

  it("draws a chevron as a row with no marker, turned while open", () => {
    const out = written({ disclosureIcon: "chevron" });
    expect(out).toContain("> details > summary { display: flex }");
    expect(out).toContain("> details > summary { list-style: none }");
    expect(out).toContain(`${ICON} { background-color: currentColor }`);
    expect(
      decodeURIComponent(
        out.find(each => each.startsWith(`${ICON} { mask:`)) ?? ""
      )
    ).toMatch(/m4 6 4 4 4-4/);
    expect(out).toContain(`${OPEN_ICON} { transform: rotate(180deg) }`);
  });

  it("draws a plus that becomes a minus while open", () => {
    const out = written({ disclosureIcon: "plus" });
    const open = decodeURIComponent(
      out.find(each => each.startsWith(`${OPEN_ICON} { mask:`)) ?? ""
    );
    expect(open).toMatch(/M3\.5 8h9/);
    expect(open).not.toMatch(/M8 3\.5v9/);
  });

  it("sets every open look it uses, so a choice made at one device overrides another's", () => {
    // Plus at a wider device leaves a minus and no turn on open; Chevron at a
    // narrower one must put its own glyph back as well as turn it, and Plus
    // must undo a wider Chevron's turn.
    const chevron = written({ disclosureIcon: "chevron" });
    expect(
      decodeURIComponent(
        chevron.find(each => each.startsWith(`${OPEN_ICON} { mask:`)) ?? ""
      )
    ).toMatch(/m4 6 4 4 4-4/);
    expect(written({ disclosureIcon: "plus" })).toContain(
      `${OPEN_ICON} { transform: none }`
    );
  });

  it("draws no icon for None, the whole title still the row", () => {
    const out = written({ disclosureIcon: "none" });
    expect(out).toContain("> details > summary { list-style: none }");
    expect(out).toContain(`${ICON} { display: none }`);
  });

  it("restores the browser's marker for Browser default, over a row set elsewhere", () => {
    // A block default of Chevron makes the summary a row with no marker; set
    // on the node, Browser default rolls both back to the browser's own.
    const out = written({ disclosureIcon: "browser" });
    expect(out).toContain(`${ICON} { display: none }`);
    expect(out).toContain("> details > summary { display: revert }");
    expect(out).toContain("> details > summary { list-style: revert }");
  });

  it("expands a keyword stored in any spelling the validator accepts", () => {
    for (const spelling of [" PLUS ", "Plus", "pl\\75s"]) {
      expect(written({ disclosureIcon: spelling })).toContain(
        `${ICON} { background-color: currentColor }`
      );
    }
  });

  it("writes its own property alone for a CSS-wide keyword", () => {
    expect(written({ disclosureIcon: "inherit" })).toEqual([
      `{ ${DISCLOSURE_ICON_PROPERTY}: inherit }`,
    ]);
  });

  it("has a declaration set for every keyword it offers", () => {
    for (const [, expansion] of Object.entries(DISCLOSURE_ICON_EXPANSIONS)) {
      expect(expansion.length).toBeGreaterThan(0);
    }
  });
});

describe("an Accordion's icon position", () => {
  it("puts the icon after the title, at the far edge, for After", () => {
    const out = written({ disclosurePosition: "after" });
    expect(out[0]).toBe(`{ ${DISCLOSURE_POSITION_PROPERTY}: after }`);
    expect(out).toContain(`${ICON} { order: 1 }`);
    expect(out).toContain(`${ICON} { margin-inline-start: auto }`);
  });

  it("keeps the icon first for Before", () => {
    expect(written({ disclosurePosition: "before" })).toContain(
      `${ICON} { order: 0 }`
    );
  });
});

describe("an Accordion's icon, compiled on a page", () => {
  /** A node as stored, with the given styles. */
  const node = (id: string, styles?: unknown, nodes?: BlockNode[]) =>
    ({
      id,
      type: "core/box",
      version: 1,
      props: {},
      ...(styles === undefined ? {} : { styles }),
      ...(nodes === undefined ? {} : { slots: { children: nodes } }),
    }) as unknown as BlockNode;

  it("reaches only its own sections, through child selectors", () => {
    const out = compilePageCss(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [node("a", { base: { base: { disclosureIcon: "plus" } } })],
      } as BlockDocument,
      { breakpoints: FIXTURE_BREAKPOINTS }
    ).css;
    const own = `.${nodeClassName("a")}`;
    expect(out).toContain(
      `${own} > details > summary > .${DISCLOSURE_ICON_CLASS} {`
    );
    expect(out).toContain(
      `${own} > details[open] > summary > .${DISCLOSURE_ICON_CLASS} {`
    );
    // Never a descendant combinator, which would reach a nested accordion's
    // sections through this one's.
    expect(out).not.toMatch(new RegExp(`${own} details`));
  });
});
