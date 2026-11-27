#!/usr/bin/env node
/**
 * Fails when an AI or MCP library is anywhere in core's dependency tree.
 *
 * Core's packages (`nextly` with its CLI, `@nextlyhq/admin` and
 * `@nextlyhq/plugin-sdk`) hold no AI SDK, provider SDK, MCP SDK or agent
 * framework, directly or through anything they depend on: those change far
 * faster than a CMS core and belong to the opt-in packages (`@nextlyhq/ai`,
 * `@nextlyhq/mcp`, `@nextlyhq/plugin-mcp`). A manifest check sees only the
 * direct dependencies, and an indirect one ships just the same, so this
 * walks the resolved tree in `pnpm-lock.yaml` and names the path that
 * brought a library in.
 *
 * Two modes:
 *
 *   node scripts/check-core-ai-libraries.mjs [--lockfile <path>]
 *     The resolved tree in `pnpm-lock.yaml` (the working directory's, or
 *     the one named) of each core package: its dependencies,
 *     optional dependencies and development dependencies, then everything
 *     those resolve to, through workspace links too.
 *
 *   node scripts/check-core-ai-libraries.mjs --installed <node_modules>
 *     The modules actually installed in a project, for a project made
 *     without the opt-in packages.
 *
 * Reads the lockfile as text with no dependencies of its own, so it runs in
 * a job that installs nothing, and a pull request's lockfile is judged by
 * the checker from the branch it merges into without running anything of
 * the change's.
 *
 * @module scripts/check-core-ai-libraries
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** Core's packages, by their workspace directory in the lockfile. */
export const CORE_IMPORTERS = [
  "packages/nextly",
  "packages/admin",
  "packages/plugin-sdk",
];

/**
 * The libraries core may never hold: exact names, and scopes (ending in
 * `/`) whose every package counts.
 */
export const AI_LIBRARIES = [
  "ai",
  "@ai-sdk/",
  "@modelcontextprotocol/",
  "openai",
  "@anthropic-ai/",
  "@google/generative-ai",
  "@google/genai",
  "@mistralai/",
  "cohere-ai",
  "groq-sdk",
  "ollama",
  "replicate",
  "langchain",
  "@langchain/",
  "llamaindex",
  "@llamaindex/",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
];

/** Whether a package name is one of {@link AI_LIBRARIES}. */
export function isAILibrary(name) {
  return AI_LIBRARIES.some(library =>
    library.endsWith("/") ? name.startsWith(library) : name === library
  );
}

/** A YAML scalar as pnpm writes it: plain or single-quoted. */
function unquote(text) {
  const value = text.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** A `key: value` or `key:` line, with its key unquoted. */
function keyValue(line) {
  const text = line.trim();
  // A quoted key may itself hold `: ` (`'a@1(b: c)'`), so it is read whole.
  const quoted = /^('(?:[^']|'')*'|"[^"]*")\s*:(.*)$/.exec(text);
  if (quoted) return { key: unquote(quoted[1]), value: quoted[2].trim() };
  const at = text.indexOf(":");
  if (at === -1) return null;
  return { key: text.slice(0, at), value: text.slice(at + 1).trim() };
}

const indentOf = line => line.length - line.trimStart().length;

/** The dependency groups this reads, in importers and snapshots. */
const IMPORTER_GROUPS = new Set([
  "dependencies",
  "optionalDependencies",
  "devDependencies",
]);
const SNAPSHOT_GROUPS = new Set(["dependencies", "optionalDependencies"]);

