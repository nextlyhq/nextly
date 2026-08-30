/**
 * The published specificity table, checked against the compiler that produces it.
 *
 * `docs/override-contract.md` tells site authors which selectors the builder
 * emits and what each weighs, so they can write CSS that beats one deliberately.
 * It is a CONTRACT: a reader plans an override from the table without compiling
 * anything, and a row that no longer matches sends them to write a rule that
 * cannot win — the failure being that their CSS silently does nothing.
 *
 * Nothing tied the table to the compiler, and the table went stale the first
 * time the tiers moved: block defaults were documented at `0-3-0` while being
 * emitted at `0-1-0`, which is the exact case where a reader's override would
 * have worked and they would not have tried it.
 *
 * So the rows are parsed out of the shipped markdown and matched against real
 * output. The document is the fixture; the compiler is the oracle.
 *
 * @module style/__tests__/override-contract.doc
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { BlockDocument } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import { nodeClassName } from "./node-class";

/** The placeholder node class the document uses in every example. */
const DOC_NODE_CLASS = "nx-pb-a1b2";

/**
 * One document exercising every tier the table has a row for.
 *
 * One compile rather than one per row, because the table is a claim about a
 * single stylesheet: rows compiled apart could each be right while no page ever
 * carries them together.
 */
function contractCss(): string {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/section",
        version: 1,
        props: {},
        // Produces the doubled-class hiding row.
        visibility: { devices: { mobile: false } },
        styles: {
          base: {
            base: {
              color: "#333",
              // `linkColor` and `linkColorHover` carry a descendant and a state
              // into the selector, which is what the last three rows describe.
              linkColor: "#444",
              linkColorHover: "#555",
            },
          },
        },
      },
      {
        // Carries the row for an element a block draws inside itself. A second
        // node rather than a part bolted onto the section above, because the
        // table is read as a worked example and a section does not draw a
        // caption — a row nobody could meet in a real document teaches the
        // wrong thing even while the compiler emits it.
        id: "n2",
        type: "core/image",
        version: 1,
        props: {},
      },
    ],
    settings: {
      styles: { base: { base: { color: "#111", linkColor: "#222" } } },
    },
  } as unknown as BlockDocument;

  const compiled = compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    elementBases: { h1: { base: { base: { fontSize: "2.25rem" } } } },
    blockBases: {
      "core/section": { base: { base: { backgroundColor: "#eee" } } },
    },
    blockParts: {
      "core/image": {
        caption: {
          selector: "figcaption",
          baseStyles: { base: { base: { fontSize: "0.875em" } } },
        },
      },
    },
  });

  // A warning means a fixture value was dropped, and a dropped value emits no
  // rule — so a row would go missing for a reason that has nothing to do with
  // the contract. Checked here rather than left to a confusing absence below.
  expect(compiled.warnings ?? []).toEqual([]);

  // The document writes a placeholder where a real class is a hash of the node
  // id. Substituting makes the two comparable without the table carrying a
  // value no reader could predict.
  return compiled.css.split(nodeClassName("n1")).join(DOC_NODE_CLASS);
}

/** The shipped contract, read once per caller rather than pathed in three. */
function readContract(): string {
  return readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../docs/override-contract.md"
    ),
    "utf8"
  );
}

/**
 * What a selector weighs, as the table writes it: `ids-classes-types`.
 *
 * A counter rather than a parser, over the grammar this compiler actually
 * emits: classes, element types, one level of `:where()`, and the
 * pseudo-classes a descendant selector carries. It is verified against
 * hand-computed values below BEFORE it is used to judge the document — a
 * counter that agreed with a wrong table would make this pin worse than none,
 * since it would report the numbers as checked.
 *
 * `:where()` contributes nothing whatever is inside it, which is the entire
 * mechanism the two default rows rely on.
 */
