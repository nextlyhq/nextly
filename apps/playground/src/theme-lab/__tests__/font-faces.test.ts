/**
 * A font a theme declares must be a font the app actually loads.
 *
 * `next/font` self-hosts a face behind a generated CSS variable; it does not
 * make a bare family name resolve. So a stack copied from upstream as
 * "Plus Jakarta Sans, sans-serif" fell straight through to the system sans,
 * and every preset previewed in the same face regardless of what it declared.
 * The typography axis of the comparison was one font measured nine times, and
 * nothing failed -- a missing face looks exactly like a design choice.
 *
 * Two halves have to agree for this to work: the importer maps a family onto a
 * variable, and the root layout loads that family under the same variable.
 * Either alone is silent. This holds them together.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NEXTLY_THEMES, TWEAKCN_THEMES } from "../themes";

const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(here, "../../app/layout.tsx"), "utf8");

const ALL = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

/** Every `--font-*` variable the root layout declares through `next/font`. */
function loadedVariables(source: string): string[] {
  return [...source.matchAll(/variable:\s*"(--font-[a-z0-9-]+)"/g)]
    .map(m => m[1] as string)
    .sort();
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

const LOADED = loadedVariables(layout);
const REFERENCED = referencedVariables();

describe("declared fonts are loaded fonts", () => {
  it("finds variables on both sides", () => {
    // Either side going empty makes the rule below vacuous, and the empty
    // case is the failure: no references means no theme asks for a self-hosted
    // face, which is the state this whole check exists to end.
    expect(LOADED.length).toBeGreaterThan(3);
    expect(REFERENCED.length).toBeGreaterThan(3);
  });

  it("loads every face a theme references", () => {
    const loaded = new Set(LOADED);
    const missing = [
      ...new Set(
        REFERENCED.filter(r => !loaded.has(r.variable)).map(
          r => `${r.theme} references ${r.variable}`
        )
      ),
    ].sort();

    expect(
      missing,
      `A theme's font stack names a variable the root layout never declares, ` +
        `so it resolves to nothing and the stack falls through to the system ` +
        `face. Load the family in \`src/app/layout.tsx\` under that variable, ` +
        `or stop mapping it in the importer.`
    ).toEqual([]);
  });

  it("routes every self-hostable family through a variable", () => {
    // The other direction: a stack naming a family the app loads, but written
    // as a bare name so the loaded face is never used. That is the original
    // defect, and it is invisible -- the text renders, in the wrong face.
    const families = new Map(
      LOADED.map(v => [
        v.replace("--font-", "").replace(/-/g, " ").toLowerCase(),
        v,
      ])
    );

    const bare: string[] = [];
    for (const theme of ALL) {
      for (const stack of [theme.fontSans, theme.fontMono, theme.fontSerif]) {
        if (!stack || stack.includes("var(--font-")) continue;
        const first = (stack.split(",")[0] as string)
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase();
        // "Source Serif 4" loads as `--font-source-serif`, so compare on a
        // prefix rather than demanding the slug round-trip exactly.
        for (const [family, variable] of families) {
          if (first.startsWith(family) || family.startsWith(first)) {
            bare.push(`${theme.id}: "${stack}" should use var(${variable})`);
            break;
          }
        }
      }
    }

    expect(
      bare.sort(),
      `A theme names a family the app self-hosts, but as a bare name. ` +
        `\`next/font\` only resolves through its generated variable, so this ` +
        `renders in the fallback face while looking deliberate.`
    ).toEqual([]);
  });
});
