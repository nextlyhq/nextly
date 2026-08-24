/**
 * The construct table is the palette, and the defects it can still carry all
 * render as a plausible colour rather than as an error.
 *
 * A token declared in only ONE theme block is the quietest of them. The
 * surviving declaration keeps the editor rendering, so nothing looks broken --
 * the other mode simply inherits a colour chosen against the wrong background.
 * Both blocks are parsed separately for that reason; collapsing them into one
 * set is exactly how the half-declared case passes.
 *
 * What is NOT tested here any more is agreement between the two highlighting
 * engines. It used to be, by reading both mappings and comparing them, and that
 * test is gone because `code-palette.ts` made the question unaskable: Prism and
 * lezer now read the same table, so there are no longer two answers to compare.
 * The guard that replaces it is narrower and harder to slip past -- that
 * nothing bypasses the table.
 *
 * The theme file is parsed rather than mirrored. A hand-kept list of token
 * names would be a second implementation of the palette, agreeing with it on
 * the day it was written and drifting silently afterwards.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Tag } from "@lezer/highlight";
import { tags, tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { CODE_TAG_SPECS, nextlyHighlightStyle } from "../code-highlight";
import { CODE_CONSTRUCTS } from "../code-palette";

const here = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(here, "../../../../ui/src/styles/theme.css");
const RICH_TEXT_KIT = resolve(
  here,
  "../../components/features/entries/fields/special/rich-text-kit.ts"
);

/**
 * The body of a top-level block, matched by counting braces rather than by
 * reaching for the next `}`. A nested rule inside the block would end the naive
 * match early and silently shorten the set being checked.
 */
function blockBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return "";
}

