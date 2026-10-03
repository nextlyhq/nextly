#!/usr/bin/env node

/**
 * What `@nextlyhq/admin` publishes, read as a production application gets it.
 *
 * The package is published prebuilt, and its build settles what a user sees:
 * built in development mode, it shows production users an error's message and
 * stack trace and the query developer tools, and dials a route that exists
 * only on a development server. The unit suites import the source and the
 * playground loads the source, so a build that came out wrong passes them all.
 * This reads the built files instead.
 *
 * It answers for the PACKED package, since that is what an application
 * installs: every file the export map names must be in it, and only code the
 * export map's entries reach is judged. Reach matters. A correct build still
 * holds the developer tools' code, in a chunk nothing imports, so a search of
 * every file would report a build that shows them to nobody.
 *
 * Each module is folded for production before its imports are followed:
 * `process.env.NODE_ENV` becomes "production" and the code that leaves dead is
 * dropped, which is what an application's own production build does to it. A
 * package that leaves the mode to the application is therefore judged by what
 * a production application keeps of it.
 *
 * ⚠️ The limit, stated rather than covered badly. The error boxes and the
 * developer tools are recognised by text they contain, listed below. A new
 * development-only box with other text is not recognised. What keeps the list
 * honest is the `--must-fail-with` run in CI: the admin is built in development
 * mode and this check must report both kinds on it, so a text that was renamed
 * away fails there instead of passing quietly here.
 *
 * Usage:
 *   node scripts/check-published-build.mjs
 *       packs this package and checks the packed files
 *   node scripts/check-published-build.mjs --packed <dir>
 *       checks a directory holding a package as it would be packed
 *   node scripts/check-published-build.mjs --packed <dir> --must-fail-with <kind,...>
 *       succeeds only if the check reports every named kind
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { minify } from "terser";
import ts from "typescript";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The expression a build or an application replaces with its mode. */
const MODE = "process.env.NODE_ENV";

const SCRIPT = /\.[cm]?js$/;

/**
 * Text only the development-only error boxes hold: the page-level box that
 * shows an error's message and stack, and the section and boundary boxes that
 * show its message.
 */
export const ERROR_DETAIL_TEXTS = ["View technical details", "Error details"];

/** The class prefix every element of the query developer tools carries. */
export const DEVELOPER_TOOLS_MARKER = "tsqd-";

/** The names the builder's addresses have in the admin's route constants. */
const BUILDER_NAME = /^BUILDER_/;

// ---------------------------------------------------------------------------
// The export map
// ---------------------------------------------------------------------------

/**
 * Every file an export map names, with the entry that names it.
 *
 * A key that starts with a dot is an entry (`.`, `./lib/x`); any other key is a
 * condition under one (`types`, `import`, `default`), nested to any depth.
 */
export function exportTargets(exportsField, entry = ".") {
  if (typeof exportsField === "string") {
    return [{ entry, target: posix.normalize(exportsField) }];
  }
  return Object.entries(exportsField ?? {}).flatMap(([key, value]) =>
    exportTargets(value, key.startsWith(".") ? key : entry)
  );
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** The export map's targets the package does not hold. */
export function missingTargets(packageDir, targets) {
  return targets.filter(({ target }) => !isFile(join(packageDir, target)));
}

/** The scripts the export map names and the package holds, each once. */
export function scriptEntries(packageDir, targets) {
  const scripts = targets
    .map(({ target }) => target)
    .filter(target => SCRIPT.test(target) && isFile(join(packageDir, target)));
  return [...new Set(scripts)];
}

// ---------------------------------------------------------------------------
// What the entries reach
// ---------------------------------------------------------------------------

/**
 * A module as an application's production build leaves it.
 *
 * Only the folding is switched on: the mode is replaced, the comparisons made
 * constant by that are evaluated, and the branches they leave dead are
 * dropped. Every other compression is off, on purpose. The defaults also
 * inline constants into their uses, and the route table below is read by the
 * names of its keys, which inlining would replace with their values.
 *
 * A module that never mentions the mode is returned as it is: there is nothing
 * to fold, and running megabytes of already-minified code through a compressor
 * to learn that would be most of this check's run time.
 */
export async function foldForProduction(code) {
  if (!code.includes(MODE)) return code;
  const folded = await minify(code, {
    module: true,
    mangle: false,
    compress: {
      defaults: false,
      global_defs: { [MODE]: "production" },
      evaluate: true,
      comparisons: true,
      booleans: true,
      conditionals: true,
      dead_code: true,
    },
    format: { comments: false },
  });
  return folded.code ?? "";
}

function parse(file, code) {
  return ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    // Parents are set because where a node sits decides what it means below:
    // whether a stream is opened inside a function or as the module loads.
    true,
    ts.ScriptKind.JS
  );
}

function staticSpecifier(node) {
  const from = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  return from && node.moduleSpecifier ? node.moduleSpecifier.text : null;
}

