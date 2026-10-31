/**
 * The admin's shell loads none of customise mode's drag code.
 *
 * The shell is what `src/index.ts` loads with it, before any route: every page of the admin pays
 * for it on its first load, and `scripts/check-bundle-budgets.mjs` holds it to a budget measured
 * from the built `dist`. The drag code, `components/features/widgets/edit/drag/`, is needed only
 * while a reader rearranges the dashboard, so it belongs to the dashboard route. It once reached
 * the shell through one import of a string constant: the page header's summary line read a cell's
 * attribute name from `useCardDrag.ts`, and that loaded the hook, its geometry, its messages and
 * the card sizes into every page. The budget then names the heavy CHUNKS; this names the EDGE, at
 * the commit that adds it, so the fix is the import rather than a hunt through a built graph. The
 * budget stays the gate; this is the pointer.
 *
 * A static walk over the source, through the repository's one reader of what a file loads
 * (`@nextlyhq/module-specifiers`), with no module evaluated. It follows what a module loads with
 * it: `import ... from`, `export ... from` and a bare `import "x"`. A type-only reference erases
 * before anything runs, and an `import()` loads only when it runs, which is how the routes load,
 * so neither is followed. Its limit: an `import()` run while a module initialises is read as
 * deferred, because telling those apart needs control-flow analysis; the budget catches what that
 * costs.
 *
 * Resolution is the admin's own: relative paths and the `@admin/` alias of its `tsconfig.json`,
 * to a `.ts`/`.tsx` file or a folder's `index`. A bare specifier is a package and ends the walk,
 * which is sound because no package the admin imports imports the admin back; so it must be one
 * the admin's `package.json` declares, and a specifier that is neither fails the walk rather than
 * counting as importing nothing. An alias added to the tsconfig without a case here fails that
 * way too, instead of leaving a subtree unwalked.
 *
 * @module shell-stays-off-drag-code.test
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  moduleSpecifierRefs,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

const PACKAGE = resolve(__dirname, "..");
const SRC = join(PACKAGE, "src");
const ENTRY = join(SRC, "index.ts");

/** The folder no module the shell loads may live in. */
const DRAG_FOLDER = join(SRC, "components/features/widgets/edit/drag");

/** The admin's path alias, as its `tsconfig.json` maps `@admin/*` to `./src/*`. */
const ALIAS_PREFIX = "@admin/";

/** A module under `src`, with `/` on every platform. */
const fromSrc = (file: string): string =>
  relative(SRC, file).split(sep).join("/");

const isInDragFolder = (file: string): boolean =>
  file.startsWith(`${DRAG_FOLDER}${sep}`);

const MANIFEST = JSON.parse(
  readFileSync(join(PACKAGE, "package.json"), "utf8")
) as Partial<
  Record<
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies",
    Record<string, string>
  >
>;

