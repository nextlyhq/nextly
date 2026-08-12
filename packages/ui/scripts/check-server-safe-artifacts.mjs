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
 * 1. **Does it evaluate?** Each artifact is imported into a FRESH process, which is Node with no
 *    DOM. A module reading `document` where its body runs throws, and nothing has to recognise the
 *    spelling of the read for that to happen. This is the complete answer to the browser-global
 *    question, in place of enumerating globals and the syntax that dereferences them.
 *
 *    One process per artifact rather than one for all of them, because a consumer imports ONE
 *    entry point. Shared, every artifact's verdict depended on the ones before it: enumerating
 *    what may leak covers the names on the list and nothing else, and ordinary state is on no
 *    list — a module populating `globalThis`, filling a registry or patching a prototype leaves
 *    the next artifact evaluating against an environment no consumer has. A fresh process cannot
 *    carry any of it.
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
 * The runtime-resolution recognition below — `require`, `createRequire`, `module.require`,
 * `import.meta.resolve` — is DEFENCE IN DEPTH rather than a boundary, and it is best-effort by
 * design. Naming a module without importing it is outside both questions by construction: the
 * bundler never resolves it, so it is in no metafile record, and importing the artifact succeeds
 * because loading the package succeeds. Every spelling recognised has another behind it.
 *
 * The two halves of that list are limited by different things, and only one of them has a boundary
 * behind it. The CommonJS loader needs `node:module`, which cannot be imported from this package's
 * `src` at all — Node types are scoped to the test project, so the import is a type error that
 * fails `check-types` and the build. `import.meta.resolve` is syntax, needs no import, and
 * type-checks here today, so for that spelling this reading IS the only control. A bundled
 * dependency using either is caught as a package by the metafile instead.
 *
 * The other residual, stated rather than implied: an ALLOWED package could itself grow a React
 * dependency, and importing React under Node does not throw, so neither question would notice.
 * The allow-list is two pure string utilities and every addition to it is a deliberate decision,
 * which is the control on that.
 */
import { spawnSync } from "node:child_process";
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

/**
 * How long one artifact gets to import before the child is killed.
 *
 * Bounded because an artifact that leaves an active handle — a module-scope `setInterval`, an open
 * socket — finishes importing and never lets its process exit, and an unbounded wait would hang
 * `build:js` until CI's job timeout with nothing said about which artifact did it. Generous
 * relative to the work: these are small modules whose imports take milliseconds, so the deadline
 * is only ever reached by an artifact that is not going to finish.
 */
const EVALUATION_TIMEOUT_MS = 30_000;

/**
 * This process's environment with anything that would PRELOAD code into the child removed.
 *
 * A fresh process is only isolated if it starts empty. `NODE_OPTIONS` carrying `--require` or
 * `--import` runs a module before the artifact does, and that module can install exactly the state
 * a separate process was started to exclude — so an artifact depending on it would evaluate here
 * and fail for a consumer whose environment sets nothing. Inherited from the build, which may be
 * running under monitoring that sets it, so it is dropped rather than trusted.
 */
function environmentWithoutPreloads() {
  const { NODE_OPTIONS: _preloads, ...rest } = process.env;
  return rest;
}

/**
 * The environment one evaluation child starts from, at one `NODE_ENV` state.
 *
 * `undefined` REMOVES the variable rather than setting it empty. `process.env.NODE_ENV === ""` and
 * `process.env.NODE_ENV === undefined` are different values, and a branch reading the second would
 * go unevaluated while this reported that it had covered the unset case.
 *
 * @param {string | undefined} nodeEnv
 */
function childEnvironment(nodeEnv) {
  const base = environmentWithoutPreloads();
  if (nodeEnv === undefined) {
    const { NODE_ENV: _unset, ...rest } = base;
    return rest;
  }
  return { ...base, NODE_ENV: nodeEnv };
}

/**
 * The `NODE_ENV` values an artifact is evaluated under. `undefined` means the variable is ABSENT.
 *
 * A module-scope branch on `NODE_ENV` is ordinary in published React code and only one side of it
 * runs per evaluation, so a single value leaves the others unevaluated:
 * `if (process.env.NODE_ENV === "production") document.title` reaches the DOM for the consumer it
 * was written for and for nobody else.
 *
 * Three states rather than two, because unset is not a synonym for development. `process.env.NODE_ENV`
 * is then `undefined`, so `=== "development"` is false and `!== "production"` is true -- a branch can
 * select the unset case specifically, and the build itself sets nothing, which makes it the state
 * this check runs in by default.
 */
const EVALUATED_NODE_ENVS = [undefined, "production", "development"];

