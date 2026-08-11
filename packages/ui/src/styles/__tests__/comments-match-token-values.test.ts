/**
 * A comment that names a colour must name the colour the token actually is.
 *
 * The theme annotates most tokens with the colour they were taken from --
 * `slate-900`, `#f9f9f9`, `white`. Those annotations are the only human-readable
 * account of what a value means, and they are the first thing a palette change
 * silently invalidates: swapping the ramp rewrites 100+ values and touches none
 * of the prose beside them. The result is worse than no comment, because
 * `oklch(0 0 0)` labelled `slate-900` reads as deliberate.
 *
 * `comments-describe-code.test.ts` catches comments pointing OUTSIDE the
 * codebase. This catches the opposite failure: a comment about the code that
 * has stopped being true of it.
 *
 * Only claims that can be resolved are checked -- a hex literal, a CSS colour
 * keyword, or a Tailwind scale name the file itself declares. Prose is left
 * alone, so a comment explaining WHY a value was chosen is never a violation.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, toClampedRgb, type Rgb } from "../contrast/color";
import { parseThemeScale, parseThemeTokens } from "../contrast/parse-theme";
import { resolveColor } from "../contrast/resolve";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(resolve(here, "../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);

/**
 * Colour keywords a comment might use as shorthand. Only the unambiguous ends
 * of the range: "grey" or "off-white" are descriptions, not claims.
 */
const KEYWORDS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
};

/**
 * A colour claim inside a comment: a hex literal, a scale name the theme
 * declares (`slate-900`, `red-500`), or a keyword.
 */
const CLAIM =
  /#[0-9a-fA-F]{6}\b|\b(?:slate|blue|cyan|green|amber|red)-\d{2,3}\b|\b(?:white|black)\b/gi;

/** A token declaration, with the comment on the line before or after it. */
interface Annotated {
  token: string;
  value: string;
  claim: string;
  line: number;
}

function claimsIn(block: string, blockStartLine: number): Annotated[] {
  const lines = block.split("\n");
  const found: Annotated[] = [];

  lines.forEach((line, index) => {
    const declaration = line.match(/^\s*(--nx-[a-z0-9-]+)\s*:\s*([^;]+);/);
    if (!declaration) return;
    const [, token = "", value = ""] = declaration;

    // The line AFTER the declaration, and only that one. This file writes the
    // value then labels it, so a label belongs to the declaration above it.
    // Reading the line before as well let one label be attributed to two
    // tokens: the label for a value and, simultaneously, a mislabel of the
    // token that happened to follow it.
    for (const neighbour of [lines[index + 1]]) {
      if (!neighbour || !/^\s*(\/\*|\*|\/\/)/.test(neighbour)) continue;

      // Only a STANDALONE label is an annotation of this token. A sentence
      // that happens to mention a colour is reasoning -- "darkened from
      // red-500", "~4.8:1 as text on white" -- and it stays true after a
      // palette change in a way a bare label does not. Policing prose would
      // report those as defects and the check would be switched off.
      const body = neighbour
        .replace(/^\s*(\/\*+|\/\/|\*)\s*/, "")
        .replace(/\*\/\s*$/, "")
        .trim();
      // Grouped before anchoring: `^a|b|c$` anchors only the outer branches,
      // so an unanchored middle alternative would match a colour ANYWHERE in
      // a sentence and reintroduce the prose false positives this excludes.
      if (!new RegExp(`^(?:${CLAIM.source})$`, "i").test(body)) continue;

      found.push({
        token,
        value: value.trim(),
        claim: body.toLowerCase(),
        line: blockStartLine + index,
      });
      break;
    }
  });
  return found;
}

function claimColor(claim: string): Rgb | null {
  if (claim.startsWith("#")) return toClampedRgb(claim);
  if (KEYWORDS[claim]) return toClampedRgb(KEYWORDS[claim] as string);
  const declared = scale.get(`--color-${claim}`);
  return declared ? toClampedRgb(declared) : null;
}