export function specificityOf(selector: string): string {
  // Remove every `:where(...)` first, innermost outward, so what it holds is
  // never counted. Looped rather than a single regex: `[^)]*` would stop at the
  // first `)`, which is wrong the moment a wrapper contains a functional
  // pseudo-class of its own.
  let rest = selector;
  for (;;) {
    const next = rest.replace(/:where\([^()]*\)/g, " ");
    if (next === rest) break;
    rest = next;
  }

  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  // A class, an attribute selector, or a pseudo-CLASS. `::before` is a
  // pseudo-ELEMENT and counts in the last column, so it is excluded here by
  // requiring the colon not to be doubled.
  const classes =
    (rest.match(/\.[\w-]+/g) ?? []).length +
    (rest.match(/\[[^\]]*\]/g) ?? []).length +
    (rest.match(/(?<!:):[\w-]+/g) ?? []).length;
  // An element name: a bare word that does not follow `.`, `#` or `:`.
  const types =
    (rest.match(/(?<![.#:\w-])[a-z][\w-]*/g) ?? []).length +
    (rest.match(/::[\w-]+/g) ?? []).length;
  return `${ids}-${classes}-${types}`;
}

/** The selector and documented weight of each table row, in document order. */
function documentedRows(): { selector: string; specificity: string }[] {
  const markdown = readContract();
  const rows: { selector: string; specificity: string }[] = [];
  for (const line of markdown.split("\n")) {
    const match =
      /^\|[^|]+\|\s*`(\.nx-pb-page[^`]*)`\s*\|\s*([\d-]+)\s*\|/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      rows.push({ selector: match[1], specificity: match[2] });
    }
  }
  return rows;
}

/**
 * Selectors the document shows in a fenced `css` example, in document order.
 *
 * The table is not the only place the contract makes a claim. The prose above
 * it shows worked examples, and one promised for a long time that EVERY rule
 * carries at least two classes — true before the default tiers existed, and
 * flatly wrong afterwards, with a correct table sitting directly below it. A
 * pin that reads only rows cannot see that.
 */
function exampleSelectors(): string[] {
  /*
   * Scoped to "What the builder emits", because most fences in this document
   * are deliberately NOT ours: a site's own theme, a rule shown losing a
   * contest, an `!important` a reader might reach for. Collecting those would
   * demand the compiler emit `.content .card h1`, which is the opposite of what
   * that example says.
   */
  const markdown = readContract();
  const start = markdown.indexOf("## What the builder emits");
  // A section that stopped existing would silently collect nothing, and the
  // population assertion below is what would then fail — but say why here.
  expect(
    start,
    "override-contract.md has no 'What the builder emits' section"
  ).toBeGreaterThan(-1);
  const rest = markdown.slice(start);
  const end = rest.indexOf("\n---");
  const section = end === -1 ? rest : rest.slice(0, end);

  const selectors: string[] = [];
  for (const block of section.matchAll(/```css\n([\s\S]*?)```/g)) {
    for (const line of (block[1] ?? "").split("\n")) {
      // A rule's opening line: a selector beginning at the page root and ending
      // in `{`. Declarations and closing braces have no such shape.
      const match = /^(\.nx-pb-page[^{]*)\{\s*$/.exec(line.trim());
      if (match?.[1] !== undefined) selectors.push(match[1].trim());
    }
  }
  return selectors;
}

/** The selector column of the specificity table, in document order. */
function documentedSelectors(): string[] {
  const markdown = readContract();
  const rows: string[] = [];
  for (const line of markdown.split("\n")) {
    // A table row whose second cell is a backticked selector beginning at the
    // page-root class. The separator row and prose lines have no such cell.
    const match = /^\|[^|]+\|\s*`(\.nx-pb-page[^`]*)`\s*\|/.exec(line);
    if (match?.[1] !== undefined) rows.push(match[1]);
  }
  return rows;
}

/**
 * Every whole selector this compile emits.
 *
 * A SET of whole selectors rather than a substring search over the sheet:
 * every documented row begins at `.nx-pb-page`, and the doubled root REPEATS
 * that class — so `.nx-pb-page.nx-pb-page :where(h1) {` contains
 * `.nx-pb-page :where(h1) {`, and a default that grew the doubling would be
 * found verbatim in output that no longer emits it. That is the one regression
 * this file was written for, so the comparison is anchored.
 */
function emittedSelectors(): Set<string> {
  return new Set(
    contractCss()
      .split("\n")
      .filter(line => line.includes(" {"))
      .map(line => line.slice(0, line.indexOf(" {")).trim())
  );
}

describe("the published override contract", () => {
  it("documents a selector the compiler actually emits, for every row", () => {
    const selectors = documentedSelectors();
    // Population before the property. A parser that matched nothing would
    // satisfy an empty loop, and the table would be free to say anything.
    expect(selectors.length).toBeGreaterThanOrEqual(8);

    const emitted = emittedSelectors();

    for (const selector of selectors) {
      expect(
        emitted.has(selector),
        `override-contract.md documents \`${selector}\`, which this compile does not emit. ` +
          `Emitted:\n${[...emitted].join("\n")}`
      ).toBe(true);
    }
  });

  it("counts specificity the way the table writes it", () => {
    /*
     * The counter is verified BEFORE it judges the document. A counter that
     * agreed with a wrong table would make this pin worse than no pin at all,
     * because the numbers would be reported as checked.
     *
     * Hand-computed, and chosen to separate the ways a counter goes wrong: a
     * repeated class must count twice, a bare element must land in the last
     * column and not the middle, a pseudo-class must land in the MIDDLE, and
     * everything inside `:where()` must count for nothing however much of it
     * there is.
     */
    expect(specificityOf(".nx-pb-page")).toBe("0-1-0");
    expect(specificityOf(".nx-pb-page.nx-pb-page")).toBe("0-2-0");
    expect(specificityOf(".nx-pb-page.nx-pb-page a")).toBe("0-2-1");
    expect(specificityOf(".nx-pb-page.nx-pb-page .nx-pb-a1b2 a:hover")).toBe(
      "0-4-1"
    );
    // Four, not three: the root class is repeated AND the node class is. Worth
    // stating because the miscount is easy in exactly this direction.
    expect(specificityOf(".nx-pb-page.nx-pb-page .a.a")).toBe("0-4-0");
    // The whole mechanism the default rows depend on.
    expect(specificityOf(".nx-pb-page :where(h1)")).toBe("0-1-0");
    expect(specificityOf(".nx-pb-page :where(.a.b.c h1:hover)")).toBe("0-1-0");
    // A scope inside the wrapper still weighs nothing.
    expect(specificityOf(".nx-pb-page:where(.nx-doc-a) :where(h1)")).toBe(
      "0-1-0"
    );
  });

  it("documents the WEIGHT each selector actually carries", () => {
    // The selector pin above says the row names a rule the compiler emits. It
    // says nothing about the number beside it, so flipping a documented
    // `0-1-0` back to the stale `0-3-0` left every case green while the shipped
    // guidance told readers to write an override that cannot win.
    const rows = documentedRows();
    // Population before the property, and it must match the selector parse or
    // one of the two is reading rows the other cannot see.
    expect(rows).toHaveLength(documentedSelectors().length);
    expect(rows.length).toBeGreaterThanOrEqual(8);

    for (const row of rows) {
      expect(
        specificityOf(row.selector),
        `override-contract.md says \`${row.selector}\` weighs ${row.specificity}.`
      ).toBe(row.specificity);
    }
  });

  it("shows worked examples the compiler also emits, at the weights it emits", () => {
    /*
     * The prose is part of the contract, and it drifted where the table did
     * not: it promised for a long time that EVERY rule carries at least two
     * classes, with a correct table directly below saying two of them carry
     * one. A reader who stopped at the prose planned an override that cannot
     * win, and a pin over rows alone could not see it.
     */
    const examples = exampleSelectors();
    // Population before the property. A fence that stopped being `css`, or a
    // rule written on two lines, would empty this and satisfy the loop.
    expect(examples.length).toBeGreaterThanOrEqual(2);

    const emitted = emittedSelectors();
    for (const selector of examples) {
      expect(
        emitted.has(selector),
        `override-contract.md shows \`${selector}\`, which this compile does not emit.`
      ).toBe(true);
    }
    // And the examples cover BOTH sides of the distinction they exist to draw,
    // so one of them going stale cannot leave the pair looking complete.
    expect(examples.some(one => one.includes(":where("))).toBe(true);
    expect(examples.some(one => !one.includes(":where("))).toBe(true);
  });

  it("keeps every default tier below the doubled root, and every authored tier on it", () => {
    // The rule the table exists to convey, stated once rather than per row: a
    // DEFAULT is overridable with ordinary site CSS and an AUTHORED value is
    // not. The doubled class is what draws that line, so a default that grew
    // it — or an authored tier that lost it — inverts the contract while every
    // selector above still appears verbatim in the document.
    for (const selector of documentedSelectors()) {
      const isDefault = selector.includes(":where(");
      expect(
        selector.startsWith(".nx-pb-page.nx-pb-page"),
        `\`${selector}\` is ${isDefault ? "a default" : "an authored tier"} ` +
          `and ${isDefault ? "must not" : "must"} carry the doubled root.`
      ).toBe(!isDefault);
    }
  });
});