/** The `--nx-code-*` tokens one block declares. */
function codeTokensIn(selector: string): Set<string> {
  const body = blockBody(readFileSync(THEME, "utf8"), selector);
  const found = new Set<string>();
  for (const match of body.matchAll(/^\s*(--nx-code-[a-z-]+)\s*:/gm)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * The chrome's own tokens.
 *
 * Consumed by `nextlyEditorChrome` rather than by the construct table, which is
 * why they are named here rather than derived. They still have to be declared
 * in BOTH blocks: losing `--nx-code-fg` from `.dark` leaves code inheriting a
 * foreground picked for a white page.
 */
const CHROME_TOKENS = ["--nx-code-bg", "--nx-code-fg"];

/** Every token that can reach the screen, from the table or from the chrome. */
function consumedTokens(): Set<string> {
  return new Set([
    ...Object.values(CODE_CONSTRUCTS).map(entry => entry.token),
    ...CHROME_TOKENS,
  ]);
}

describe("code-palette", () => {
  it("reads the theme blocks it is measured against", () => {
    // Every assertion below is satisfied by an empty palette, so each would
    // pass against a selector that no longer matches. This is the control that
    // says both blocks were found and parsed.
    expect(codeTokensIn(":root").size).toBeGreaterThan(0);
    expect(codeTokensIn(".dark").size).toBeGreaterThan(0);
  });

  it("spells each construct the same in both namespaces", () => {
    // `--nx-code-string` and `text-code-string` are one name in two
    // vocabularies. Editing either alone gives a construct whose CSS colour and
    // whose utility class point at different tokens, and every other assertion
    // here would still pass.
    const mismatched = Object.entries(CODE_CONSTRUCTS)
      .filter(
        ([, entry]) =>
          entry.token.replace("--nx-code-", "") !==
          entry.className.replace("text-code-", "")
      )
      .map(([name]) => name);
    expect(mismatched).toEqual([]);
  });

  it.each([":root", ".dark"])("declares every token it reads in %s", sel => {
    const declared = codeTokensIn(sel);
    const stranded = [...consumedTokens()].filter(
      token => token.startsWith("--nx-code-") && !declared.has(token)
    );
    expect(stranded).toEqual([]);
  });

  it("leaves no declared code token unreachable", () => {
    // A token nobody reads is a palette entry that cannot reach the screen.
    // `--nx-code-bg` and `--nx-code-fg` are chrome rather than construct
    // colours, so `nextlyEditorChrome` consumes them instead of the table.
    const consumed = consumedTokens();
    const unreachable = [...codeTokensIn(":root")].filter(
      token => !consumed.has(token)
    );
    expect(unreachable).toEqual([]);
  });

  it("routes the rich-text palette through the table", () => {
    // The guard that replaces the old cross-engine comparison. Deriving both
    // engines from one table only holds while both actually read it, and a
    // literal `text-code-*` written back into the Lexical theme would restore
    // the divergence silently -- it renders correctly on the day it is written.
    const kit = readFileSync(RICH_TEXT_KIT, "utf8");
    const literals = [...kit.matchAll(/"(text-code-[a-z-]+)/g)].map(m => m[1]);
    // `text-code-fg` is the code BLOCK's own foreground, not a construct, so it
    // is not in the table and is expected to appear literally.
    expect(literals.filter(cls => cls !== "text-code-fg")).toEqual([]);
  });

  it("reads the rich-text file it is checking", () => {
    // Same control as the theme one: a moved path makes the assertion above
    // pass against an empty string, certifying a file it never opened.
    expect(readFileSync(RICH_TEXT_KIT, "utf8")).toContain("codeHighlight");
  });

  it("names only constructs the table defines", () => {
    // A spec may legitimately carry no construct -- markup weight and
    // decoration modify whatever they sit in rather than recolouring it.
    const unknown = CODE_TAG_SPECS.filter(
      spec =>
        spec.construct !== undefined && !(spec.construct in CODE_CONSTRUCTS)
    ).map(spec => spec.construct);
    expect(unknown).toEqual([]);
  });

  it("gives every spec something to do", () => {
    // A spec with neither a construct nor a decoration silences its tags
    // outright, because this highlighter runs without a fallback: the tag is
    // claimed and then styled with nothing.
    const inert = CODE_TAG_SPECS.filter(
      spec =>
        spec.construct === undefined &&
        spec.fontStyle === undefined &&
        spec.fontWeight === undefined &&
        spec.textDecoration === undefined
    );
    expect(inert).toEqual([]);
  });

  it("gives every spec at least one tag", () => {
    const empty = CODE_TAG_SPECS.filter(
      spec => (Array.isArray(spec.tag) ? spec.tag.length : 1) === 0
    );
    expect(empty).toEqual([]);
  });
});

/**
 * Tags this palette deliberately does not style, each with the reason.
 *
 * The list exists so that leaving a tag out is a DECISION rather than an
 * oversight. `nextlyHighlighting` is registered without a fallback, so an
 * unlisted tag is not merely undecorated -- it is claimed and then rendered as
 * plain foreground, which looks correct in JSON and wrong in Markdown and CSS.
 * Every omission found so far was found by someone opening the right file.
 */
const DELIBERATELY_UNSTYLED: Record<string, string> = {
  // Prose in a Markdown document. Colouring body text would tint the document
  // rather than highlight anything in it.
  content: "ordinary prose, not a construct",
  // The whole editor is already monospaced, so the tag has nothing to add.
  monospace: "every editor surface is already mono",
  // Diff state with no token of its own; `deleted` and `inserted` carry the
  // two cases this admin actually renders.
  changed: "no token; deleted and inserted cover the rendered cases",
};

describe("tag coverage", () => {
  it("styles every standard tag, or says why not", () => {
    // Asked of the BUILT highlighter rather than of `CODE_TAG_SPECS`, because
    // the specs are the input and the highlighter is what CodeMirror consults.
    // The two can disagree -- `t.invalid` is styled by an entry that never
    // appears in the table -- and reading the input would call that tag
    // unstyled while the editor colours it correctly.
    const unaccounted = Object.entries(tags)
      .filter(([, tag]) => typeof tag !== "function")
      .filter(
        ([name, tag]) =>
          nextlyHighlightStyle.style([tag as Tag]) === null &&
          !(name in DELIBERATELY_UNSTYLED)
      )
      .map(([name]) => name);
    expect(unaccounted).toEqual([]);
  });

  it("keeps the unstyled list honest", () => {
    // An entry that IS styled must not also claim to be deliberately skipped:
    // the reason would be false, and the next reader would trust it.
    const contradictory = Object.keys(DELIBERATELY_UNSTYLED).filter(name => {
      const tag = (tags as Record<string, unknown>)[name];
      return (
        tag !== undefined && nextlyHighlightStyle.style([tag as Tag]) !== null
      );
    });
    expect(contradictory).toEqual([]);
  });

  it("styles a parse error from the admin's error token", () => {
    // `t.invalid` is styled by an entry outside the construct table, so nothing
    // in the table's own checks reaches it. Without this, deleting that entry
    // leaves every other assertion green.
    expect(nextlyHighlightStyle.style([t.invalid])).not.toBeNull();
    const rule = nextlyHighlightStyle.module?.getRules() ?? "";
    expect(rule).toContain("--nx-destructive");
  });
});
