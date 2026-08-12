/**
 * Verify that a server-safe entry point, as BUILT, reaches nothing a server cannot have.
 *
 * The directive guard next to this one answers a different question: whether the artifact carries
 * a `"use client"` banner. An artifact can be free of that banner and still be unusable from a
 * Server Component, because the banner is not what breaks it — importing React is.
 *
 * This reads the BUILT files rather than the sources, and that is the point. A source scan has to
 * predict what the bundler will do: which specifier a bare import resolves to, whether an
 * extensionless path picks the `.ts` or the `.tsx`, whether a folded expression like
 * `import("re" + "act")` reaches React, which type-only imports are erased. Every one of those is
 * already decided by the time these files exist. What is left is a short, finite list of external
 * specifiers, read two ways because either alone fails open:
 *
 * 1. **What SURVIVED as an import.** Every module specifier still named in the artifact, and in
 *    every chunk reachable from it, must be on the allow-list. First-party code is bundled in, so
 *    what remains is exactly the external packages, and JSX has already become a
 *    `react/jsx-runtime` import by the time it gets here.
 *
 * 2. **What was INLINED.** A bundled dependency leaves no import to find: tsup treats
 *    `dependencies` as external and copies anything else into the artifact whole, so a
 *    `devDependencies` package is present with no specifier naming it. The build's own metafile is
 *    the record of what it read, and that is what this asks rather than the text.
 *
 * Both readings are bounded by files the build has already written, and neither predicts anything.
 *
 * ## What this proves, and what it does not
 *
 * It answers what an artifact REACHES, not whether it RUNS. A module whose body touches
 * `document` while it evaluates imports no differently from one that does not, and nothing here
 * would see it.
 *
 * That question is answered where it can be answered honestly, in the package smoke workflow,
 * which builds a real Next.js app and imports these entry points from a Server Component.
 * Answering it here instead means SIMULATING a consumer's environment, and then the check is only
 * ever as good as the difference it modelled — Node version, `NODE_ENV`, which web globals exist,
 * what an artifact may schedule for after the import returns. Every gap in that model is a pass
 * the consumer does not get, and the list of gaps has no end. A real build has no model in it.
 *
 * The runtime-resolution recognition below — `require`, `createRequire`, `module.require`,
 * `import.meta.resolve` — is DEFENCE IN DEPTH rather than a boundary, and it is best-effort by
 * design. Naming a module without importing it is outside the question by construction: the
 * bundler never resolves it, so it appears in no metafile record. Every spelling recognised has
 * another behind it.
 *
 * The two halves of that list are limited by different things, and only one of them has a boundary
 * behind it. The CommonJS loader needs `node:module`, which cannot be imported from this package's
 * `src` at all — Node types are scoped to the test project, so the import is a type error that
 * fails `check-types` and the build. `import.meta.resolve` is syntax, needs no import, and
 * type-checks here today, so for that spelling this reading IS the only control. A bundled
 * dependency using either is caught as a package by the metafile instead.
 *
 * The other residual, stated rather than implied: an ALLOWED package could itself grow a React
 * dependency, and nothing here would notice. The allow-list is two pure string utilities and every
 * addition to it is a deliberate decision, which is the control on that.
 */
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname as pathDirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import {
  SERVER_SAFE_ALLOWED_PACKAGES,
  serverSafeArtifacts,
} from "./published-entries.mjs";

/** The directory part of an output-relative file name, or "" for a flat one. */
const dirname = file =>
  file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";

const DIST = join(pathDirname(fileURLToPath(import.meta.url)), "..", "dist");

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
    !isShadowed(node, object);

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

  /**
   * Every identifier a binding name introduces, including through destructuring.
   *
   * `const { require } = someObject` and `const [require] = pair` both bind the name, and reading
   * only `ts.isIdentifier(node.name)` sees neither.
   *
   * @param {ts.BindingName | undefined} name
   * @param {(bound: string) => void} add
   */
  const eachBoundName = (name, add) => {
    if (name === undefined) return;
    if (ts.isIdentifier(name)) {
      add(name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(name) && !ts.isArrayBindingPattern(name)) {
      return;
    }
    for (const element of name.elements) {
      // An array pattern hole — `const [, x] = pair` — has no binding at all.
      if (ts.isOmittedExpression(element)) continue;
      eachBoundName(element.name, add);
    }
  };

  /**
   * Whether ONE node introduces a binding for `name` in the scope it opens.
   *
   * @param {ts.Node} scope
   * @param {string} name
   */
  const bindsName = (scope, name) => {
    let found = false;
    const add = bound => {
      if (bound === name) found = true;
    };

    // A function's parameters, and its own name where it has one.
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) eachBoundName(parameter.name, add);
      if (
        (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) &&
        scope.name !== undefined
      ) {
        add(scope.name.text);
      }
    }

    if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
      eachBoundName(scope.variableDeclaration.name, add);
    }

    // Declarations sitting directly in a statement list, plus the initializer of a `for` form,
    // which opens its own scope for the names it declares.
    const statements = ts.isSourceFile(scope)
      ? scope.statements
      : ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : undefined;
    for (const statement of statements ?? []) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          eachBoundName(declaration.name, add);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        add(statement.name.text);
      } else if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name !== undefined) add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings !== undefined) {
          if (ts.isNamespaceImport(bindings)) add(bindings.name.text);
          else for (const element of bindings.elements) add(element.name.text);
        }
      }
    }

    const initializer =
      ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)
        ? scope.initializer
        : undefined;
    if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
      for (const declaration of initializer.declarations) {
        eachBoundName(declaration.name, add);
      }
    }

    return found;
  };

  /**
   * Whether `name` is bound by any scope ENCLOSING this node, so the read is not the ambient one.
   *
   * Asked per call site rather than once per file. A single set of every name declared anywhere
   * suppressed a top-level `module.require("react")` because some unrelated nested function had a
   * parameter called `module` — a binding that cannot reach the top level, silencing the one read
   * this rule exists to catch.
   *
   * @param {ts.Node} node
   * @param {string} name
   */
  const isShadowed = (node, name) => {
    for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
      if (bindsName(scope, name)) return true;
    }
    return false;
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
      // A module that declares its own `require` is not reaching the CommonJS loader, and reporting
      // its argument names something that is not a module specifier. The same rule the `module`
      // object already gets: the name proves nothing, where it came from does.
      const isRequire =
        ts.isIdentifier(callee) &&
        callee.text === "require" &&
        !isShadowed(callee, "require");
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
 * what this is looking for.
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
  // Every file this build emitted, so an import record naming one can be told from one naming a
  // dependency. Read from the metafile rather than from the names being asked about: a chunk is an
  // output of the build without being an artifact anyone asked to check.
  const outputNamesInBuild = new Set(Object.keys(metafile.outputs ?? {}));
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
      // A record naming another OUTPUT of this same build is an internal chunk, not a dependency.
      // Splitting is on by default, so two entries sharing a module produce
      // `{ path: "dist/chunk-XXXXXX.mjs", kind: "import-statement" }` with no `external` flag, and
      // classifying that by path yields the directory name — a package called `dist`, which is on
      // no allow-list and would reject a build that is entirely correct. What those chunks contain
      // is already covered: `reachedFrom` follows them and their own inputs are read here as
      // outputs in their own right.
      if (outputNamesInBuild.has(entry.path)) continue;
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

async function main() {
  const problems = [];

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
    `Server-safe artifact check passed (${artifacts.join(", ")} reach only ` +
      `${[...SERVER_SAFE_ALLOWED_PACKAGES].join(", ")}).`
  );
}

// Importable for its pure parts, and a gate when the build runs it.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
