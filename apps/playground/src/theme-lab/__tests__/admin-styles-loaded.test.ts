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

import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../app");

/**
 * Every stylesheet an admin-scoped route needs, not just the package one.
 *
 * Checking a single stylesheet certified the gallery route as styled while it
 * was still missing two: `densities.css` keys on the `data-density` attribute
 * the preview panels carry, and `harness.css` is what carries a theme's
 * declared font and radius into primitives that read neither on their own. A
 * route with only the package stylesheet renders every theme at the base
 * metrics in the default face -- which is precisely the axes the themes were
 * shortlisted on.
 */
const REQUIRED_STYLESHEETS = [
  "@nextlyhq/admin/style.css",
  "theme-lab/densities.css",
  "theme-lab/harness.css",
];

/** The class the admin's component rules and tokens are scoped beneath. */
const ADMIN_SCOPE = "nextly-admin";

/**
 * Import specifiers, read from the parsed module rather than matched in text.
 *
 * Searching the source for a stylesheet's name counted any MENTION as an
 * import, and the route's own comment explaining why it imports those
 * stylesheets names all three -- so deleting a real import left the guard
 * green while the route lost the styles.
 *
 * A regex that strips comments first would trade that for a worse failure: if
 * the stripper ever eats a real declaration, the guard passes while blind,
 * which is the direction a check must never fail in. The compiler's tree
 * carries no comments to confuse and no stripping step to get wrong, and
 * `typescript` is already a devDependency here.
 */
function importSpecifiers(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const found: string[] = [];
  for (const statement of parsed.statements) {
    // Side-effect imports (`import "x.css"`) and value imports alike; both are
    // ImportDeclaration, and a stylesheet is always the former.
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (ts.isStringLiteral(specifier)) found.push(specifier.text);
  }
  return found;
}

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

/**
 * Every module a page reaches through relative imports, including itself.
 *
 * Also parsed rather than matched: a commented-out relative import would
 * otherwise pull a module into the graph that the route does not actually
 * reach, which widens the set the rule below reads and can make an unimported
 * route look styled.
 */
function moduleGraph(entry: string): Array<{ file: string; source: string }> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const specifier of importSpecifiers(file, source)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImport(file, specifier);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].map(([file, source]) => ({ file, source }));
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
  missing: string[];
}

// A className, not a mention: the scope name appears in prose too, including
// in the comment at the top of this file. Requiring it inside a quoted string
// is what separates markup from commentary -- without that, a comment
// explaining the rule would satisfy the rule.
const AS_CLASS = new RegExp(`["'\`][^"'\`]*\\b${ADMIN_SCOPE}\\b[^"'\`]*["'\`]`);

const ROUTES: Route[] = pages().map(({ route, entry }) => {
  const modules = moduleGraph(entry);
  // Specifiers, not source text. `theme-lab/densities.css` is matched as a
  // SUFFIX because the route reaches it by a relative path whose depth
  // depends on where the importing file sits.
  const imported = modules.flatMap(m => importSpecifiers(m.file, m.source));
  return {
    route: `/${route}`,
    scoped: modules.some(m => AS_CLASS.test(m.source)),
    missing: REQUIRED_STYLESHEETS.filter(
      sheet => !imported.some(spec => spec === sheet || spec.endsWith(sheet))
    ),
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

  it("loads every required stylesheet wherever admin-scoped UI renders", () => {
    const missing = ROUTES.filter(r => r.scoped && r.missing.length > 0).map(
      r => `${r.route} is missing ${r.missing.join(", ")}`
    );

    expect(
      missing.sort(),
      `This route renders UI scoped to the admin class but does not import ` +
        `every stylesheet that scope needs. Nothing throws: components render ` +
        `with no tokens, or at the base density in the default face, which ` +
        `reads as a design difference rather than a missing import. Import ` +
        `the listed stylesheets in the route's page.`
    ).toEqual([]);
  });
});
