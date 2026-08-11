/**
 * Nothing outside `themes/` may import the generated presets directly.
 *
 * `themes/index.ts` layers accessibility corrections over the imported presets
 * and re-exports the result, and its own doc comment says every consumer reads
 * it rather than the generated file. That was a claim, not a rule: the admin
 * layout imported the generated file, so the stylesheet the admin actually
 * loaded carried the RAW preset while the switcher and the contrast report
 * described the corrected one. A preset was reported clean and rendered broken,
 * and the two disagreed silently because both were "right" about their own
 * source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const playground = resolve(here, "../../..");
const CORRECTED = "src/theme-lab/themes";
const GENERATED = "tweakcn.generated";

const EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(extname(full))) found.push(full);
  }
  return found;
}

/** `import ... from "...tweakcn.generated"`, not a mention in prose. */
const IMPORTS_GENERATED =
  /\bfrom\s+["'][^"']*tweakcn\.generated["']|\bimport\(\s*["'][^"']*tweakcn\.generated["']/;

const sources = walk(resolve(playground, "src"))
  .map(path => relative(playground, path))
  .filter(path => !/(^|\/)__tests__\//.test(path));

describe("presets reach consumers through the corrected barrel", () => {
  it("finds the sources to check", () => {
    // Containment over an empty scan passes, so the scan is pinned first.
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some(path => path.startsWith(CORRECTED))).toBe(true);
  });

  it("proves the pattern recognises a real import", () => {
    // The barrel itself imports the generated file; that is the one place that
    // should. If the pattern stopped matching it, the rule below would hold
    // over nothing.
    const barrel = readFileSync(
      resolve(playground, CORRECTED, "index.ts"),
      "utf8"
    );
    expect(IMPORTS_GENERATED.test(barrel)).toBe(true);
  });

  it("has no consumer importing the generated presets directly", () => {
    const offenders = sources.filter(
      path =>
        !path.startsWith(CORRECTED) &&
        IMPORTS_GENERATED.test(readFileSync(resolve(playground, path), "utf8"))
    );

    expect(
      offenders,
      `These import \`${GENERATED}\` directly and so receive presets WITHOUT ` +
        `the accessibility corrections that every other consumer sees. Import ` +
        `from \`theme-lab/themes\` instead:\n${offenders.map(p => `  ${p}`).join("\n")}`
    ).toEqual([]);
  });
});
