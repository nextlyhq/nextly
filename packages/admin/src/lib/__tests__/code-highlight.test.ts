/**
 * The code palette is data, and two defects it guards against both render as a
 * plausible colour rather than as an error.
 *
 * A literal colour is the first: it looks right in whichever mode it was picked
 * for, renders identically in the other, and never enters the contrast audit in
 * `packages/ui/src/styles/contrast`.
 *
 * A token declared in only ONE mode is the second, and it is the quieter one.
 * The surviving declaration keeps the editor rendering, so nothing looks broken
 * -- the other mode simply inherits a colour chosen against the wrong
 * background. Both blocks are therefore parsed separately and each is required
 * to carry every token the palette reads; collapsing them into one set is how
 * the half-declared case passes.
 *
 * The theme file is parsed rather than mirrored here. A hand-kept list of token
 * names would be a second implementation of the palette, agreeing with it on
 * the day it was written and drifting silently afterwards.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Tag } from "@lezer/highlight";
import { tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { CODE_TAG_SPECS } from "../code-highlight";

const here = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(here, "../../../../ui/src/styles/theme.css");
const RICH_TEXT_KIT = resolve(
  here,
  "../../components/features/entries/fields/special/rich-text-kit.ts"
);

/**
 * The body of a top-level block, matched by counting braces rather than by
 * reaching for the next `}`. A nested rule inside the block would end the
 * naive match early and silently shorten the set being checked.
 */
function blockBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return css.slice(start, i);
    }
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

/** Every token the tag specs read. */
function consumedTokens(): Set<string> {
  const found = new Set<string>();
  for (const spec of CODE_TAG_SPECS) {
    const match = /var\((--nx-[a-z-]+)\)/.exec(spec.color);
    if (match) found.add(match[1]);
  }
  return found;
}

/** The token this palette gives one lezer tag, by identity. */
function tokenForTag(tag: Tag): string | undefined {
  const spec = CODE_TAG_SPECS.find(s =>
    (Array.isArray(s.tag) ? s.tag : [s.tag]).includes(tag)
  );
  return spec ? /var\((--nx-[a-z-]+)\)/.exec(spec.color)?.[1] : undefined;
}

/** The token rich-text-kit gives one Prism token name. */
function tokenForPrism(name: string): string | undefined {
  const kit = readFileSync(RICH_TEXT_KIT, "utf8");
  const match = new RegExp(
    `^\\s*"?${name}"?:\\s*"text-code-([a-z-]+)`,
    "m"
  ).exec(kit);
  return match ? `--nx-code-${match[1]}` : undefined;
}

/**
 * Constructs both engines name, and must therefore colour alike.
 *
 * Only the ones that genuinely correspond: Prism's `property` and lezer's
 * `propertyName` are the same thing, while Prism has no counterpart for
 * `t.separator` and pairing them would be inventing agreement rather than
 * checking it.
 */
const SHARED_CONSTRUCTS: [string, Tag][] = [
  ["comment", t.comment],
  ["keyword", t.keyword],
  ["string", t.string],
  ["number", t.number],
  ["boolean", t.bool],
  ["operator", t.operator],
  ["punctuation", t.punctuation],
  ["regex", t.regexp],
  ["tag", t.tagName],
  ["class-name", t.className],
  ["namespace", t.namespace],
  ["variable", t.variableName],
  ["property", t.propertyName],
  ["deleted", t.deleted],
  ["inserted", t.inserted],
];

describe("code-highlight", () => {
  it("reads the theme blocks it is measured against", () => {
    // Every assertion below is satisfied by an empty palette, so each would
    // pass against a selector that no longer matches. This is the control that
    // says both blocks were found and parsed.
    expect(codeTokensIn(":root").size).toBeGreaterThan(0);
    expect(codeTokensIn(".dark").size).toBeGreaterThan(0);
  });

  it("names a colour only through a token, never a literal", () => {
    const literals = CODE_TAG_SPECS.filter(
      spec => !/^var\(--nx-[a-z-]+\)$/.test(spec.color)
    );
    expect(literals.map(spec => spec.color)).toEqual([]);
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
    // `--nx-code-bg` and `--nx-code-fg` are chrome rather than tag colours, so
    // `nextlyEditorChrome` consumes them instead of a tag spec.
    const chrome = new Set(["--nx-code-bg", "--nx-code-fg"]);
    const consumed = consumedTokens();
    const unreachable = [...codeTokensIn(":root")].filter(
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

  it("reads the rich-text mapping it is compared against", () => {
    // Same control as above, for the other file: a renamed export or a moved
    // path would make every pairing below resolve to undefined on both sides
    // and agree perfectly.
    const resolved = SHARED_CONSTRUCTS.filter(
      ([prism]) => tokenForPrism(prism) !== undefined
    );
    expect(resolved.length).toBe(SHARED_CONSTRUCTS.length);
  });

  it("colours a shared construct the same as the rich-text editor does", () => {
    // Derived rather than restated: this reads both mappings and compares them,
    // so it cannot itself drift from either. Two engines colouring a class name
    // differently is invisible in review -- each looks right beside its own
    // editor.
    const disagreements = SHARED_CONSTRUCTS.filter(
      ([prism, tag]) => tokenForTag(tag) !== tokenForPrism(prism)
    ).map(([prism, tag]) => ({
      construct: prism,
      codeMirror: tokenForTag(tag),
      richText: tokenForPrism(prism),
    }));
    expect(disagreements).toEqual([]);
  });
});
