/**
 * Every `--nx-*` token the admin renders with must be declared in the theme's
 * token file, so a palette change reaches all of them.
 *
 * `packages/ui/src/styles/theme.css` is where the palette lives, and swapping a
 * palette rewrites the tokens in it. A token declared anywhere else keeps
 * whatever value it was written with: every surface around it moves and it
 * stays behind, with nothing in the theme file mentioning it. That is how a
 * table header kept a blue cast through a swap to an achromatic palette, while
 * the card beneath it went neutral. A token declared NOWHERE is the same defect
 * further along -- it resolves to its fallback, or to nothing.
 *
 * The check is containment rather than a colour judgement, because being
 * stranded is the defect and a wrong hue is only one way it shows. A stranded
 * token can be equally wrong in lightness, in contrast, or simply frozen -- and
 * under a palette that legitimately carries hue, a neutrality check would pass
 * while the orphan kept the OLD hue.
 *
 * **Scope is the admin's whole rendering surface, not one stylesheet.** A token
 * reaches the screen from a `.css` file, from `style={{ ... }}` in a component,
 * from a `bg-[var(--nx-...)]` arbitrary value, or from a `packages/ui` component
 * rendered inside the admin shell. Scanning only the admin stylesheet checks the
 * place the last defect happened to live rather than the places tokens are used;
 * widening it from that stylesheet to both packages took the count of distinct
 * consumed tokens from 16 to 66 and surfaced a second defect.
 *
 * `--nx-*` is the palette's namespace. Knobs genuinely local to the admin, with
 * no business in a palette (`--sidebar-width-safe`), carry no `--nx-` prefix and
 * are out of scope.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");
const THEME = "packages/ui/src/styles/theme.css";

/** Both packages that paint the admin shell. */
const SCANNED = ["packages/admin/src", "packages/ui/src"];

/** File types a `var(--nx-*)` reference can appear in. */
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * Test files declare and read invented tokens as fixtures -- `--nx-missing` is
 * the point of a resolver test. They render nothing, so they are not part of
 * the consumption surface.
 */
function isTestFile(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path);
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(extname(full))) found.push(full);
  }
  return found;
}

const sources = SCANNED.flatMap(root => walk(resolve(repo, root)))
  .map(path => relative(repo, path))
  .filter(path => !isTestFile(path));

/**
 * Custom-property declarations in a stylesheet, read from a parsed AST rather
 * than matched by pattern. A pattern has to model the input's shape, and the
 * shapes keep arriving: a rule written on one line, a declaration inside a
 * comment, an `@media` nesting level, whatever a minifier emits. The parser
 * already knows all of them.
 */
function declaredIn(css: string): Set<string> {
  const names = new Set<string>();
  postcss.parse(css).walkDecls(decl => {
    if (decl.prop.startsWith("--nx-")) names.add(decl.prop);
  });
  return names;
}

/**
 * `var(--nx-name)` references. Read lexically, because the same reference has to
 * be found in CSS, in a JSX style object and inside a Tailwind arbitrary value,
 * and only one of those has a stylesheet parser. A reference sitting in a
 * commented-out block still counts, which only matters if the token it names was
 * also deleted -- and the fix for that is to delete the dead code.
 */
const REFERENCE = /var\(\s*(--nx-[a-z0-9-]+)/g;

const themeCss = readFileSync(resolve(repo, THEME), "utf8");
const declaredByTheme = declaredIn(themeCss);

const consumers = new Map<string, Set<string>>();
const declarers = new Map<string, Set<string>>();

for (const path of sources) {
  const source = readFileSync(resolve(repo, path), "utf8");
  for (const [, name] of source.matchAll(REFERENCE)) {
    const files = consumers.get(name) ?? new Set<string>();
    files.add(path);
    consumers.set(name, files);
  }
  if (path === THEME || extname(path) !== ".css") continue;
  for (const name of declaredIn(source)) {
    const files = declarers.get(name) ?? new Set<string>();
    files.add(path);
    declarers.set(name, files);
  }
}

describe("admin tokens are reachable by a palette change", () => {
  it("scans both packages and finds tokens on each side", () => {
    // Containment over an empty set is vacuously true, so a renamed directory
    // or a changed syntax would turn the real assertion into a pass.
    expect(sources.length).toBeGreaterThan(100);
    expect(consumers.size).toBeGreaterThan(0);
    expect(declaredByTheme.size).toBeGreaterThan(0);
  });

  it("reads declarations the way a stylesheet is written, not as lines", () => {
    // Each of these is a shape a pattern-matching version of this check has to
    // be taught separately, and one of them (the single-line rule) already got
    // through a line-anchored version.
    const oneLine = declaredIn(".nextly-admin { --nx-probe: oklch(1 0 0); }");
    expect(oneLine.has("--nx-probe")).toBe(true);

    const nested = declaredIn(
      "@media (min-width: 40rem) { :root { --nx-probe: oklch(1 0 0); } }"
    );
    expect(nested.has("--nx-probe")).toBe(true);

    const commented = declaredIn(":root { /* --nx-probe: oklch(1 0 0); */ }");
    expect(commented.has("--nx-probe")).toBe(false);
  });

  it("declares every token the admin renders with", () => {
    const stranded = [...consumers.keys()]
      .filter(token => !declaredByTheme.has(token))
      .sort();

    expect(
      stranded,
      `These tokens are used but not declared in ${THEME}, so a palette change ` +
        `cannot reach them: they keep their current value, or resolve to their ` +
        `fallback, while every surface around them moves. Declare each one in ` +
        `the theme file alongside the tokens it sits among, or point the usage ` +
        `at a token that exists:\n` +
        stranded
          .map(token => {
            const where = [...(consumers.get(token) ?? [])].join(", ");
            const declared = declarers.has(token)
              ? [...(declarers.get(token) ?? [])].join(", ")
              : "nowhere";
            return `  ${token}\n    used in:      ${where}\n    declared in:  ${declared}`;
          })
          .join("\n")
    ).toEqual([]);
  });

  it("keeps the palette namespace out of every other stylesheet", () => {
    const elsewhere = [...declarers.keys()].sort();
    expect(
      elsewhere,
      `A stylesheet other than ${THEME} declares palette tokens. \`--nx-*\` is ` +
        `the theme's namespace: a value set anywhere else is invisible to a ` +
        `palette change. Move these into the theme file, or rename them if they ` +
        `are genuinely local knobs rather than palette values:\n` +
        elsewhere
          .map(t => `  ${t} — ${[...(declarers.get(t) ?? [])].join(", ")}`)
          .join("\n")
    ).toEqual([]);
  });
});