/** The document that holds the project: its importers name workspace packages. */
function projectDocument(text) {
  const documents = text.split(/^---\s*$/m).filter(doc => doc.trim() !== "");
  return (
    documents.find(doc => /^ {2}packages\//m.test(doc)) ??
    documents[documents.length - 1] ??
    ""
  );
}

/**
 * One line of `importers`, by its depth: an importer, one of its dependency
 * groups, a dependency, or the dependency's resolved `version`.
 */
function readImporterLine(state, indent, { key, value }) {
  if (indent === 2) {
    state.owner = { groups: new Map() };
    state.lock.importers.set(key, state.owner);
    state.group = state.dependency = null;
  } else if (indent === 4 && state.owner) {
    state.group = IMPORTER_GROUPS.has(key) ? new Map() : null;
    if (state.group) state.owner.groups.set(key, state.group);
    state.dependency = null;
  } else if (indent === 6 && state.group) {
    state.dependency = key;
  } else if (indent === 8 && state.dependency && key === "version") {
    state.group?.set(state.dependency, unquote(value));
  }
}

/** One line of `snapshots`: a resolved package, a group, or a dependency. */
function readSnapshotLine(state, indent, { key, value }) {
  if (indent === 2) {
    state.owner = { dependencies: new Map() };
    state.lock.snapshots.set(key, state.owner);
    state.group = null;
  } else if (indent === 4 && state.owner) {
    state.group = SNAPSHOT_GROUPS.has(key) ? state.owner.dependencies : null;
  } else if (indent === 6 && state.group) {
    state.group.set(key, unquote(value));
  }
}

const SECTION_READERS = {
  importers: readImporterLine,
  snapshots: readSnapshotLine,
};

/**
 * The project's resolved tree from `pnpm-lock.yaml`: for each importer, its
 * dependencies by group (name to resolved version); for each snapshot (a
 * resolved package, keyed `name@version`), what it depends on.
 *
 * The lockfile may hold more than one document (pnpm's own toolchain comes
 * first); the project's is the one whose importers name a workspace package.
 */
export function readLockfile(text) {
  const state = {
    lock: { importers: new Map(), snapshots: new Map() },
    reader: undefined,
    owner: null,
    group: null,
    dependency: null,
  };
  for (const raw of projectDocument(text).split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const entry = keyValue(raw);
    if (entry === null) continue;
    const indent = indentOf(raw);
    if (indent === 0) {
      state.reader = SECTION_READERS[entry.key];
      state.owner = state.group = state.dependency = null;
    } else {
      state.reader?.(state, indent, entry);
    }
  }
  return state.lock;
}

/** The package name a snapshot key names: `@a/b@1(c@2)` is `@a/b`. */
function nameOfSnapshot(key) {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return at === -1 ? key : key.slice(0, at);
}

/**
 * Where a dependency resolves: a workspace importer for `link:`, otherwise
 * a snapshot key. An alias (`foo: real@1.0.0`) names the real package.
 */
function resolve(fromImporter, name, version) {
  if (version.startsWith("link:")) {
    const target = posix.normalize(
      posix.join(fromImporter ?? ".", version.slice("link:".length))
    );
    return { importer: target };
  }
  if (/^(@[^@/]+\/)?[^@/]+@/.test(version) && !/^\d/.test(version)) {
    return { snapshot: version };
  }
  return { snapshot: `${name}@${version}` };
}

/**
 * Every AI or MCP library in the resolved tree of `roots` (importer paths),
 * each with the path from its root that brought it in, shortest first. The
 * roots' development dependencies count; anything further down counts by
 * what it ships.
 *
 * `unresolved` lists what the tree points at that the lockfile does not
 * hold. A subtree that cannot be read is one the check cannot vouch for, so
 * the check fails on it rather than passing over it.
 */
export function walkCoreTree(lock, roots = CORE_IMPORTERS) {
  const found = [];
  const unresolved = [];
  const seen = new Set();
  const queue = roots.map(root => ({
    importer: root,
    path: [root],
    isRoot: true,
  }));
  while (queue.length > 0) {
    const node = queue.shift();
    const id = nodeId(node);
    if (seen.has(id)) continue;
    seen.add(id);
    const dependencies = dependenciesOf(lock, node);
    if (dependencies === undefined) {
      unresolved.push({
        entry: node.importer ?? node.snapshot,
        path: node.path,
      });
      continue;
    }
    for (const [name, version] of dependencies) {
      const step = stepTo(node, name, version);
      if (step.library) found.push({ library: step.library, path: step.path });
      else queue.push(step.next);
    }
  }
  return { libraries: found, unresolved, reached: seen.size };
}

const nodeId = node =>
  node.importer !== undefined ? `i:${node.importer}` : `s:${node.snapshot}`;

/**
 * What a node depends on, or undefined when the lockfile does not hold it.
 * A workspace package past a root ships its dependencies, not the tools it
 * is developed with.
 */
function dependenciesOf(lock, node) {
  if (node.importer === undefined) {
    const snapshot = lock.snapshots.get(node.snapshot);
    return snapshot === undefined ? undefined : [...snapshot.dependencies];
  }
  const importer = lock.importers.get(node.importer);
  if (importer === undefined) return undefined;
  return [...importer.groups]
    .filter(([group]) => node.isRoot || group !== "devDependencies")
    .flatMap(([, group]) => [...group]);
}

/**
 * One dependency of `node`: an AI library found there, or the node to walk
 * next. Each step of the path is named as the lockfile names it: a
 * workspace package by its directory, anything else by its resolved key.
 */
function stepTo(node, name, version) {
  const next = resolve(node.importer, name, version);
  const realName =
    next.snapshot !== undefined ? nameOfSnapshot(next.snapshot) : name;
  const path = [...node.path, next.importer ?? next.snapshot];
  if (isAILibrary(realName) || isAILibrary(name))
    return { library: realName, path };
  return { next: { ...next, path, isRoot: false } };
}

/**
 * Every AI or MCP library installed under `nodeModules`, by the directory
 * it is installed in: npm's nested `node_modules` included, and pnpm's
 * `.pnpm` store read through the packages it holds.
 */
export function findInstalledAILibraries(nodeModules) {
  const found = [];
  const visit = dir => {
    for (const [name, path] of installedIn(dir)) {
      if (isAILibrary(name)) found.push({ library: name, path: [path] });
      else visit(join(path, "node_modules"));
    }
  };
  visit(nodeModules);
  return found;
}

/** The directories under `dir`, skipping files and `.bin`. */
function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(
    entry =>
      (entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== ".bin"
  );
}

/**
 * The packages installed directly in a `node_modules` directory, as
 * `[name, path]`: scoped ones under their scope, and the packages pnpm's
 * `.pnpm` store holds.
 */
function installedIn(dir) {
  return subdirectories(dir).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.name === ".pnpm") {
      return subdirectories(full).flatMap(stored =>
        installedIn(join(full, stored.name, "node_modules"))
      );
    }
    if (entry.name.startsWith("@")) {
      return subdirectories(full).map(scoped => [
        `${entry.name}/${scoped.name}`,
        join(full, scoped.name),
      ]);
    }
    return [[entry.name, full]];
  });
}

