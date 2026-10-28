/**
 * Whether each heavy dependency stays where a package's published build is meant to keep it.
 *
 * A boundary names a package, a dependency and the declaration directories that must never name
 * it. Three things hold for each one, read from the built `dist`:
 *
 * - No chunk a published browser entry loads before it renders carries the dependency. "Before
 *   it renders" is the static import closure of every entry the package's `exports` map names; a
 *   chunk reached only through a dynamic `import()` is loaded by the view that needs it.
 * - Some chunk the package ships does carry it. Without this the first check passes on a build
 *   that dropped the dependency, or on a marker that no longer matches it, and says nothing.
 * - No declaration file in the named directories imports or names it, so no published type
 *   reaches the dependency's types.
 *
 * A chunk carries a dependency when it imports the dependency's specifier (the dependency left
 * external) or holds its marker, a string literal the dependency's own code always contains (the
 * dependency bundled in, where minifying has removed every module name).
 *
 * Run after the packages are built:
 *
 *   node scripts/check-bundle-boundaries.mjs [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { literalText, parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

import { exportTargets } from "../packages/admin/scripts/check-published-build.mjs";

import { isCliEntry } from "./cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The boundaries the repository keeps.
 *
 * The chart engine draws the admin's charts. It is loaded by a chart's view alone, and its types
 * stay out of what the admin and the plugin SDK publish, so a plugin never depends on them.
 * `recharts-wrapper` is the class of the element every Recharts chart renders around itself.
 *
 * @type {readonly { name: string, packageDir: string, specifier: string, marker: string, declarationDirs: readonly string[] }[]}
 */
export const BOUNDARIES = [
  {
    name: "chart engine",
    packageDir: "packages/admin",
    specifier: "recharts",
    marker: "recharts-wrapper",
    declarationDirs: ["packages/admin/dist", "packages/plugin-sdk/dist"],
  },
];

/** Every file under `dir` whose name passes `keep`, as absolute paths. */
export function filesUnder(dir, keep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && keep(entry.name))
    .map(entry => join(entry.parentPath, entry.name));
}

/** Whether `source` names `specifier` itself or a subpath of it. */
const names = (source, specifier) => source === specifier || source?.startsWith(`${specifier}/`);

/**
 * The module specifiers a file's source names: imports, re-exports, dynamic imports of a literal,
 * and in a declaration file the `import("…")` type form.
 */
export function specifiersOf(code, fileName) {
  const found = new Set();
  walk(parseSource(code, fileName).program, node => {
    const source =
      node.type === "TSImportType"
        ? literalText(node.source ?? node.argument?.literal ?? node.argument)
        : literalText(node.source);
    if (source && /^(Import|Export\w*)Declaration$|^ImportExpression$|^TSImportType$/.test(node.type)) {
      found.add(source);
    }
  });
  return found;
}

/** The chunks of a dist and the chunks each one imports statically and dynamically, by dist path. */
export function chunkGraph(distDir) {
  const graph = new Map();
  for (const file of filesUnder(distDir, name => /\.m?js$/.test(name))) {
    const rel = relative(distDir, file).split("\\").join("/");
    const code = readFileSync(file, "utf8");
    const imports = { static: [], dynamic: [] };
    walk(parseSource(code, file).program, node => {
      const source = literalText(node.source);
      if (!source?.startsWith(".")) return;
      const target = posix.normalize(posix.join(posix.dirname(rel), source));
      if (node.type === "ImportExpression") imports.dynamic.push(target);
      else if (/^(Import|Export\w*)Declaration$/.test(node.type)) imports.static.push(target);
    });
    graph.set(rel, { code, file, ...imports });
  }
  return graph;
}

/**
 * The dist paths of the browser entries a manifest's `exports` names: every `.mjs` or `.js`
 * target under `dist/`, read through the admin's own walk of an export map.
 */
export function publishedEntries(exportsField) {
  const entries = exportTargets(exportsField)
    .map(({ target }) => /^(?:\.\/)?dist\/(.+\.m?js)$/.exec(target)?.[1])
    .filter(Boolean);
  return [...new Set(entries)].sort();
}

/** Every chunk the `entries` load before they render: their static import closure. */
export function eagerChunks(graph, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    const node = graph.get(current);
    if (!node) throw new Error(`a static import names ${current}, which the dist does not hold`);
    seen.add(current);
    queue.push(...node.static);
  }
  return seen;
}

/** Whether a chunk carries the boundary's dependency, imported or bundled in. */
export function carries(chunk, boundary, fileName) {
  if (chunk.includes(boundary.marker)) return true;
  if (!chunk.includes(boundary.specifier)) return false;
  return [...specifiersOf(chunk, fileName)].some(source => names(source, boundary.specifier));
}

/**
 * What is wrong with one boundary in the checkout at `base`, one line per problem; empty when it
 * holds.
 */
export function boundaryProblems(boundary, base = root) {
  const packageDir = join(base, boundary.packageDir);
  const distDir = join(packageDir, "dist");
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const entries = publishedEntries(manifest.exports ?? {});
  if (entries.length === 0) return [`${boundary.packageDir} publishes no browser entry under dist/`];
  const missing = entries.filter(entry => !existsSync(join(distDir, entry)));
  if (missing.length > 0) return [`${boundary.packageDir} is not built: dist/ has no ${missing.join(", ")}`];

  const graph = chunkGraph(distDir);
  const eager = eagerChunks(graph, entries);
  const carrying = [...graph].filter(([, chunk]) => carries(chunk.code, boundary, chunk.file)).map(([rel]) => rel);
  const problems = carrying
    .filter(rel => eager.has(rel))
    .map(rel => `dist/${rel} carries the ${boundary.name} (${boundary.specifier}) and an entry loads it before rendering`);
  if (carrying.length === 0) {
    problems.push(`no chunk of ${boundary.packageDir}/dist carries the ${boundary.name}: is "${boundary.marker}" still its marker?`);
  }
  for (const dir of boundary.declarationDirs) {
    const declarations = filesUnder(join(base, dir), name => /\.d\.[cm]?ts$/.test(name));
    if (declarations.length === 0) problems.push(`${dir} holds no declaration file: is it built?`);
    for (const file of declarations) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(boundary.specifier)) continue;
      if ([...specifiersOf(text, file)].some(source => names(source, boundary.specifier))) {
        problems.push(`${relative(base, file)} names ${boundary.specifier}, so a published type reaches the ${boundary.name}`);
      }
    }
  }
  return problems;
}

/** Checks every boundary and returns the exit code: 0 when all hold, 1 when one does not. */
export function main(base = root, boundaries = BOUNDARIES) {
  let failed = 0;
  for (const boundary of boundaries) {
    const problems = boundaryProblems(boundary, base);
    if (problems.length === 0) {
      console.log(`bundle-boundaries: OK — the ${boundary.name} loads only where a view asks for it`);
      continue;
    }
    failed += 1;
    console.error(`bundle-boundaries: the ${boundary.name} is out of bounds:`);
    for (const problem of problems) console.error(`  ${problem}`);
  }
  return failed === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  const at = process.argv.indexOf("--root");
  if (at !== -1 && !process.argv[at + 1]) {
    console.error("usage: node scripts/check-bundle-boundaries.mjs [--root <dir>]");
    process.exit(64);
  }
  process.exit(main(at === -1 ? root : resolve(process.argv[at + 1])));
}