/** This file, re-invoked as the child that evaluates one artifact. */
const SELF = fileURLToPath(import.meta.url);

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

  /**
   * Whether an expression reads `<member>` off something, in either spelling.
   *
   * `a.b` and `a["b"]` are the same read, and a rule written for one of them is a rule the other
   * walks around. Answered in one place so every member rule below inherits both spellings.
   */
  const readsMember = (node, member) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === member;
    if (!ts.isElementAccessExpression(node)) return false;
    const key = node.argumentExpression;
    return (
      key !== undefined &&
      (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
      key.text === member
    );
  };

  /**
   * Whether an expression reads `<object>.<member>` off a binding the artifact does NOT declare.
   */
  const namesAmbientMember = (node, object, member) =>
    readsMember(node, member) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === object &&
    !declaredNames.has(object);

  /**
   * Whether an expression reads `import.meta.resolve`.
   *
   * `import.meta` is syntax rather than a binding, so nothing in the artifact can shadow it and no
   * import names it. That is what makes the resolver reachable while the import list stays empty
   * and the bundler records no dependency for what it names.
   */
  const namesMetaResolve = node =>
    readsMember(node, "resolve") &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === "meta";

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

  // Names the artifact binds itself. A module that declares its own `module` or `require` is not
  // reaching the ambient loader, and reporting its argument would name something that is not a
  // module specifier at all.
  const declaredNames = new Set();
  const collectDeclaredNames = node => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      declaredNames.add(node.name.text);
    }
    ts.forEachChild(node, collectDeclaredNames);
  };
  collectDeclaredNames(tree);

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
      } else if (init !== undefined && namesMetaResolve(init)) {
        // `const resolve = import.meta.resolve` hands the resolver on as a value, and calling it
        // through that name names a package exactly as calling it in place does.
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
      // `module.require("react")` is the CommonJS loader reached through the module object, which
      // survives a format guard into the CJS artifact and is opaque to the bundler, so it appears
      // in neither the specifier list nor the metafile. `module` must be the ambient one.
      //
      // Both spellings go through one predicate. Handling the dot form and leaving the bracket
      // form is how the two drift apart, and `module["require"]` is the same call.
      const isModuleRequire = namesAmbientMember(callee, "module", "require");
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
      // `import.meta.resolve("@nextlyhq/admin-css")` names a package without importing it. It
      // needs no `node:module` import, so the guard that keeps the loader out of this package
      // does not reach it, and a bundler records no dependency for what it names — a consumer
      // installing only the declared dependencies gets ERR_MODULE_NOT_FOUND at runtime.
      const isMetaResolve = namesMetaResolve(callee);
      if (
        (isDynamicImport ||
          isRequire ||
          isCreatedRequire ||
          isModuleRequire ||
          isMetaResolve) &&
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
    // The bundler also records what it RESOLVED without inlining — a `require.resolve` reaches a
    // package that appears in no input and in no surviving specifier, and the consumer without
    // that dependency gets MODULE_NOT_FOUND at import. The record is already here; it was simply
    // not being read.
    for (const entry of output.imports ?? []) {
      if (typeof entry?.path !== "string") continue;
      const pkg = packageOfInput(entry.path) ?? packageOf(entry.path);
      if (pkg !== null) packages.add(pkg);
    }
  }
  // ANY unmatched output means the answer is incomplete, not that the rest is clean. Returning
  // the packages of the outputs that WERE described reads as a full result, and a package inlined
  // into the unmatched chunk passes — the fail-open case this function exists to prevent.
  if (missing.length > 0) return null;
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
  // Post-floor JavaScript globals rather than web ones, and absent on the floor all the same.
  "Iterator",
  "AsyncDisposableStack",
  "DisposableStack",
  "Float16Array",
  "SuppressedError",
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

/**
 * What one child's result says about its artifact, or null when it evaluated cleanly.
 *
 * Three ways for the answer to be absent rather than negative, and they are reported apart from a
 * verdict because "the artifact is bad" and "the check could not run" call for different action.
 * A signalled child in particular reports `status: null`, which compares unequal to 0 and would
 * otherwise be described with the word `null` where a reason belongs.
 *
 * @param {string} file
 * @param {{ error?: Error, status: number | null, signal?: string | null, stderr?: string }} run
 * @returns {string | null}
 */
export function childOutcome(file, run) {
  // A child that had to be killed at the deadline is a VERDICT, not a failure to evaluate: the
  // import either never finished or left a handle keeping the process alive, and an entry point
  // that does either hangs whatever imports it. Reported before the general spawn-failure branch,
  // which would otherwise describe it as "could not be evaluated" and hide a real defect.
  if (
    run.error !== undefined &&
    run.error !== null &&
    run.error.code === "ETIMEDOUT"
  ) {
    return (
      `${file} was still running ${EVALUATION_TIMEOUT_MS}ms after it was imported. A server-safe ` +
      `entry point must finish initializing and leave nothing holding the process open.`
    );
  }
  if (run.error !== undefined && run.error !== null) {
    return (
      `${file} could not be evaluated: ${run.error.message}. The check cannot report on an ` +
      `artifact it never ran.`
    );
  }
  if (run.status === 0) return null;
  if (run.status === null) {
    return (
      `${file} ended on signal ${run.signal} while being evaluated, so no verdict was reached. ` +
      `An entry point that ends the process during initialization would end a consumer's server ` +
      `the same way.`
    );
  }
  // The child names the failure and this names the artifact, so neither is written twice. A child
  // that failed silently still has to say something, or the report would name a file and no reason.
  const said = (run.stderr ?? "").trim();
  return said === ""
    ? `${file} exited ${run.status} while being evaluated, saying nothing about why.`
    : `${file} ${said}`;
}

/**
 * Evaluate ONE artifact in this process, which the parent has just started for it alone.
 *
 * Sharing a process across artifacts made every artifact's verdict depend on the ones before it.
 * Enumerating what may leak — the DOM globals, then the post-floor ones — answers for the names on
 * those lists and for nothing else, and ordinary state is not on any list: a module setting
 * `globalThis.cache`, populating a registry, or monkey-patching a prototype leaves the next
 * artifact evaluating against an environment no consumer has. A fresh process cannot carry any of
 * it, which settles the whole class rather than the part that was enumerated.
 *
 * @param {string} file
 */
async function evaluateOne(file) {
  const contaminated = domGlobalsPresent();
  if (contaminated.length > 0) {
    console.error(
      `this environment defines ${contaminated.join(", ")}, so importing an artifact proves ` +
        `nothing about a server`
    );
    process.exitCode = 1;
    return;
  }

  // Down to the oldest supported Node BEFORE the import, so the evaluation answers for the whole
  // `engines` range rather than for the build machine. Not restored: the process exits next.
  const floor = restrictToSupportedFloor();
  if (floor.stubborn.length > 0) {
    console.error(
      `${floor.stubborn.join(", ")} could not be removed from this environment, so the artifact ` +
        `could evaluate against a capability the oldest supported Node does not have`
    );
    process.exitCode = 1;
    return;
  }

  const full = join(DIST, file);
  importing = file;
  try {
    // The CJS artifacts go through `require` because `import()` of a `.cjs` file gives back its
    // exports without running it as CommonJS.
    if (file.endsWith(".cjs")) createRequire(import.meta.url)(full);
    else await import(pathToFileURL(full).href);
  } catch (error) {
    console.error(
      `threw while being imported under Node: ` +
        `${error instanceof Error ? error.message : String(error)}. A server-safe entry point ` +
        `must evaluate on a bare server, on its own`
    );
    process.exitCode = 1;
    return;
  }
  importing = null;

  // Still asked, because this artifact putting a browser global into its OWN consumer's
  // environment is a defect whatever the next artifact does. What the fresh process removes is
  // one artifact's leak deciding another's verdict, not the leak itself.
  const installed = [...domGlobalsPresent(), ...floorGlobalsPresent()];
  if (installed.length > 0) {
    console.error(
      `installed ${installed.join(", ")} while being imported. A server-safe entry point must ` +
        `not put a browser global into its consumer's environment`
    );
    process.exitCode = 1;
  }
}

async function main() {
  const problems = [];

  // Neither the environment check nor the floor restriction is done here any more: this process
  // imports no artifact, and each child applies both to itself before the one import it makes.
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

    // Evaluated, not merely read: this is what makes the browser-global question complete. One
    // fresh process per artifact, so nothing an earlier one did to the environment can decide a
    // later one's verdict — which is the state a consumer importing this entry ALONE is in.
    for (const nodeEnv of EVALUATED_NODE_ENVS) {
      const problem = childOutcome(
        file,
        spawnSync(process.execPath, [SELF, "--evaluate", file], {
          encoding: "utf8",
          timeout: EVALUATION_TIMEOUT_MS,
          env: childEnvironment(nodeEnv),
        })
      );
      // Named with the environment, because "utils.mjs threw" is a different report to act on
      // depending on which branch did it, and the runs are otherwise identical.
      if (problem !== null) {
        problems.push(
          `${problem} (NODE_ENV=${nodeEnv === undefined ? "unset" : nodeEnv})`
        );
      }
    }
  }

  if (artifacts.length === 0) {
    problems.push(
      "No server-safe artifacts were derived, so this check would pass without asserting anything."
    );
  }

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
  // `--evaluate <file>` is this file run as its own child, importing one artifact into a process
  // started for it alone. The parent reads the exit status; the assertion above is what stops an
  // artifact calling `process.exit(0)` from being read as a clean evaluation.
  const evaluating = process.argv[2] === "--evaluate" ? process.argv[3] : null;
  if (evaluating !== null) await evaluateOne(evaluating);
  else await main();
  completed = true;
}
