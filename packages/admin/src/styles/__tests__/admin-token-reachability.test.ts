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
 * **The theme owns two namespaces, and the check covers both.** `--nx-*` is the
 * palette's own vocabulary; `--color-*`, `--font-*`, `--space-*` and the rest are
 * Tailwind's `@theme` names, which Tailwind requires by name and which therefore
 * cannot be moved into `--nx-*`. Covering only `--nx-*` would leave the
 * symmetric defect invisible: a component consuming `--font-mono` that the theme
 * did not declare fails in exactly the way `--nx-font-mono` did. The split is
 * also what caused that defect -- somebody reached for the palette namespace for
 * a role that lives in Tailwind's.
 *
 * Ownership is derived from what the theme declares rather than listed, so
 * namespaces belonging to somebody else (`--radix-*`, injected by a primitive at
 * runtime; `--sidebar-width*`, a local layout knob) are out of scope without
 * anyone maintaining a list of them.
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
    if (decl.prop.startsWith("--")) names.add(decl.prop);
  });
  return names;
}

/**
 * `var(--name)` references, required to end at a `)` or a `,` so a glob in prose
 * (`var(--nx-*)` in a doc comment) is not read as a reference to a token called
 * `--nx-`.
 *
 * Read lexically, because the same reference has to be found in CSS, in a JSX
 * style object and inside a Tailwind arbitrary value, and only one of those has
 * a stylesheet parser. A reference sitting in a commented-out block still
 * counts. That is a false positive for CONSUMPTION, which fails toward demanding
 * a declaration rather than toward permitting a missing one -- the safe
 * direction for this check, and the reason it is not worth parsing three
 * languages to remove.
 */
const REFERENCE = /var\(\s*(--[a-z][a-z0-9-]*?)\s*(?=([),]))/g;

/**
 * Every `var()` reference in a source, with whether it supplied a fallback
 * argument. The character the name runs into decides it: `,` opens a fallback,
 * `)` closes the reference without one.
 */
function referencesIn(
  source: string
): { name: string; hasFallback: boolean }[] {
  return [...source.matchAll(REFERENCE)].map(([, name, next]) => ({
    name,
    hasFallback: next === ",",
  }));
}

/**
 * The first segment of a custom property: `--nx-card` and `--nx-border` are both
 * `--nx`. The theme owns a namespace if it declares anything in it.
 */
function namespaceOf(property: string): string {
  const [, first = ""] = property.match(/^(--[a-z0-9]+)/) ?? [];
  return first;
}

/**
 * Consumed properties in namespaces the theme does NOT own, which are therefore
 * somebody else's to declare:
 *
 * - `--radix-*` are injected at runtime by Radix primitives (content height,
 *   trigger width) and only exist while a primitive is open.
 * - `--sidebar-width*` are layout knobs local to the admin shell, the documented
 *   shape of a value with no business in a palette.
 *
 * Neither is enumerated here: both fall out of the namespace rule, so a new
 * Radix property needs no maintenance. Only the font variables are named below.
 */

/**
 * The properties in a theme-owned namespace that the theme legitimately does
 * not declare. `next/font` self-hosts a face at build time and exposes it only
 * as a variable, so the host app authors these and `theme.css` merely reads
 * them (`--font-sans: var(--font-geist, Geist), ui-sans-serif, ...`). The theme
 * is their consumer, not their author.
 *
 * Because nothing in the repo declares them, every reference to one must carry a
 * fallback argument; the assertion below enforces that.
 */
const INJECTED_AT_RUNTIME = new Set(["--font-geist", "--font-geist-mono"]);

const themeCss = readFileSync(resolve(repo, THEME), "utf8");
const declaredByTheme = declaredIn(themeCss);
const ownedNamespaces = new Set([...declaredByTheme].map(namespaceOf));

const consumers = new Map<string, Set<string>>();
const declarers = new Map<string, Set<string>>();

for (const path of sources) {
  const source = readFileSync(resolve(repo, path), "utf8");
  for (const [, name] of source.matchAll(REFERENCE)) {
    if (!ownedNamespaces.has(namespaceOf(name))) continue;
    if (INJECTED_AT_RUNTIME.has(name)) continue;
    const files = consumers.get(name) ?? new Set<string>();
    files.add(path);
    consumers.set(name, files);
  }
  if (path === THEME || extname(path) !== ".css") continue;
  for (const name of declaredIn(source)) {
    if (!name.startsWith("--nx-")) continue;
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

  it("covers both namespaces the theme owns", () => {
    // The namespace filter is the easiest part of this check to narrow by
    // accident, and narrowing it produces a pass. Both sides must be present in
    // what was actually collected, not merely reachable in principle.
    const namespaces = new Set([...consumers.keys()].map(namespaceOf));
    expect(namespaces.has("--nx")).toBe(true);
    expect([...namespaces].some(space => space !== "--nx")).toBe(true);
  });

  it("still needs each runtime-injected exception", () => {
    // An exception nobody rechecks outlives its reason. Each entry has to still
    // be consumed somewhere and still be absent from the theme; one that is no
    // longer either should go rather than sit here explaining a situation that
    // has changed.
    //
    // Derived from the set rather than naming a font, so swapping the typeface
    // is one edit here instead of two that can disagree. Matched through the
    // reference reader rather than as a substring, because `var(--font-geist)`
    // is not a substring of `var(--font-geist, Geist)` and a substring test
    // would read the fallback form as "no longer consumed".
    for (const name of INJECTED_AT_RUNTIME) {
      const consumed = sources.some(path =>
        referencesIn(readFileSync(resolve(repo, path), "utf8")).some(
          reference => reference.name === name
        )
      );
      expect(consumed, `${name} is exempted but no longer consumed`).toBe(true);
      expect(
        declaredByTheme.has(name),
        `${name} is exempted but the theme now declares it`
      ).toBe(false);
    }
  });

  it("gives every runtime-injected reference a fallback argument", () => {
    // These are the tokens nothing in the repo declares, so whether they resolve
    // is the host's choice. A bare `var(--x)` that the host did not define is
    // invalid at computed-value time, and that invalidates the WHOLE
    // declaration rather than just the one family: an inherited property falls
    // back to the parent's value, so a font stack listing six generic families
    // after the reference yields none of them and the element renders in
    // whatever its ancestor used.
    //
    // A family listed after the closing paren therefore reads as a fallback
    // chain without being one. Only an argument INSIDE the parentheses is
    // reached, which is what this requires.
    const bare: string[] = [];
    for (const path of sources) {
      for (const reference of referencesIn(
        readFileSync(resolve(repo, path), "utf8")
      )) {
        if (!INJECTED_AT_RUNTIME.has(reference.name)) continue;
        if (reference.hasFallback) continue;
        bare.push(`  ${reference.name} — ${path}`);
      }
    }

    expect(
      bare.sort(),
      `These references name a token no stylesheet in the repo declares, and ` +
        `supply no fallback, so a host that does not inject it loses the ` +
        `entire declaration rather than falling through to the rest of the ` +
        `stack. Move the default inside the parentheses — ` +
        `\`var(--font-geist, Geist)\`, not \`var(--font-geist), Geist\`:\n` +
        bare.join("\n")
    ).toEqual([]);
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
