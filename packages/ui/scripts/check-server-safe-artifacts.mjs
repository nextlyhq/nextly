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
 * That is deliberate rather than an omission. Answering it HERE means SIMULATING a consumer's
 * environment, and the check is then only ever as good as the difference it modelled — Node
 * version, `NODE_ENV`, which web globals exist, what an artifact may schedule for after the import
 * returns. Every gap in the model is a pass the consumer does not get, and the list of gaps has no
 * end. The question is answerable by building a real app against these artifacts, because a real
 * build has no model in it; it is not answerable by reading them, which is all this file does.
 *
 * **Runtime module resolution is not read here, and that is deliberate.** `createRequire`,
 * `module.require` and `import.meta.resolve` name a module the bundler never resolves, so it
 * appears in no metafile record and in no surviving import. Recognising them in a BUILT artifact
 * means recognising every way a resolver can be stored and retrieved — under a name, through an
 * alias, destructured, on an object property, assigned after declaration, reassigned before use —
 * and each is a valid spelling with no end to the set.
 *
 * They are refused at SOURCE instead, by `src/layering.test.ts`, which is complete by construction:
 * the constructs are simply not present, and `import.meta` is checked as a whitelist so a use
 * nobody has thought of is refused too. A bundled DEPENDENCY that uses one is still caught here,
 * as a package in the metafile — which is the half a source ban cannot see.
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
   * Whether a declaration list is `let`/`const`, which bind to the enclosing BLOCK.
   *
   * Anything else is `var`, which binds to the enclosing function however deeply nested it is.
   *
   * @param {ts.VariableDeclarationList} list
   */
  const isBlockScoped = list =>
    (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;

  /**
   * Whether ONE node introduces a binding for `name` in the scope it opens.
   *
   * @param {ts.Node} scope
   * @param {string} name
   * @param {boolean} fromParameter entered through this scope's own parameter list
   */
  const bindsName = (scope, name, fromParameter = false) => {
    let found2 = false;
    const add = bound => {
      if (bound === name) found2 = true;
    };

    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        eachBoundName(parameter.name, add);
      }
      if (
        (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) &&
        scope.name !== undefined
      ) {
        add(scope.name.text);
      }
    }

    // A named CLASS binds its own name throughout its body, exactly as a named function expression
    // does — `const C = class require { … }` makes `require` the class inside those braces.
    if (
      (ts.isClassDeclaration(scope) || ts.isClassExpression(scope)) &&
      scope.name !== undefined
    ) {
      add(scope.name.text);
    }

    if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
      eachBoundName(scope.variableDeclaration.name, add);
    }

    // `var` is FUNCTION-scoped, so it belongs to the nearest function or the file rather than to
    // the block it is written in. A class static block is its own `var` scope, and a default
    // parameter initializer is evaluated before the body's `var`s exist — hence `fromParameter`.
    if (
      !fromParameter &&
      (ts.isFunctionLike(scope) ||
        ts.isSourceFile(scope) ||
        ts.isClassStaticBlockDeclaration(scope))
    ) {
      const hoisted = node => {
        if (ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) {
          return;
        }
        if (
          ts.isVariableStatement(node) &&
          !isBlockScoped(node.declarationList)
        ) {
          for (const declaration of node.declarationList.declarations) {
            eachBoundName(declaration.name, add);
          }
        }
        const init =
          ts.isForStatement(node) ||
          ts.isForInStatement(node) ||
          ts.isForOfStatement(node)
            ? node.initializer
            : undefined;
        if (
          init !== undefined &&
          ts.isVariableDeclarationList(init) &&
          !isBlockScoped(init)
        ) {
          for (const declaration of init.declarations) {
            eachBoundName(declaration.name, add);
          }
        }
        ts.forEachChild(node, hoisted);
      };
      ts.forEachChild(scope, hoisted);
    }

    // A switch's CaseBlock is one lexical scope shared by every clause.
    const statements = ts.isSourceFile(scope)
      ? scope.statements
      : ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : ts.isCaseBlock(scope)
          ? scope.clauses.flatMap(clause => clause.statements)
          : undefined;
    for (const statement of statements ?? []) {
      if (ts.isVariableStatement(statement)) {
        // A `var` here was already counted by the hoisting walk, against the function or file that
        // owns it. Counting it in a BLOCK as well would make the block look like the binding scope.
        if (
          !isBlockScoped(statement.declarationList) &&
          !ts.isSourceFile(scope)
        ) {
          continue;
        }
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

    // Only a `let`/`const` initializer makes a loop a scope; `for (var x = …)` binds to the
    // enclosing function and the hoisting walk has already counted it there.
    const initializer =
      ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)
        ? scope.initializer
        : undefined;
    if (
      initializer !== undefined &&
      ts.isVariableDeclarationList(initializer) &&
      isBlockScoped(initializer)
    ) {
      for (const declaration of initializer.declarations) {
        eachBoundName(declaration.name, add);
      }
    }

    return found2;
  };

  /**
   * Whether `name` at this node is bound by anything at all, so it is not the AMBIENT one.
   *
   * Asked per call site rather than once per file: a single set of every name declared anywhere
   * suppressed a top-level `require("react")` because an unrelated nested function had a
   * parameter of that name.
   *
   * @param {ts.Node} node
   * @param {string} name
   */
  const isShadowed = (node, name) => {
    let child = node;
    for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
      const fromParameter =
        ts.isFunctionLike(scope) &&
        scope.parameters.some(parameter => parameter === child);
      if (bindsName(scope, name, fromParameter)) return true;
      child = scope;
    }
    return false;
  };

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
      // The CJS build's own loader. A module that declares its OWN `require` is not reaching it,
      // and reporting that call's argument names something which is not a module specifier —
      // rejecting an artifact with no dependency at all.
      const isRequire =
        ts.isIdentifier(callee) &&
        callee.text === "require" &&
        !isShadowed(callee, "require");
      if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
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
      const target = posixJoin(dirname(file), specifier);
      if (target === undefined) {
        // Climbs above the output root, so this walk cannot follow it and must not pretend to.
        // Recorded as an unreadable reach rather than dropped: a consumer resolves it to a real
        // file outside `dist`, which is exactly the case the scan exists to notice.
        reached.push({
          file,
          missing: false,
          specifiers: [`<escapes the output tree: ${specifier}>`],
        });
        continue;
      }
      queue.push(target);
    }
  }
  return reached;
}

/**
 * Join two output-relative paths the way a module specifier resolves, without touching disk.
 *
 * Returns `undefined` when the specifier climbs ABOVE the output root. `pop()` on an empty array
 * is a no-op, so `../../color.mjs` would otherwise resolve to `color.mjs` — the traversal silently
 * discarded, the walk redirected at a same-named artifact inside `dist`, and neither a missing
 * file nor an offender reported. A path that leaves the tree is a question this function cannot
 * answer, so it says so rather than answering a different one.
 */
function posixJoin(from, specifier) {
  const parts = from === "." || from === "" ? [] : from.split("/");
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(segment);
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
