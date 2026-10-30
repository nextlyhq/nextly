/**
 * A static walk over the package's source: what a module loads with it, read
 * through the repository's one reader of what a file loads, with no module
 * evaluated, so a test built on it is light itself.
 *
 * It follows what a file loads with it: type-only references erase, and an
 * `import()` loads only when it runs. Its limit: an `import()` that runs
 * while the module initialises (a top-level `await import()`, or one inside a
 * function called at load) is read as deferred, because telling those apart
 * needs control-flow analysis; the module budget catches what that costs.
 *
 * Resolution is the package's own: relative paths, the `paths` in its
 * `tsconfig.json`, and explicit `.ts`/`.js` extensions. A reference it cannot
 * read or resolve is reported rather than counted as importing nothing, and
 * so is one to the package by its own name (`nextly`, `nextly/runtime`): that
 * loads a built entry, which re-exports the registry, from inside it.
 *
 * @module __tests__/static-import-walk
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep, type win32 } from "node:path";
import { fileURLToPath } from "node:url";

import {
  moduleSpecifierRefs,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SRC = join(PACKAGE, "src");

/** A module under `src`, with `/` on every platform. */
export const fromSrc = (file: string): string =>
  relative(SRC, file).split(sep).join("/");

/** The package's own name, which a file inside it may import itself by. */
export const PACKAGE_NAME = (
  JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
    name: string;
  }
).name;

/** Whether a specifier names this package itself, or one of its subpaths. */
export const isSelfReference = (specifier: string): boolean =>
  specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`);

/**
 * The `paths` of the package's `tsconfig.json`, longest prefix first, which is
 * the order TypeScript tries them in.
 */
const PATHS = Object.entries(
  (
    JSON.parse(readFileSync(join(PACKAGE, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths?: Record<string, string[]> };
    }
  ).compilerOptions.paths ?? {}
).sort(([a], [b]) => b.replace("*", "").length - a.replace("*", "").length);

/** The paths a non-relative specifier maps to, or undefined for a package. */
export function aliased(specifier: string): string[] | undefined {
  for (const [pattern, targets] of PATHS) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      if (specifier === pattern) return targets.map(t => resolve(PACKAGE, t));
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      const rest = specifier.slice(
        prefix.length,
        specifier.length - suffix.length
      );
      return targets.map(t => resolve(PACKAGE, t.replace("*", rest)));
    }
  }
  return undefined;
}

/**
 * The files a path may name: as written, by extension, or as a folder. A
 * folder's index is joined with the platform's separator, so on Windows it is
 * spelled as every other path in the walk is; joined with `/`, it named the
 * same file in a spelling no lookup matched, and a module loaded as a folder
 * read as never reached.
 */
export function candidatesFor(
  base: string,
  path: Pick<typeof win32, "join"> = { join }
): string[] {
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base, base.replace(/\.([cm]?)js(x?)$/, ".$1ts$2")]
    : [];
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx")
  );
  return candidates;
}

/** The source file a path names, of the candidates that exist. */
export function sourceFile(base: string): string | undefined {
  return candidatesFor(base).find(
    file => existsSync(file) && statSync(file).isFile()
  );
}

/** A module a file loads, and whether it loads only when it runs. */
type Edge =
  | { kind: "module"; target: string; dynamic: boolean }
  | {
      kind: "unread" | "unresolved" | "self-reference";
      detail: string;
      dynamic: boolean;
    };

/**
 * Each file's runtime edges, read once: every command's walk crosses the same
 * shared modules, and parsing them per walk made this test slow.
 */
const edgeCache = new Map<string, Edge[]>();

function edgesOf(file: string): Edge[] {
  const cached = edgeCache.get(file);
  if (cached) return cached;
  const edges: Edge[] = [];
  for (const ref of moduleSpecifierRefs(readFileSync(file, "utf8"), file)) {
    if (ref.typeOnly) continue;
    const { specifier, dynamic } = ref;
    if (specifier === UNRESOLVABLE_SPECIFIER) {
      edges.push({ kind: "unread", detail: fromSrc(file), dynamic });
      continue;
    }
    if (isSelfReference(specifier)) {
      edges.push({
        kind: "self-reference",
        detail: `${fromSrc(file)}: ${specifier}`,
        dynamic,
      });
      continue;
    }
    const bases = specifier.startsWith(".")
      ? [resolve(dirname(file), specifier)]
      : aliased(specifier);
    // A package, resolved outside this source tree.
    if (bases === undefined) continue;
    const target = bases.map(sourceFile).find(found => found !== undefined);
    edges.push(
      target === undefined
        ? {
            kind: "unresolved",
            detail: `${fromSrc(file)}: ${specifier}`,
            dynamic,
          }
        : { kind: "module", target, dynamic }
    );
  }
  edgeCache.set(file, edges);
  return edges;
}

export interface Walk {
  /** Each module reached, mapped to the module that imported it. */
  from: Map<string, string | null>;
  /** References the walk could not read or resolve. */
  problems: string[];
}

/** What `entry` loads. With `lazy`, an `import()` is followed too. */
export function loads(entry: string, lazy = false): Walk {
  const from = new Map<string, string | null>([[entry, null]]);
  const problems: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const edge of edgesOf(file)) {
      if (edge.dynamic && !lazy) continue;
      if (edge.kind !== "module") {
        problems.push(`${edge.kind}: ${edge.detail}`);
        continue;
      }
      if (from.has(edge.target)) continue;
      from.set(edge.target, file);
      queue.push(edge.target);
    }
  }
  return { from, problems: [...new Set(problems)] };
}

/** The import chain from the walk's entry to `module`. */
export function chainTo(walk: Walk, module: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = module; at; at = walk.from.get(at)) {
    chain.unshift(fromSrc(at));
  }
  return chain.join(" > ");
}
