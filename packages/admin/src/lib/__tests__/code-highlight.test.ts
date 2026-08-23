/**
 * The code palette is data, and the defect it guards against is a literal
 * colour where the theme already names one. A hex renders the same in light and
 * dark, and it never enters the contrast audit in
 * `packages/ui/src/styles/contrast` -- which is the state this module exists to
 * end.
 *
 * The theme file is parsed rather than mirrored here. A hand-kept list of token
 * names is a second implementation of the palette, and it would agree with the
 * theme on the day it was written and drift silently afterwards.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CODE_TAG_SPECS } from "../code-highlight";

const here = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(here, "../../../../ui/src/styles/theme.css");

/**
 * Every `--nx-code-*` token the theme declares.
 *
 * Read from `:root` and `.dark` alike: a token is declared twice by design, and
 * a Set collapses the pair to the one name both halves define.
 */
function declaredCodeTokens(): Set<string> {
  const css = readFileSync(THEME, "utf8");
  const found = new Set<string>();
  for (const match of css.matchAll(/^\s*(--nx-code-[a-z-]+)\s*:/gm)) {
    found.add(match[1]);
  }
  return found;
}

/** Every token the tag specs actually read. */
function consumedTokens(): Set<string> {
  const found = new Set<string>();
  for (const spec of CODE_TAG_SPECS) {
    const match = /var\((--nx-[a-z-]+)\)/.exec(spec.color);
    if (match) found.add(match[1]);
  }
  return found;
}

describe("code-highlight", () => {
  it("reads the theme file it is measured against", () => {
    // The three assertions below are all satisfied by an empty palette, so each
    // would pass against a path that no longer resolves. This is the positive
    // control that says the file was found and parsed.
    expect(declaredCodeTokens().size).toBeGreaterThan(0);
  });

  it("names a colour only through a token, never a literal", () => {
    const literals = CODE_TAG_SPECS.filter(
      spec => !/^var\(--nx-[a-z-]+\)$/.test(spec.color)
    );
    expect(literals.map(spec => spec.color)).toEqual([]);
  });

  it("reads only tokens the theme declares", () => {
    const declared = declaredCodeTokens();
    const stranded = [...consumedTokens()].filter(
      token => token.startsWith("--nx-code-") && !declared.has(token)
    );
    expect(stranded).toEqual([]);
  });

  it("leaves no declared code token unreachable", () => {
    // A token nobody reads is a palette entry that cannot reach the screen.
    // `--nx-code-bg` and `--nx-code-fg` are chrome rather than tag colours, so
    // `nextlyEditorChrome` consumes them instead of a tag spec.
    const chrome = new Set(["--nx-code-bg", "--nx-code-fg"]);
    const consumed = consumedTokens();
    const unreachable = [...declaredCodeTokens()].filter(
      token => !chrome.has(token) && !consumed.has(token)
    );
    expect(unreachable).toEqual([]);
  });

  it("gives every spec at least one tag", () => {
    const empty = CODE_TAG_SPECS.filter(
      spec => (Array.isArray(spec.tag) ? spec.tag.length : 1) === 0
    );
    expect(empty).toEqual([]);
  });
});
