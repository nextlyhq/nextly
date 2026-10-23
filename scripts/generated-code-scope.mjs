#!/usr/bin/env node
/**
 * Prints the INERT_PATHS pattern for `.github/workflows/generated-code-compiles.yml`:
 * every path is inert EXCEPT the ones that shape what `generate:types` writes or
 * how it resolves in an app.
 *
 * The generators' own source is found by following their relative imports, so a
 * helper they come to depend on is covered the day it is imported, rather than
 * when someone remembers to list it. Added to that closure: the command, the code
 * plugins contribute to generated files, nextly's manifest and build entries (its
 * exports and its zod range), the templates a project starts from, the workflow,
 * and this script.
 *
 *   node scripts/generated-code-scope.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = "packages/nextly/src";

/** What generation runs, and what decides where its output goes. */
export const entries = [
  `${src}/domains/schema/services/type-generator.ts`,
  `${src}/domains/schema/services/zod-generator.ts`,
  `${src}/shared/lib/generated-output-paths.ts`,
  `${src}/cli/utils/write-generated-types.ts`,
  `${src}/zod.ts`,
];

/** Paths outside the import closure that still change the output or the check. */
export const extras = [
  `${src}/cli/commands/generate-types.ts`,
  `${src}/plugins/codegen/`,
  "packages/nextly/package.json",
  "packages/nextly/tsdown.config.ts",
  "templates/",
  ".github/workflows/generated-code-compiles.yml",
  "scripts/generated-code-scope.mjs",
];

/** A relative specifier as the file it names, or null for one that names none. */
function resolveImport(fromFile, specifier) {
  const base = resolve(root, dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    base,
  ]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) {
      return relative(root, candidate);
    }
  }
  return null;
}

/**
 * The generators' source: every file reached from `entries` through value
 * imports. A type-only import cannot change what they emit, and following one
 * pulls in most of the package; a template literal (`./${slug}.zod`) names
 * generated output, not source.
 */
export function importClosure() {
  const closure = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (closure.has(file)) continue;
    closure.add(file);
    queue.push(...valueImports(file));
  }
  return closure;
}

/** The files one source file imports for values, through static specifiers. */
function valueImports(file) {
  const source = readFileSync(join(root, file), "utf8");
  const specifiers = source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"]*?\sfrom\s*)?"(\.[^"]+)"/g
  );
  return [...specifiers]
    .map(([, specifier]) => resolveImport(file, specifier))
    .filter(Boolean);
}

/** The pattern of paths a change may touch and still skip the check. */
export function inertPattern() {
  const escape = path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const paths = [...[...importClosure()].sort(), ...extras].map(escape);
  return `^(?!(${paths.join("|")}))`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(inertPattern());
}
