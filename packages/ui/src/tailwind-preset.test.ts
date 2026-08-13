/**
 * The Tailwind v3 preset must map every colour the v4 `@theme` block declares.
 *
 * There are two configuration surfaces for the same question. `theme.css` is
 * read by Tailwind v4; `tailwind-preset.ts` is the documented v3 path and reads
 * none of it. A token added to one and not the other does not fail anywhere: v4
 * consumers get the utility, v3 consumers get NO RULE AT ALL, so the element
 * renders with the property unset rather than mis-set. A transparent sidebar
 * and an invisible checkbox border look like design decisions.
 *
 * That has already happened twice — `overlay` carries a comment about it, and
 * `control-border` was added to `@theme` alone. Hence a check rather than a
 * third comment.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import uiPreset from "./tailwind-preset";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(resolve(here, "styles/theme.css"), "utf8");

/**
 * The `--color-*` names declared inside `@theme` blocks that resolve to one of
 * our own tokens, which is what decides the utilities Tailwind v4 generates.
 *
 * Two exclusions, both structural rather than a list anyone has to maintain:
 * names declared on `:root` or `.dark` are token VALUES and need not be exposed
 * as utilities at all; and a `@theme` colour whose value is a LITERAL restates
 * Tailwind's own default palette, which it must do because v4's `@theme`
 * replaces that palette wholesale. Tailwind v3 still ships those defaults, so
 * copying them into the preset would add nothing. Only a `var(--nx-*)` value
 * describes a colour that exists solely because we declared it, and those are
 * exactly the ones v3 cannot know about.
 */
function themeColorNames(css: string): Set<string> {
  // Comments come out first, and the opener is matched tightly. Neither is
  // fussiness: this file's prose discusses `@theme` repeatedly, and a loose
  // `/@theme[^{]*\{/` matches those mentions and then runs forward to whichever
  // brace comes next. Measured on this stylesheet, that version matched four
  // openers of which three were comments, missed the real block entirely, and
  // still returned the right names -- because one comment's span happened to
  // reach the real block's brace. It would stop being right the moment a
  // sentence moved.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set<string>();
  for (const start of source.matchAll(/@theme(?:\s+inline)?\s*\{/g)) {
    let depth = 0;
    for (let i = start.index; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          const body = source.slice(start.index, i);
          const DECLARED = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/g;
          for (const [, name, value] of body.matchAll(DECLARED)) {
            if (/var\(\s*--nx-/.test(value)) names.add(name);
          }
          break;
        }
      }
    }
  }
  return names;
}

/**
 * The utility suffixes the preset generates, flattened the way Tailwind v3
 * flattens a `colors` object: `DEFAULT` collapses onto the group name and every
 * other key is joined to it with a dash.
 *
 * Read from the imported module rather than from its source text, because the
 * numeric scales are produced by a helper at load time — a scan over the source
 * sees `statusScale("--nx-destructive")` and reports `destructive-500` missing
 * when the preset does in fact emit it.
 */
function presetColorNames(): Set<string> {
  const colors = uiPreset.theme?.extend?.colors ?? {};
  const names = new Set<string>();
  for (const [group, value] of Object.entries(colors)) {
    if (typeof value === "string") {
      names.add(group);
      continue;
    }
    for (const key of Object.keys(value)) {
      names.add(key === "DEFAULT" ? group : `${group}-${key}`);
    }
  }
  return names;
}

describe("the Tailwind v3 preset", () => {
  it("reads both surfaces at all", () => {
    // Every assertion below compares two sets, and two EMPTY sets agree. A
    // moved stylesheet or a changed preset shape has to fail here rather than
    // reporting that the surfaces are in step.
    expect(themeColorNames(themeCss).size).toBeGreaterThan(50);
    expect(presetColorNames().size).toBeGreaterThan(50);
  });

  it("reads the theme block itself, not prose about it", () => {
    // A size check cannot separate a parser that reads the real block from one
    // that reads a comment mentioning `@theme` and runs on to the next brace.
    // Both return plenty of names. So the parser is exercised on a stylesheet
    // whose right answer is known and whose wrong answers are distinguishable.
    const fixture = `
      /* The @theme inline block below declares --color-decoy: var(--nx-decoy); */
      @theme inline {
        --color-real: var(--nx-real);
        --color-literal: #ff0000;
      }
      :root {
        --color-outside: var(--nx-outside);
      }
    `;

    const found = themeColorNames(fixture);
    expect([...found]).toEqual(["real"]);
    // Named individually, because `toEqual` above would also pass if the
    // parser returned nothing at all for an unrelated reason.
    expect(found.has("decoy"), "read a declaration out of a comment").toBe(
      false
    );
    expect(found.has("outside"), "read a declaration outside @theme").toBe(
      false
    );
    expect(found.has("literal"), "kept a literal palette restatement").toBe(
      false
    );
  });

  it("maps every colour the v4 theme block declares", () => {
    const missing = [...themeColorNames(themeCss)]
      .filter(name => !presetColorNames().has(name))
      .sort();

    expect(
      missing,
      `These colours exist as Tailwind v4 utilities but generate no rule on ` +
        `the v3 preset path, so a consumer using the documented preset gets ` +
        `the property unset. Add each to theme.extend.colors in ` +
        `tailwind-preset.ts:\n${missing.join("\n")}`
    ).toEqual([]);
  });
});
