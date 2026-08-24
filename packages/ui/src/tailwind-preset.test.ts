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

/**
 * The component-class selectors `theme.css` declares inside `@layer
 * components`, read from the stylesheet rather than listed here so the guard
 * below covers whichever ones exist rather than whichever ones someone
 * remembered.
 */
function themeComponentSelectors(css: string): Set<string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = new Set<string>();
  const open = source.indexOf("@layer components");
  if (open === -1) return selectors;

  let depth = 0;
  for (let i = source.indexOf("{", open); i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      if (depth >= 2) {
        // The text between the previous brace or semicolon and this one is the
        // selector of the rule being opened. At depth 2 it is a rule inside the
        // layer; deeper still is an at-rule's body, whose rules count too.
        const head = source.slice(0, i);
        const from = Math.max(head.lastIndexOf("{"), head.lastIndexOf("}")) + 1;
        const selector = head.slice(from).trim().replace(/\s+/g, " ");
        if (selector.startsWith(".")) selectors.add(selector);
      }
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return selectors;
}

/**
 * Every selector the preset registers through a plugin's `addComponents`.
 *
 * The preset is read through a widened view because it declares no `plugins`
 * key today, and a property access typed against its literal shape would not
 * compile. Widening rather than asserting keeps this readable on the day a
 * plugin IS added — which is the day the guard below has to work. `theme` is
 * named alongside it only to give the two types a property in common, without
 * which TypeScript rejects the assignment as a weak-type mismatch.
 */
function presetComponentSelectors(): Set<string> {
  const selectors = new Set<string>();
  const withPlugins: { theme?: unknown; plugins?: unknown[] } = uiPreset;
  const plugins: unknown[] = withPlugins.plugins ?? [];
  for (const plugin of plugins) {
    const run = typeof plugin === "function" ? plugin : undefined;
    run?.({
      addComponents: (rules: Record<string, unknown>) => {
        for (const selector of Object.keys(rules)) selectors.add(selector);
      },
      addUtilities: (rules: Record<string, unknown>) => {
        for (const selector of Object.keys(rules)) selectors.add(selector);
      },
      addBase: () => {},
      addVariant: () => {},
      theme: () => undefined,
      config: () => undefined,
      e: (value: string) => value,
    });
  }
  return selectors;
}

describe("the boundary between the preset and the stylesheet", () => {
  it("reads the component layer at all", () => {
    // The guard below compares against this set, and an empty set exonerates
    // every possible preset. A renamed layer or a moved stylesheet has to fail
    // here rather than reporting that nothing is duplicated.
    const selectors = themeComponentSelectors(themeCss);
    expect(selectors.has(".nx-page-shell")).toBe(true);
    expect(selectors.has(".nx-form-section-rows > *")).toBe(true);
  });

  it("reads rules, not the layer's own opening brace", () => {
    // Depth is what separates a rule inside the layer from the layer itself,
    // and a parser that mistook one for the other would collect `@layer
    // components` as a selector and then agree with any preset at all.
    const fixture = `
      /* .nx-decoy in a comment */
      @layer components {
        .nx-real { color: red; }
        @media (min-width: 40rem) {
          .nx-nested { color: blue; }
        }
      }
      .nx-outside { color: green; }
    `;

    expect([...themeComponentSelectors(fixture)].sort()).toEqual([
      ".nx-nested",
      ".nx-real",
    ]);
  });

  it("registers no rule the stylesheet already declares", () => {
    // One decision, one implementation. A component rule restated here would
    // agree with the stylesheet on the day it was written and drift silently
    // afterwards, because each copy reaches a different consumer and neither
    // looks wrong on its own. The stylesheet is the implementation; this preset
    // carries the token contract, and consumers import both.
    const theme = themeComponentSelectors(themeCss);
    const duplicated = [...presetComponentSelectors()]
      .filter(selector => theme.has(selector))
      .sort();

    expect(
      duplicated,
      `These selectors are declared both in theme.css and by this preset, so ` +
        `a change to either leaves the two build paths rendering ` +
        `differently. Delete the copy here and let consumers import ` +
        `theme.css:\n${duplicated.join("\n")}`
    ).toEqual([]);
  });
});
