/**
 * A route that renders admin-scoped UI must load the admin stylesheet.
 *
 * `@nextlyhq/admin/style.css` carries two things nothing else provides: the
 * `--nx-*` token contract, and the component rules scoped beneath the admin
 * class. The playground's root stylesheet has neither, and a missing
 * stylesheet does not throw -- the components render, unstyled, looking like a
 * layout problem rather than a missing import.
 *
 * That failure is worst exactly where it is hardest to notice: the theme
 * gallery's whole purpose is comparing themes on real primitives, and it
 * compared unstyled ones.
 *
 * The check follows each route's IMPORTS rather than its directory. The
 * gallery's admin-scoped markup lives outside the route folder, in a shared
 * component, so a directory scan finds nothing to require and reports every
 * route clean.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../app");

const ADMIN_STYLESHEET = "@nextlyhq/admin/style.css";

/** The class the admin's component rules and tokens are scoped beneath. */
const ADMIN_SCOPE = "nextly-admin";

/** Relative import specifiers, which are the ones resolvable on disk. */
const RELATIVE_IMPORT =
  /(?:^|\n)\s*import\s+(?:[^"';]*?from\s*)?["'](\.[^"']*)["']/g;

const CANDIDATE_SUFFIXES = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

/** Resolve a relative specifier the way the bundler does, or null. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module a page reaches through relative imports, including itself. */
function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const target = resolveImport(file, match[1] as string);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen];
}

/** Every app route that has a page. */
function pages(): Array<{ route: string; entry: string }> {
  const found: Array<{ route: string; entry: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.tsx?$/.test(entry)) {
        found.push({ route: relative(appDir, dir) || ".", entry: full });
      }
    }
  };
  walk(appDir);
  return found;
}

interface Route {
  route: string;
  scoped: boolean;
  loads: boolean;
}

// A className, not a mention: the scope name appears in prose too, including
// in the comment at the top of this file. Requiring it inside a quoted string
// is what separates markup from commentary -- without that, a comment
// explaining the rule would satisfy the rule.
const AS_CLASS = new RegExp(`["'\`][^"'\`]*\\b${ADMIN_SCOPE}\\b[^"'\`]*["'\`]`);

const ROUTES: Route[] = pages().map(({ route, entry }) => {
  const sources = moduleGraph(entry).map(file => readFileSync(file, "utf8"));
  return {
    route: `/${route}`,
    scoped: sources.some(text => AS_CLASS.test(text)),
    loads: sources.some(text => text.includes(ADMIN_STYLESHEET)),
  };
});

describe("admin-scoped routes load the admin stylesheet", () => {
  it("reaches admin-scoped markup through the route's imports", () => {
    // Two ways this rule holds over nothing: no pages found, or pages found
    // but none detected as admin-scoped.
    //
    // The list is `/theme-lab` alone, and that is the point. `/admin` renders
    // markup that lives inside the admin package, so the scope class never
    // appears in this app's sources and only a runtime check would see it --
    // it also imports the stylesheet on the same line, so nothing is at risk
    // there. The route this rule protects is the one that COMPOSES admin
    // primitives itself, whose scoped markup sits outside the route folder in
    // a shared component. A detector that stopped at the route directory
    // would find that route clean and report nothing to check.
    expect(ROUTES.length).toBeGreaterThan(1);
    expect(
      ROUTES.filter(r => r.scoped)
        .map(r => r.route)
        .sort(),
      `The route whose scoped markup is reached through imports should be ` +
        `listed here. An empty list means the detector stopped following ` +
        `imports, and the rule below would then check nothing while passing.`
    ).toEqual(["/theme-lab"]);
  });

  it("loads the stylesheet wherever admin-scoped UI renders", () => {
    const missing = ROUTES.filter(r => r.scoped && !r.loads).map(r => r.route);

    expect(
      missing.sort(),
      `This route renders UI scoped to the admin class but never imports ` +
        `\`${ADMIN_STYLESHEET}\`. Nothing throws: the components render with ` +
        `no tokens and no component rules, which reads as a broken layout ` +
        `rather than a missing import. Import the stylesheet in the route's ` +
        `page.`
    ).toEqual([]);
  });
});
