/**
 * Verify that a server-safe entry point, as BUILT, runs on a server.
 *
 * The directive guard next to this one answers a different question: whether the artifact carries
 * a `"use client"` banner. An artifact can be free of that banner and still be unusable from a
 * Server Component, because the banner is not what breaks it — importing React is, or touching
 * `document` while the module body evaluates.
 *
 * This reads the BUILT files rather than the sources, and that is the point. A source scan has to
 * predict what the bundler will do: which specifier a bare import resolves to, whether an
 * extensionless path picks the `.ts` or the `.tsx`, whether a folded expression like
 * `import("re" + "act")` reaches React, which type-only imports are erased. Every one of those is
 * already decided here. What is left is a short, finite list of external specifiers, and a file
 * that either evaluates under Node or does not.
 *
 * Two questions, one per way of crossing the boundary:
 *
 * 1. **Does it evaluate?** The artifact is imported into this process, which is Node with no DOM.
 *    A module reading `document` where its body runs throws, and nothing has to recognise the
 *    spelling of the read for that to happen. This is the complete answer to the browser-global
 *    question, in place of enumerating globals and the syntax that dereferences them.
 *
 * 2. **What does it reach?** Every module specifier surviving in the artifact must be on the
 *    allow-list. First-party code is bundled in, so what remains is exactly the external packages,
 *    and JSX has already become a `react/jsx-runtime` import by the time it gets here.
 *
 * ## What this proves, and what it does not
 *
 * The evaluation runs on the Node that runs the BUILD, with the web globals Node has added since
 * the supported floor removed first. That is enough to answer the browser-global question for the
 * whole `engines` range, because those globals are the only difference that a deletion can model.
 *
 * It is NOT enough for built-in MODULES. An artifact importing something added after the floor —
 * `node:sqlite`, say — resolves on a current build machine and fails on the floor with
 * `ERR_UNKNOWN_BUILTIN_MODULE`, and no amount of deleting globals emulates that. Only running this
 * gate under the oldest supported Node settles it; nothing here can.
 *
 * It answers IMPORT safety, not call safety. `export const cn = () => document.body` imports
 * cleanly and throws when a Server Component calls it. Catching that means analysing browser
 * globals in deferred code — every way a name can be bound, shadowed or consumed — which is the
 * unbounded source-level problem reading the artifact exists to avoid.
 *
 * The other residual, stated rather than implied: an ALLOWED package could itself grow a React
 * dependency, and importing React under Node does not throw, so neither question would notice.
 * The allow-list is two pure string utilities and every addition to it is a deliberate decision,
 * which is the control on that.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname as pathDirname, join } from "node:path";

/** The directory part of an output-relative file name, or "" for a flat one. */
const dirname = file =>
  file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import {
  SERVER_SAFE_ALLOWED_PACKAGES,
  serverSafeArtifacts,
} from "./published-entries.mjs";

const DIST = join(pathDirname(fileURLToPath(import.meta.url)), "..", "dist");

/** Cleared only by reaching the end of the run, so an artifact ending the process is not a pass. */
let completed = false;

/** The artifact being evaluated, for the message if one of them ends the process. */
let importing = null;

/**
 * Every module specifier the built artifact still names.
 *
 * Parsed rather than matched, for the same reason the source-level guard is: stripping comments
 * with a regular expression fails OPEN, because an unclosed marker inside a template literal
 * swallows real imports up to the next terminator. Both module formats are covered here — the ESM
 * build's `import`/`export ... from`, the CJS build's `require(...)`, and the dynamic `import()`
 * either may contain.
 *
 * A specifier this cannot read as a literal is recorded as an unreadable one rather than skipped,
 * so it fails the allow-list instead of passing in silence.
 *
 * @param {string} source
 * @param {string} fileName
 * @returns {string[]}
 */