/** The report a finding prints: the library, then the path that brought it in. */
export function describeFinding({ library, path }) {
  return `${library}: ${path.join(" > ")}`;
}

/** The value after `flag` in `argv`, `missing` when the flag is absent. */
function option(argv, flag, missing) {
  const at = argv.indexOf(flag);
  return at === -1 ? missing : argv[at + 1];
}

/** `--installed <node_modules>`: the modules a project installed. */
export function checkInstalled(dir) {
  if (dir === undefined || !existsSync(dir)) {
    console.error(
      `core AI libraries: no installed modules at ${dir ?? "(none given)"}.`
    );
    return 1;
  }
  return report(findInstalledAILibraries(dir), `none installed in ${dir}`);
}

/** The lockfile's resolved tree of core's packages. */
export function checkLockfile(lockfile) {
  if (lockfile === undefined || !existsSync(lockfile)) {
    console.error(
      `core AI libraries: no lockfile at ${lockfile ?? "(none given)"}.`
    );
    return 1;
  }
  const tree = walkCoreTree(readLockfile(readFileSync(lockfile, "utf8")));
  if (tree.unresolved.length > 0) {
    console.error(
      "core AI libraries: the lockfile does not hold what these point at, so their trees were not read:"
    );
    for (const finding of tree.unresolved) {
      console.error(
        `  ${describeFinding({ library: finding.entry, path: finding.path })}`
      );
    }
    return 1;
  }
  return report(
    tree.libraries,
    `none among the ${tree.reached} packages in the resolved tree of ${CORE_IMPORTERS.join(", ")}`
  );
}

function main(argv) {
  return argv.includes("--installed")
    ? checkInstalled(option(argv, "--installed"))
    : checkLockfile(
        option(argv, "--lockfile", join(process.cwd(), "pnpm-lock.yaml"))
      );
}

/** Print the findings, or the clean line; the exit code they mean. */
function report(findings, clean) {
  if (findings.length === 0) {
    console.log(`core AI libraries: ${clean}.`);
    return 0;
  }
  console.error(
    "AI or MCP libraries belong to the opt-in packages (@nextlyhq/ai, @nextlyhq/mcp, @nextlyhq/plugin-mcp), never to core:"
  );
  for (const finding of findings)
    console.error(`  ${describeFinding(finding)}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