/** Blocks are located by their opening selector, the same way the file is read. */
function blockOf(selector: string): { text: string; startLine: number } {
  const at = themeCss.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no ${selector} block`);
  const open = themeCss.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < themeCss.length; i++) {
    if (themeCss[i] === "{") depth++;
    else if (themeCss[i] === "}" && --depth === 0) {
      return {
        text: themeCss.slice(open, i),
        startLine: themeCss.slice(0, open).split("\n").length,
      };
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

/**
 * How far a comment's claim may sit from the token's real value before it is
 * misleading rather than approximate. Expressed as contrast between the two,
 * so it scales the way perception does: 1.0 is identical, and 1.1 admits a
 * rounding difference while rejecting "slate-900" on pure black (1.16) or
 * "white" on black (21).
 */
const TOLERANCE = 1.1;

interface Mismatch {
  where: string;
  token: string;
  value: string;
  claim: string;
  ratio: number;
}

function mismatchesIn(
  selector: string,
  tokens: ReturnType<typeof parseThemeTokens>["light"],
  mode: string
): Mismatch[] {
  const { text, startLine } = blockOf(selector);
  const found: Mismatch[] = [];

  for (const annotated of claimsIn(text, startLine)) {
    const claimed = claimColor(annotated.claim);
    if (!claimed) continue;
    let actual: Rgb;
    try {
      actual = resolveColor(annotated.value, { tokens, scale });
    } catch {
      // A non-colour value, or one referencing a token this block does not
      // declare. Not a claim that can be checked.
      continue;
    }
    const ratio = contrastRatio(claimed, actual);
    if (ratio <= TOLERANCE) continue;
    found.push({
      where: `theme.css:${annotated.line} (${mode})`,
      token: annotated.token,
      value: annotated.value,
      claim: annotated.claim,
      ratio,
    });
  }
  return found;
}

/**
 * The blocks the rule reads, named once. The pin below and the rule itself are
 * both driven from this list, so a block can never be measured without also
 * being pinned: adding a mode here adds it to both. Pinning one block by hand
 * while the rule read two is how the dark half came to pass over whatever it
 * happened to find, including nothing.
 */
const MEASURED = [
  { selector: ":root", tokens: light, mode: "light" },
  { selector: ".dark", tokens: dark, mode: "dark" },
] as const;

describe("colour comments describe the values beside them", () => {
  it("finds annotated tokens to check in every block it reads", () => {
    // An empty scan satisfies the rule below without reading anything, and it
    // does so silently -- a block whose annotations were dropped or whose
    // selector moved reports as clean rather than as unread.
    const counts = MEASURED.map(({ selector }) => {
      const { text, startLine } = blockOf(selector);
      return { selector, claims: claimsIn(text, startLine).length };
    });

    expect(
      counts.filter(c => c.claims <= 5),
      `A block the rule measures yielded almost no annotated tokens, so the ` +
        `rule holds over an empty or near-empty set there. Either the block ` +
        `moved, or the annotations were removed -- both make the check below ` +
        `pass for the wrong reason. Counts: ` +
        counts.map(c => `${c.selector}=${c.claims}`).join(", ")
    ).toEqual([]);
  });

  it("resolves the claims it knows how to read", () => {
    // The three claim shapes, pinned. If any stopped resolving, the rule would
    // hold over a smaller set than it appears to.
    expect(claimColor("#ffffff")).not.toBeNull();
    expect(claimColor("white")).not.toBeNull();
    expect(claimColor("slate-900")).not.toBeNull();
    // And prose is not a claim.
    expect(claimColor("weightless")).toBeNull();
  });

  it("names no colour the token is not", () => {
    const mismatches = MEASURED.flatMap(({ selector, tokens, mode }) =>
      mismatchesIn(selector, tokens, mode)
    );

    expect(
      mismatches.map(
        m =>
          `${m.token} is ${m.value} but its comment says "${m.claim}" ` +
          `(${m.ratio.toFixed(2)}:1 apart) — ${m.where}`
      ),
      `A comment names a colour the token no longer is. A palette change ` +
        `rewrites values and leaves prose behind, and a wrong annotation is ` +
        `worse than none: it reads as deliberate. Update the comment to the ` +
        `value, or drop the colour name and say what the token is FOR.`
    ).toEqual([]);
  });
});