function dynamicSpecifier(node) {
  const isImport =
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const [argument] = isImport ? node.arguments : [];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

/**
 * Every node of a tree.
 *
 * With a stack of its own rather than by recursion: minified code chains
 * thousands of expressions into one, and a tree that deep overflows the call
 * stack of anything that recurses into it.
 */
function nodesOf(tree) {
  const nodes = [];
  const pending = [tree];
  while (pending.length > 0) {
    const node = pending.pop();
    nodes.push(node);
    ts.forEachChild(node, child => {
      pending.push(child);
    });
  }
  return nodes;
}

/** The files inside the package a module imports, statically or on demand. */
export function importsOf(tree) {
  const specifiers = [];
  for (const node of nodesOf(tree)) {
    const specifier = staticSpecifier(node) ?? dynamicSpecifier(node);
    if (specifier?.startsWith(".")) specifiers.push(specifier);
  }
  return specifiers;
}

async function readModule(packageDir, file) {
  const path = join(packageDir, file);
  if (!isFile(path)) return null;
  const code = await foldForProduction(readFileSync(path, "utf8"));
  return { code, tree: parse(file, code) };
}

/**
 * The modules the entries reach, and the imports that lead to no file.
 *
 * Files are named relative to the package, with `/`, on every platform.
 */
export async function reachableModules(packageDir, entries) {
  const modules = new Map();
  const missing = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (modules.has(file) || missing.includes(file)) continue;
    const module = await readModule(packageDir, file);
    if (!module) {
      missing.push(file);
      continue;
    }
    modules.set(file, module);
    const from = posix.dirname(file);
    queue.push(...importsOf(module.tree).map(to => posix.join(from, to)));
  }
  return { modules, missing };
}

// ---------------------------------------------------------------------------
// What the reached code would do
// ---------------------------------------------------------------------------

function textFindings(file, code, kind, texts, what) {
  return texts
    .filter(text => code.includes(text))
    .map(text => ({ kind, message: `${file} ${what}: it holds "${text}"` }));
}

const FUNCTIONS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

function withoutParentheses(node) {
  return ts.isParenthesizedExpression(node.parent) ? node.parent : node;
}

/** Whether a function is called where it is written, as `(() => { … })()` is. */
function calledOnTheSpot(fn) {
  const callee = withoutParentheses(fn);
  return (
    ts.isCallExpression(callee.parent) && callee.parent.expression === callee
  );
}

/** Whether a node runs only when some function is called, not as its module loads. */
function runsOnlyWhenCalled(node) {
  for (let above = node.parent; above; above = above.parent) {
    if (FUNCTIONS.has(above.kind) && !calledOnTheSpot(above)) return true;
  }
  return false;
}

function opensStream(node) {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "EventSource"
  );
}

/**
 * Streams opened as a module loads.
 *
 * The reload stream is meant to open only once the running server has said it
 * is a development server, which the admin learns inside a function. One
 * opened at load is opened in every application, on every host.
 */
export function eagerStreams(file, tree) {
  return nodesOf(tree)
    .filter(node => opensStream(node) && !runsOnlyWhenCalled(node))
    .map(node => ({
      kind: "eager-reload-stream",
      message: `${file} opens a stream as it loads: ${node.getText().slice(0, 80)}`,
    }));
}

function builderName(expression) {
  const named =
    expression &&
    ts.isPropertyAccessExpression(expression) &&
    BUILDER_NAME.test(expression.name.text);
  return named ? expression.name.text : null;
}

function addressOf(node) {
  const isAddress =
    ts.isPropertyAssignment(node) &&
    ts.isIdentifier(node.name) &&
    BUILDER_NAME.test(node.name.text) &&
    ts.isStringLiteralLike(node.initializer);
  return isAddress ? [node.name.text, node.initializer.text] : null;
}

function isNamed(property, name) {
  return (
    property.name !== undefined &&
    ts.isIdentifier(property.name) &&
    property.name.text === name
  );
}

function hasComponent(value) {
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.some(property => isNamed(property, "component"))
  );
}

function routeOf(node) {
  const isRoute =
    ts.isPropertyAssignment(node) &&
    ts.isComputedPropertyName(node.name) &&
    hasComponent(node.initializer);
  return isRoute ? builderName(node.name.expression) : null;
}

function removalOf(node) {
  const removes =
    ts.isDeleteExpression(node) &&
    ts.isElementAccessExpression(node.expression);
  return removes ? builderName(node.expression.argumentExpression) : null;
}

/**
 * The builder's addresses, and which of them the route table serves.
 *
 * An address is a `BUILDER_*` route constant. It has a page when the route
 * table has an entry keyed by that constant, and none when the entry is absent
 * or the table deletes it as the package loads. The constant alone proves
 * nothing: links to a page outlive the page.
 */
