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

import { describe, expect, it } from "vitest";

import { CODE_TAG_SPECS } from "../code-highlight";
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

/** Every token the palette can put on screen. */
function consumedTokens(): Set<string> {
  return new Set(Object.values(CODE_CONSTRUCTS).map(entry => entry.token));
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
    const chrome = new Set(["--nx-code-bg", "--nx-code-fg"]);
    const consumed = consumedTokens();
    const unreachable = [...codeTokensIn(":root")].filter(
      token => !chrome.has(token) && !consumed.has(token)
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
    const unknown = CODE_TAG_SPECS.filter(
      spec => !(spec.construct in CODE_CONSTRUCTS)
    ).map(spec => spec.construct);
    expect(unknown).toEqual([]);
  });

  it("gives every spec at least one tag", () => {
    const empty = CODE_TAG_SPECS.filter(
      spec => (Array.isArray(spec.tag) ? spec.tag.length : 1) === 0
    );
    expect(empty).toEqual([]);
  });
});
