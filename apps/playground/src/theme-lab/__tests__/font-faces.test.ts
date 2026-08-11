/**
 * A theme's font stack must name a face the app actually loads.
 *
 * `next/font` does not resolve a bare family name. It self-hosts the face and
 * exposes it behind a generated CSS variable, so a stack reading
 * "Plus Jakarta Sans, sans-serif" falls straight through to the system sans.
 * Every preset therefore previewed in the same face regardless of what it
 * declared, and the typography axis of the comparison was one font measured
 * nine times -- silently, because a font that does not load looks like a font
 * that was chosen.
 *
 * Two halves have to agree for a face to work: the importer must put the
 * variable in the stack, and the layout must load it. Either alone renders the
 * same wrong result, so this holds them together.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NEXTLY_THEMES, TWEAKCN_THEMES } from "../themes";

const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(here, "../../app/layout.tsx"), "utf8");

const ALL = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

/** Every `--font-*` variable the root layout declares through next/font. */
function loadedVariables(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/variable:\s*"(--font-[a-z0-9-]+)"/g)].map(
        m => m[1] as string
      )
    ),
  ].sort();
}

/** Every `var(--font-*)` a theme's stacks reference. */
function referencedVariables(): Array<{ theme: string; variable: string }> {
  const found: Array<{ theme: string; variable: string }> = [];
  for (const theme of ALL) {
    for (const stack of [theme.fontSans, theme.fontMono, theme.fontSerif]) {
      if (!stack) continue;
      for (const match of stack.matchAll(/var\((--font-[a-z0-9-]+)\)/g)) {
        found.push({ theme: theme.id, variable: match[1] as string });
      }
    }
  }
  return found;
}

/**
 * Families that are genuinely available without loading anything: system
 * stacks and generic keywords. A stack whose first face is one of these is
 * not a defect -- it is a deliberate choice of something already present.
 */
const SYSTEM_FACES = new Set([
  "georgia",
  "menlo",
  "monaco",
  "consolas",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "system-ui",
  "-apple-system",
  "sans-serif",
  "serif",
  "monospace",
  "arial",
  "helvetica",
  "times new roman",
  "courier new",
]);

/** The first face in a stack, unquoted and lowercased. */
const firstFace = (stack: string): string =>
  (stack.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

describe("theme fonts resolve to faces the app loads", () => {
  it("finds loaded variables and themes that reference them", () => {
    // Either half going empty makes the rules below vacuous: a layout whose
    // declarations stopped matching, or themes that reference no variable at
    // all -- which is the exact pre-fix state, where every stack was a bare
    // family name and nothing pointed at a loaded face.
    expect(loadedVariables(layout).length).toBeGreaterThan(3);
    expect(referencedVariables().length).toBeGreaterThan(5);
    expect(ALL.length).toBeGreaterThan(5);
  });

  it("references no font variable the layout does not load", () => {
    const loaded = new Set(loadedVariables(layout));
    const dangling = referencedVariables()
      .filter(r => !loaded.has(r.variable))
      .map(r => `${r.theme} references ${r.variable}`);

    expect(
      [...new Set(dangling)].sort(),
      `A theme's font stack names a variable the root layout never declares, ` +
        `so it resolves to nothing and the stack falls through to its next ` +
        `entry. Load the face in app/layout.tsx, or stop naming it.`
    ).toEqual([]);
  });

  it("names no unloaded custom face as a stack's first choice", () => {
    const loaded = new Set(loadedVariables(layout));
    const unresolved: string[] = [];

    for (const theme of ALL) {
      for (const [role, stack] of [
        ["sans", theme.fontSans],
        ["mono", theme.fontMono],
        ["serif", theme.fontSerif],
      ] as const) {
        if (!stack) continue;
        // A stack that leads with a loaded variable is fine whatever follows.
        const leadVariable = stack.match(/^var\((--font-[a-z0-9-]+)\)/)?.[1];
        if (leadVariable && loaded.has(leadVariable)) continue;
        const face = firstFace(stack);
        if (SYSTEM_FACES.has(face)) continue;
        unresolved.push(`${theme.id} ${role}: "${stack}"`);
      }
    }

    expect(
      unresolved.sort(),
      `This stack leads with a face that is neither loaded by the app nor ` +
        `present on the system, so it renders as whatever comes next -- the ` +
        `theme is previewed in a font it did not choose, and nothing reports ` +
        `it. Load the face and put its variable in front, or lead with a ` +
        `system face on purpose.`
    ).toEqual([]);
  });
});