export function builderRoutes(trees) {
  const routes = {
    addresses: new Map(),
    served: new Set(),
    removed: new Set(),
  };
  for (const node of trees.flatMap(tree => nodesOf(tree))) {
    const address = addressOf(node);
    if (address) routes.addresses.set(...address);
    const served = routeOf(node);
    if (served) routes.served.add(served);
    const removed = removalOf(node);
    if (removed) routes.removed.add(removed);
  }
  return routes;
}

function builderFindings({ addresses, served, removed }) {
  if (addresses.size === 0) {
    return [
      {
        kind: "builder-pages-unread",
        message:
          "no BUILDER_* route constant was found, so the builder's pages cannot be checked",
      },
    ];
  }
  const kind = "missing-builder-page";
  return [...addresses].flatMap(([name, address]) => [
    ...(served.has(name)
      ? []
      : [{ kind, message: `${address} has no page in the route table` }]),
    ...(removed.has(name)
      ? [
          {
            kind,
            message: `${address} is deleted from the route table at load`,
          },
        ]
      : []),
  ]);
}

function moduleFindings(file, { code, tree }) {
  return [
    ...textFindings(
      file,
      code,
      "error-detail",
      ERROR_DETAIL_TEXTS,
      "would show a production user an error's detail"
    ),
    ...textFindings(
      file,
      code,
      "developer-tools",
      [DEVELOPER_TOOLS_MARKER],
      "would show a production user the query developer tools"
    ),
    ...eagerStreams(file, tree),
  ];
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

function readManifest(packageDir) {
  const path = join(packageDir, "package.json");
  return isFile(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/**
 * Every problem in a packed package, each with the kind a caller can name.
 *
 * An empty answer means every check ran and found nothing. A package with no
 * script to read is itself a problem, never an empty answer.
 */
export async function checkPublishedBuild(packageDir) {
  const targets = exportTargets(readManifest(packageDir).exports);
  const entries = scriptEntries(packageDir, targets);
  const problems = missingTargets(packageDir, targets).map(target => ({
    kind: "missing-export-target",
    message: `the export map's "${target.entry}" names ${target.target}, which the package does not hold`,
  }));
  if (entries.length === 0) {
    problems.push({
      kind: "no-build-output",
      message: "the export map names no script that the package holds",
    });
    return { problems, modules: 0 };
  }
  const { modules, missing } = await reachableModules(packageDir, entries);
  problems.push(
    ...missing.map(file => ({
      kind: "missing-module",
      message: `${file} is imported and the package does not hold it`,
    })),
    ...[...modules].flatMap(([file, module]) => moduleFindings(file, module)),
    ...builderFindings(builderRoutes([...modules.values()].map(m => m.tree)))
  );
  return { problems, modules: modules.size };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * This package, packed as a release packs it, in a directory of its own.
 *
 * `pnpm pack` applies the manifest's `files`, as `pnpm publish` does, so a
 * file the export map names and `files` leaves out is missing here too.
 */
function packInto(directory) {
  execFileSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: PACKAGE_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(directory).find(name => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack wrote no tarball");
  execFileSync("tar", ["-xzf", join(directory, tarball), "-C", directory]);
  return join(directory, "package");
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

/** The kinds a `--must-fail-with` run names and the check did not report. */
export function unreported(expected, problems) {
  const reported = new Set(problems.map(problem => problem.kind));
  return expected.filter(kind => !reported.has(kind));
}

function report(problems) {
  for (const { kind, message } of problems)
    console.error(`  ${kind}: ${message}`);
}

async function runExpectingFailure(packageDir, expected) {
  const { problems } = await checkPublishedBuild(packageDir);
  const absent = unreported(expected, problems);
  if (absent.length > 0) {
    console.error(
      `check-published-build: expected this build to fail with ${expected.join(", ")}; not reported: ${absent.join(", ")}`
    );
    report(problems);
    return 1;
  }
  console.log(
    `check-published-build: ok, this build fails as it should (${expected.join(", ")}).`
  );
  return 0;
}

async function runCheck(packageDir) {
  const { problems, modules } = await checkPublishedBuild(packageDir);
  if (problems.length > 0) {
    console.error(
      `check-published-build: ${problems.length} problem(s) in what the admin would publish:`
    );
    report(problems);
    return 1;
  }
  console.log(
    `check-published-build: ok, ${modules} module(s) reached from the export map; no development-only behaviour, and every builder address has its page.`
  );
  return 0;
}

async function main(argv) {
  const packed = option(argv, "--packed");
  const expected = option(argv, "--must-fail-with");
  const scratch = packed ? null : mkdtempSync(join(tmpdir(), "nx-admin-pack-"));
  try {
    const packageDir = packed ? resolve(packed) : packInto(scratch);
    return expected
      ? await runExpectingFailure(packageDir, expected.split(","))
      : await runCheck(packageDir);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-published-build.mjs");

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