/** Every package the admin declares, under any kind of dependency. */
const DECLARED: ReadonlySet<string> = new Set(
  (
    [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const
  ).flatMap(kind => Object.keys(MANIFEST[kind] ?? {}))
);

/**
 * Whether a bare specifier names a package the walk may stop at: one the admin declares, as
 * itself or a subpath, or one the runtime provides. The admin's own name is never declared, so
 * importing it, which loads the built entry from inside the package, is a problem too.
 */
const isPackage = (specifier: string): boolean =>
  specifier.startsWith("node:") ||
  builtinModules.includes(specifier.split("/")[0]) ||
  [...DECLARED].some(
    name => specifier === name || specifier.startsWith(`${name}/`)
  );

const isRegularFile = (file: string): boolean =>
  existsSync(file) && statSync(file).isFile();

/**
 * The file a path names, of the spellings that exist: a source file by extension first, then a
 * folder's index, so a folder `x` never wins over a file `x.ts` beside it; and last the path as
 * written, which is how a stylesheet or other asset is imported.
 */
function sourceFileFor(base: string): string | undefined {
  const withoutJs = base.replace(/\.([cm]?)js(x?)$/, ".$1ts$2");
  const candidates = [
    ...(withoutJs === base ? [] : [withoutJs]),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ];
  return candidates.find(isRegularFile);
}

/** A module a file loads with it, or why that reference could not be followed. */
type Edge =
  | { kind: "module"; target: string }
  | { kind: "package" }
  | { kind: "problem"; detail: string };

const isSourceModule = (file: string): boolean => /\.[cm]?[jt]sx?$/.test(file);

/** Each file's edges, read once: modules are shared across the walk. */
const edgeCache = new Map<string, Edge[]>();

/** What one module loads at once, resolved. */
function staticEdgesOf(file: string): Edge[] {
  const cached = edgeCache.get(file);
  if (cached) return cached;
  const edges: Edge[] = [];
  for (const ref of moduleSpecifierRefs(readFileSync(file, "utf8"), file)) {
    // Erased before anything runs, or loaded only when the expression runs.
    if (ref.typeOnly || ref.dynamic) continue;
    const { specifier } = ref;
    if (specifier === UNRESOLVABLE_SPECIFIER) {
      edges.push({ kind: "problem", detail: `${fromSrc(file)}: unreadable` });
      continue;
    }
    let base: string;
    if (specifier.startsWith(".")) {
      base = resolve(dirname(file), specifier);
    } else if (specifier.startsWith(ALIAS_PREFIX)) {
      base = join(SRC, specifier.slice(ALIAS_PREFIX.length));
    } else if (isPackage(specifier)) {
      edges.push({ kind: "package" });
      continue;
    } else {
      edges.push({
        kind: "problem",
        detail: `${fromSrc(file)}: ${specifier} is neither a path nor a declared package`,
      });
      continue;
    }
    const target = sourceFileFor(base);
    if (target === undefined) {
      edges.push({
        kind: "problem",
        detail: `${fromSrc(file)}: ${specifier} resolves to no file`,
      });
    } else if (isSourceModule(target)) {
      edges.push({ kind: "module", target });
    }
    // Anything else is an asset, such as a stylesheet: it loads no module.
  }
  edgeCache.set(file, edges);
  return edges;
}

interface Walk {
  /** Each module reached, mapped to the module that first imported it. */
  readonly from: Map<string, string | null>;
  /** References the walk could not read or resolve. */
  readonly problems: string[];
}

/**
 * Everything `entry` loads with it, breadth first, so the chain recorded to each module is a
 * shortest one: the fewest imports a fix has to consider.
 */
function staticClosure(entry: string): Walk {
  const from = new Map<string, string | null>([[entry, null]]);
  const problems = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const edge of staticEdgesOf(file)) {
      if (edge.kind === "problem") problems.add(edge.detail);
      if (edge.kind !== "module" || from.has(edge.target)) continue;
      from.set(edge.target, file);
      queue.push(edge.target);
    }
  }
  return { from, problems: [...problems] };
}

/** The import chain from the walk's entry to `module`, named from `src`. */
function chainTo(walk: Walk, module: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = module; at; at = walk.from.get(at)) {
    chain.unshift(fromSrc(at));
  }
  return chain.join(" > ");
}

/** Each drag module a walk reached, with the chain that reached it. */
const dragModulesReached = (walk: Walk): string[] =>
  [...walk.from.keys()]
    .filter(isInDragFolder)
    .map(module => `${fromSrc(module)}, through ${chainTo(walk, module)}`);

describe("the admin's shell", () => {
  const shell = staticClosure(ENTRY);

  it("loads nothing from customise mode's drag folder", () => {
    // Each entry names the drag module and the imports that reached it from `index.ts`; the fix
    // is the last edge from outside the folder, usually a constant that belongs in a module of
    // its own.
    expect(dragModulesReached(shell)).toEqual([]);
  });

  it("loads nothing the walk cannot read or resolve", () => {
    // An unresolved import is an unwalked subtree, so it fails here rather than counting as clean.
    expect(shell.problems).toEqual([]);
  });

  it("is walked past the entry, to the modules the shell is known to load", () => {
    // The control for the first case, which a walk that read nothing would pass as well.
    // `index.ts` loads everything through `export ... from`, so a walk that missed that form
    // would stop at the entry. The summary line, which once carried the drag code in, is two
    // hops out (`index.ts > WelcomeHeader.tsx > header/SummaryLine.tsx`); the widget kit is
    // exported as a folder, so it is reached only through the folder's `index.ts`.
    const summaryLine = join(
      SRC,
      "components/features/dashboard/header/SummaryLine.tsx"
    );
    expect(shell.from.has(summaryLine)).toBe(true);
    expect(
      shell.from.has(join(SRC, "components/features/widgets/kit/index.ts"))
    ).toBe(true);
    // And the alias: the summary line imports its link as `@admin/components/ui/link`.
    expect(staticEdgesOf(summaryLine)).toContainEqual({
      kind: "module",
      target: join(SRC, "components/ui/link/index.tsx"),
    });
    expect(shell.from.size).toBeGreaterThan(100);
  });

  it("is the control: the walk finds the drag folder where a static import does reach it", () => {
    // The dashboard's grid loads the drag hook with it, so the same walk from there must report
    // it, with its chain. Without this a folder renamed away, or a predicate that matches no
    // path, would make the first case pass by finding nothing.
    const grid = staticClosure(
      join(SRC, "components/features/widgets/WidgetGrid.tsx")
    );
    expect(dragModulesReached(grid)).toContain(
      "components/features/widgets/edit/drag/useCardDrag.ts, through " +
        "components/features/widgets/WidgetGrid.tsx > " +
        "components/features/widgets/edit/drag/useCardDrag.ts"
    );
  });
});
