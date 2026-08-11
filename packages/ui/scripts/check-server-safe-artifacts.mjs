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
 * `ERR_UNKNOWN_BUILTIN_MODULE`, and no amount of deleting globals emulates that. Closing it means
 * running this gate under the oldest supported Node rather than approximating it here; see
 * `tasks/left-tasks/205-artifact-gate-on-the-floor-node.md`.
 *
 * The other residual, stated rather than implied: an ALLOWED package could itself grow a React
 * dependency, and importing React under Node does not throw, so neither question would notice.
 * The allow-list is two pure string utilities and every addition to it is a deliberate decision,
 * which is the control on that.
 */
import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import {
  SERVER_SAFE_ALLOWED_PACKAGES,
  serverSafeArtifacts,
} from "./published-entries.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

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
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  // Asked of Node rather than matched on the `node:` prefix. Both spellings resolve to the same
  // built-in and tsup preserves whichever the source used, so recognising only the prefixed form
  // rejects a server-safe entry for importing `path` or `fs/promises`.
  if (isBuiltin(specifier)) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0];
}

/**
 * The specifiers in one artifact that a server-safe entry point may not reach.
 *
 * @param {string} source
 * @param {string} fileName
 * @param {Set<string>} allowed
 * @returns {string[]}
 */
export function disallowedSpecifiers(source, fileName, allowed) {
  const offending = [];
  for (const specifier of specifiersIn(source, fileName)) {
    const pkg = packageOf(specifier);
    if (pkg === null) continue;
    if (!allowed.has(pkg)) offending.push(specifier);
  }
  return [...new Set(offending)];
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
  // Not in any release the floor covers; listed ahead of the Node that ships it.
  "URLPattern",
];

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
    process.exit(1);
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
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const artifacts = serverSafeArtifacts();

  for (const file of artifacts) {
    const full = join(DIST, file);

    let source;
    try {
      source = readFileSync(full, "utf8");
    } catch {
      problems.push(`${file} was not emitted by the build.`);
      continue;
    }

    const offending = disallowedSpecifiers(
      source,
      file,
      SERVER_SAFE_ALLOWED_PACKAGES
    );
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
    const leaked = domGlobalsPresent();
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
      if (file.endsWith(".cjs")) {
        require(full);
      } else {
        await import(pathToFileURL(full).href);
      }
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
    process.exit(1);
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
  await main();
}