export function specifiersIn(source, fileName) {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  /** @type {string[]} */
  const found = [];

  /** @param {ts.Node | undefined} node */
  const record = node => {
    if (node === undefined) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
      return;
    }
    found.push(`<unreadable specifier: ${node.getText()}>`);
  };

  // The local names that MEAN `createRequire`, resolved from the import rather than assumed to be
  // spelled that way: `import { createRequire as cr } from "node:module"` makes `cr` the factory,
  // and the build preserves the alias.
  // Seeded from IMPORTS only. A bare `createRequire` was assumed to be Node's, which made an
  // unrelated local helper of that name into a module loader and rejected an artifact with no
  // dependency at all. The name proves nothing; where it came from does.
  const factories = new Set();
  const namespaces = new Set();
  const collectFactories = node => {
    // ImportSpecifier sits under NamedImports under ImportClause under the declaration.
    const from = node.parent?.parent?.parent?.moduleSpecifier;
    const fromNodeModule =
      from !== undefined &&
      ts.isStringLiteral(from) &&
      (from.text === "node:module" || from.text === "module");
    if (
      ts.isImportSpecifier(node) &&
      fromNodeModule &&
      (node.propertyName ?? node.name).text === "createRequire"
    ) {
      factories.add(node.name.text);
    }
    // `import * as mod from "node:module"` makes `mod.createRequire` the factory, and only that
    // namespace's.
    if (ts.isNamespaceImport(node)) {
      const spec = node.parent?.parent?.moduleSpecifier;
      if (
        spec !== undefined &&
        ts.isStringLiteral(spec) &&
        (spec.text === "node:module" || spec.text === "module")
      ) {
        namespaces.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectFactories);
  };
  collectFactories(tree);

  /** Whether an expression names the require factory, by local name or through a namespace. */
  const namesFactory = node => {
    if (ts.isIdentifier(node)) return factories.has(node.text);
    return (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "createRequire" &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text)
    );
  };

  // Names bound to a loader before the walk, because the call that uses one can appear above the
  // declaration in the emitted file. `const load = createRequire(import.meta.url)` makes `load`
  // the module loader, and a bundler leaves that opaque exactly as it leaves `createRequire`.
  const loaders = new Set();
  const aliases = [];
  const collectLoaders = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (
        init !== undefined &&
        ts.isCallExpression(init) &&
        namesFactory(init.expression)
      ) {
        loaders.add(node.name.text);
      } else if (init !== undefined && ts.isIdentifier(init)) {
        // `const again = load` hands the loader on under another name. Recorded now and resolved
        // below, because the assignment can appear in any order in emitted output.
        aliases.push([node.name.text, init.text]);
      }
    }
    ts.forEachChild(node, collectLoaders);
  };
  collectLoaders(tree);
  // To a fixed point, so a chain of any length resolves rather than only the first link.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [alias, source] of aliases) {
      if (loaders.has(source) && !loaders.has(alias)) {
        loaders.add(alias);
        changed = true;
      }
    }
  }

  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      // `import x = require("y")` survives into the CJS build of a TypeScript source.
      if (ts.isExternalModuleReference(node.moduleReference)) {
        record(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      // `createRequire(import.meta.url)("react")` loads a module while naming only `node:module`
      // as an import. The loader is the RESULT of a call, so the callee is not the `require`
      // identifier and the direct check never sees it. This package uses `createRequire` itself,
      // precisely because a bundler leaves it opaque.
      const isCreatedRequire =
        // `createRequire(import.meta.url)("react")`, invoked where it is made.
        (ts.isCallExpression(callee) && namesFactory(callee.expression)) ||
        // `const load = createRequire(...); load("react")`, invoked through the name it was
        // stored under.
        (ts.isIdentifier(callee) && loaders.has(callee.text));
      if (
        (isDynamicImport || isRequire || isCreatedRequire) &&
        node.arguments.length > 0
      ) {
        record(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
}

/**
 * The package a specifier belongs to, or null when it names no package.
 *
 * A relative path inside the artifact's own output is not a package, and neither is a Node
 * builtin: both are available to server code already. A scoped name keeps two segments, so
 * `@radix-ui/react-slot` is not mistaken for a permitted `@radix-ui`.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
export function packageOf(specifier) {
  if (specifier.startsWith(".")) return null;
  // An ABSOLUTE path is not part of the emitted output and is not traversed, so exempting it let
  // a machine-specific path through — one that resolves on the build host and is absent for every
  // consumer. Named rather than exempted, so it fails the allow-list.
  if (specifier.startsWith("/")) return specifier;
  // Asked of Node rather than matched on the `node:` prefix. Both spellings resolve to the same
  // built-in and tsup preserves whichever the source used, so recognising only the prefixed form
  // rejects a server-safe entry for importing `path` or `fs/promises`.
  if (isBuiltin(specifier)) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0];
}

/**
 * Every emitted file reachable from one artifact, following the relative specifiers between them.
 *
 * A split build does not put an entry's dependencies in the entry. With code splitting on — tsup's
 * default — `utils.mjs` can be nothing but `export { x } from "./chunk-abc.mjs"`, and the chunk is
 * where `react` would appear. Scanning only the named entry exempts exactly the file that holds
 * what this is looking for, and the evaluation does not catch it either, because importing React
 * under Node succeeds.
 *
 * `read` returns the file's text, or null when it is absent — reported rather than thrown, so a
 * missing chunk is a named failure instead of a stack trace from inside the walk.
 *
 * @param {string} entry file name, relative to the output directory
 * @param {(file: string) => string | null} read
 * @returns {Array<{ file: string, missing: boolean, specifiers: string[] }>}
 */
export function reachedFrom(entry, read) {
  const seen = new Set();
  const queue = [entry];
  const reached = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (source === null) {
      reached.push({ file, missing: true, specifiers: [] });
      continue;
    }
    const specifiers = specifiersIn(source, file);
    reached.push({ file, missing: false, specifiers });
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      // The output is flat, so joining against the naming file's directory keeps a chunk named
      // from a subdirectory resolving the same way the runtime would.
      queue.push(posixJoin(dirname(file), specifier));
    }
  }
  return reached;
}

/** Join two output-relative paths the way a module specifier resolves, without touching disk. */
function posixJoin(from, specifier) {
  const parts = from === "." || from === "" ? [] : from.split("/");
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * The specifiers reachable from one artifact that a server-safe entry point may not reach.
 *
 * @param {string} entry
 * @param {(file: string) => string | null} read
 * @param {Set<string>} allowed
 * @returns {{ offending: string[], missing: string[] }}
 */
export function disallowedSpecifiers(entry, read, allowed) {
  const offending = [];
  const missing = [];
  for (const { file, missing: absent, specifiers } of reachedFrom(
    entry,
    read
  )) {
    if (absent) {
      missing.push(file);
      continue;
    }
    for (const specifier of specifiers) {
      const pkg = packageOf(specifier);
      if (pkg === null) continue;
      if (!allowed.has(pkg)) offending.push(specifier);
    }
  }
  return { offending: [...new Set(offending)], missing: [...new Set(missing)] };
}

/**
 * The package an input path belongs to, or null when it is first-party source.
 *
 * Paths come from the build's own record, so the last `node_modules/` segment is the one that
 * names the package — a nested dependency lives under its parent's `node_modules`, and the store
 * layout pnpm uses puts the real name after the last marker too.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function packageOfInput(input) {
  const marker = "node_modules/";
  const last = input.lastIndexOf(marker);
  if (last !== -1) {
    const rest = input.slice(last + marker.length);
    const parts = rest.split("/");
    if (rest.startsWith("@")) return parts.slice(0, 2).join("/");
    return parts[0] ?? null;
  }
  // A WORKSPACE package has no `node_modules` in its path at all: pnpm links it, and the bundler
  // records the real location, so `@nextlyhq/admin-css` arrives as `../admin-css/src/index.mjs`.
  // Treating every non-`node_modules` path as first-party made a whole sibling package invisible.
  // What separates them is not the spelling but the LOCATION — an input that climbs out of this
  // package's own root belongs to something else.
  if (input.startsWith("../")) {
    const parts = input.split("/").filter(part => part !== "..");
    const directory = parts[0] ?? null;
    if (directory === null) return null;
    // The DIRECTORY is not the package's identity: `../admin-css/` is `@nextlyhq/admin-css`, and
    // an allow-list entry has to be the name the manifest declares, or it would never match — and
    // would stop matching again the day the same dependency is externalised and arrives under
    // `node_modules/@nextlyhq/admin-css`. Read the manifest rather than inferring from the path.
    return manifestName(directory) ?? directory;
  }
  return null;
}

/**
 * The name a sibling workspace package declares, or null when it cannot be read.
 *
 * Resolved from this package's own root, which is where the bundler's relative input paths are
 * anchored. Memoised because one artifact can carry many inputs from the same package.
 */
const manifestNames = new Map();
function manifestName(directory) {
  if (manifestNames.has(directory)) return manifestNames.get(directory);
  let name = null;
  try {
    const manifest = JSON.parse(
      readFileSync(join(DIST, "..", "..", directory, "package.json"), "utf8")
    );
    if (typeof manifest.name === "string") name = manifest.name;
  } catch {
    name = null;
  }
  manifestNames.set(directory, name);
  return name;
}

/**
 * The packages BUNDLED into one artifact, from the build's own record of what went into it.
 *
 * The specifier scan can only see what SURVIVES, and a bundled dependency leaves nothing to see:
 * tsup treats `dependencies` as external but INLINES anything else, so a `devDependencies` package
 * is copied into the artifact whole with no import naming it. Asking the bundler what it read is
 * the only way to find that, and it is bounded — the list is finite and the build wrote it.
 *
 * Returns null when the artifact has no entry in the metafile, which is a failure to report rather
 * than an empty result to pass.
 *
 * @param {{ outputs?: Record<string, { inputs?: Record<string, unknown> }> }} metafile
 * @param {string} outputName
 * @returns {string[] | null}
 */
export function bundledPackages(metafile, outputNames) {
  const names = Array.isArray(outputNames) ? outputNames : [outputNames];
  const packages = new Set();
  const missing = [];
  for (const name of names) {
    const output = metafile.outputs?.[name];
    if (output === undefined) {
      missing.push(name);
      continue;
    }
    for (const input of Object.keys(output.inputs ?? {})) {
      const pkg = packageOfInput(input);
      if (pkg !== null) packages.add(pkg);
    }
  }
  if (missing.length === names.length) return null;
  return [...packages];
}

/**
 * Globals whose presence means this is not a bare server.
 *
 * Only the two that no Node release has ever defined. Anything Node has adopted, or may adopt,
 * belongs in {@link ADDED_AFTER_SUPPORTED_FLOOR} instead — probing for one of those reports a DOM
 * on an ordinary build machine and the check refuses to run rather than checking anything.
 */
const DOM_ONLY_GLOBALS = ["window", "document"];

/**
 * Web globals Node has added since the oldest release this package supports.
 *
 * Evaluating the artifact proves it runs on a server, and "a server" has to mean every Node in the
 * supported range rather than whichever one happens to run the build. `navigator` arrived in v21
 * and web storage is arriving now, so a module-scope `navigator.userAgent` evaluates cleanly on a
 * modern build machine and throws for a consumer on the floor. Removing them first makes the
 * evaluation answer the question the package's `engines` range actually asks.
 *
 * Deleting a name that is not there is a no-op, so a name can be listed before the Node that
 * defines it ships, and a name Node later removes costs nothing.
 *
 * The failure direction is deliberate: a name MISSING from this list leaves the gate permissive —
 * an artifact using it passes here and breaks on the floor — while a name wrongly present only
 * makes the gate stricter than the floor requires. Erring toward permissive is right for a check
 * wired into the build, where a false alarm blocks work that is actually fine.
 */
const ADDED_AFTER_SUPPORTED_FLOOR = [
  // v21. Node exposes the instance AND the constructor, and removing one leaves the other
  // reachable, so both names are needed for the emulation to hold.
  "navigator",
  "Navigator",
  // Unflagged in v22; behind --experimental-websocket on the floor.
  "WebSocket",
  // Web storage, arriving across v22 and still flag-gated on the floor.
  "localStorage",
  "sessionStorage",
  "Storage",
  // v24.
  "CloseEvent",
  "EventSource",
  // Not in any release the floor covers; listed ahead of the Node that ships it.
  "URLPattern",
];

/**
 * Post-floor globals present in `scope`.
 *
 * The mirror of {@link domGlobalsPresent}, for the names the floor restriction removed. An
 * artifact that installs one puts it back for everything imported afterwards, so this is asked
 * between imports rather than once at the start.
 *
 * @param {Record<string, unknown>} scope
 * @returns {string[]}
 */
export function floorGlobalsPresent(scope = globalThis) {
  return ADDED_AFTER_SUPPORTED_FLOOR.filter(name => name in scope);
}

/**
 * Take the environment down to the oldest supported Node before evaluating anything.
 *
 * Reports the globals it could NOT remove rather than proceeding, because a non-configurable
 * leftover would let an artifact evaluate against a capability the floor does not have — the same
 * vacuous pass this file exists to prevent, one level down.
 *
 * @param {Record<string, unknown>} scope
 * @returns {{ stubborn: string[], restore: () => void }}
 */
export function restrictToSupportedFloor(scope = globalThis) {
  /** @type {Array<[string, PropertyDescriptor]>} */
  const removed = [];
  const stubborn = [];
  for (const name of ADDED_AFTER_SUPPORTED_FLOOR) {
    if (!(name in scope)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(scope, name);
    // Asked BEFORE deleting rather than after. This module is ESM, so it runs in strict mode,
    // where `delete` on a non-configurable property throws instead of returning false — the
    // reporting path below would never be reached, and the build would fail with a raw TypeError
    // in place of the explanation.
    if (descriptor !== undefined && !descriptor.configurable) {
      stubborn.push(name);
      continue;
    }
    delete scope[name];
    if (name in scope) {
      stubborn.push(name);
      continue;
    }
    if (descriptor) removed.push([name, descriptor]);
  }
  return {
    stubborn,
    restore: () => {
      for (const [name, descriptor] of removed) {
        Object.defineProperty(scope, name, descriptor);
      }
    },
  };
}

/**
 * Refuse to run where a DOM exists.
 *
 * The evaluation check is only meaningful in an environment that has no `document` to find. Run
 * under jsdom, or in a browser-like runtime, every artifact would import cleanly and the check
 * would report a pass it never made. Naming that as a failure keeps it from passing vacuously.
 *
 * @returns {string[]} the DOM globals that should not be here
 */
export function domGlobalsPresent(scope = globalThis) {
  // Presence of the BINDING, not of a value. A preload or instrumentation hook that defines
  // `globalThis.document` as `undefined` leaves `document?.title` evaluating happily here while
  // throwing `ReferenceError` in ordinary Node, and a value comparison reads that as a bare
  // server.
  return DOM_ONLY_GLOBALS.filter(name => name in scope);
}

async function main() {
  const problems = [];

  const contaminated = domGlobalsPresent();
  if (contaminated.length > 0) {
    console.error(
      `Server-safe artifact check cannot run: this environment defines ` +
        `${contaminated.join(", ")}, so importing an artifact proves nothing about a server.`
    );
    process.exitCode = 1;
    return;
  }

  // Down to the oldest supported Node BEFORE anything is imported, so the evaluation answers for
  // the whole `engines` range rather than for the build machine.
  const floor = restrictToSupportedFloor();
  if (floor.stubborn.length > 0) {
    console.error(
      `Server-safe artifact check cannot run: ${floor.stubborn.join(", ")} could not be removed ` +
        `from this environment, so an artifact could evaluate against a capability the oldest ` +
        `supported Node does not have.`
    );
    process.exitCode = 1;
    return;
  }

  const require = createRequire(import.meta.url);
  const artifacts = serverSafeArtifacts();

  // One read per format rather than per artifact; the build writes one file for each.
  const metafiles = { esm: null, cjs: null };
  for (const format of ["esm", "cjs"]) {
    try {
      metafiles[format] = JSON.parse(
        readFileSync(join(DIST, `metafile-${format}.json`), "utf8")
      );
    } catch {
      metafiles[format] = null;
    }
  }

  for (const file of artifacts) {
    const full = join(DIST, file);

    if (!existsSync(full)) {
      problems.push(`${file} was not emitted by the build.`);
      continue;
    }

    // Follows the relative specifiers between emitted files, because a split build puts an entry's
    // dependencies in a chunk beside it rather than in the entry.
    const read = name => {
      try {
        return readFileSync(join(DIST, name), "utf8");
      } catch {
        return null;
      }
    };
    const { offending, missing } = disallowedSpecifiers(
      file,
      read,
      SERVER_SAFE_ALLOWED_PACKAGES
    );
    if (missing.length > 0) {
      problems.push(
        `${file} names ${missing.join(", ")}, which the build did not emit, so what it reaches ` +
          `could not be read.`
      );
    }
    // What SURVIVED as a specifier is only half the question; the build's record says what was
    // inlined. Read per artifact so the failure names the entry rather than the whole build.
    const metafile = metafiles[file.endsWith(".cjs") ? "cjs" : "esm"];
    if (metafile === null) {
      problems.push(
        `The build emitted no metafile for ${file}, so what was bundled into it could not be read.`
      );
    } else {
      // EVERY output reached from the entry, not just the entry. Splitting can put the entry's
      // source in one file and a bundled dependency in a chunk beside it, and checking only the
      // named artifact leaves the chunk's inputs unread — the specifier walk already follows
      // those chunks, so the two checks were covering different sets of files.
      const reachedOutputs = reachedFrom(file, read).map(
        entry => `dist/${entry.file}`
      );
      const bundled = bundledPackages(metafile, reachedOutputs);
      if (bundled === null) {
        problems.push(
          `${file} has no entry in the build's metafile, so what was bundled into it is unknown.`
        );
      } else {
        const unlisted = bundled.filter(
          name => !SERVER_SAFE_ALLOWED_PACKAGES.has(name)
        );
        if (unlisted.length > 0) {
          problems.push(
            `${file} has ${unlisted.join(", ")} bundled into it, which a server-safe entry point ` +
              `may not reach. A bundled package leaves no import to find, so this comes from the ` +
              `build's own record of what it read.`
          );
        }
      }
    }

    if (offending.length > 0) {
      problems.push(
        `${file} reaches ${offending.join(", ")}, which a server-safe entry point may not ` +
          `import. Either the entry gained a client dependency, or the allow-list in ` +
          `published-entries.mjs needs a deliberate addition.`
      );
    }

    // Re-asked before EVERY import, not once at the start. These artifacts share one process, so
    // an earlier one that installs `document` would leave a later one's module-scope read working
    // here and failing for a consumer importing that entry point alone.
    // Both halves of the environment, re-asked before EVERY import. The DOM globals must never
    // appear, and the post-floor ones were removed at the start — an artifact that installs
    // either puts it back for everything imported afterwards, and the later entry then evaluates
    // against a runtime no consumer has.
    const leaked = [...domGlobalsPresent(), ...floorGlobalsPresent()];
    if (leaked.length > 0) {
      problems.push(
        `${leaked.join(", ")} appeared before ${file} was imported, so an earlier artifact ` +
          `installed it. Nothing evaluated after that point was tested against a bare server.`
      );
      break;
    }

    // Evaluated, not merely read: this is what makes the browser-global question complete. The
    // CJS artifacts go through `require` because `import()` of a `.cjs` file gives back its
    // exports without running it as CommonJS.
    try {
      importing = file;
      if (file.endsWith(".cjs")) {
        require(full);
      } else {
        await import(pathToFileURL(full).href);
      }
      importing = null;
    } catch (error) {
      problems.push(
        `${file} threw while being imported under Node: ${error instanceof Error ? error.message : String(error)}. ` +
          `A server-safe entry point must evaluate without a browser.`
      );
    }
  }

  if (artifacts.length === 0) {
    problems.push(
      "No server-safe artifacts were derived, so this check would pass without asserting anything."
    );
  }

  floor.restore();

  if (problems.length > 0) {
    console.error("Server-safe artifact check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Server-safe artifact check passed (${artifacts.join(", ")} import cleanly under Node and ` +
      `reach only ${[...SERVER_SAFE_ALLOWED_PACKAGES].join(", ")}).`
  );
}

// Importable for its pure parts, and a gate when the build runs it.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  // An artifact is EVALUATED here, so it can call `process.exit` and take this process with it —
  // before any verdict is printed, and with whatever status it chose, which the shell would read
  // as a passing gate. Completion is asserted rather than assumed: reaching the end of `main` is
  // what clears this, and anything else exits non-zero naming the artifact being imported.
  process.on("exit", () => {
    if (completed) return;
    console.error(
      `Server-safe artifact check did not finish${
        importing === null ? "" : ` — it was importing ${importing}`
      }. An artifact that ends the process during module initialization would end a consumer's server the same way.`
    );
    if (process.exitCode === 0 || process.exitCode === undefined) {
      process.exitCode = 1;
    }
  });
  await main();
  completed = true;
}
