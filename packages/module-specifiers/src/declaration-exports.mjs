import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseSource } from "./parse-source.mjs";

/**
 * The declaration file a relative specifier in an emitted declaration names.
 *
 * The bundler emits runtime specifiers (`./chunk-ABC.js`) inside declaration
 * files, so the extension on the page is never the extension on disk. A
 * relative specifier names another emitted declaration, and finding none means
 * the artifact is INCOMPLETE (a build stopped after writing the entries and
 * before their chunks); returning nothing would walk a smaller graph and read
 * as a clean pass, so it is refused. A bare specifier names another package,
 * which this does not follow, and is refused too.
 */
export function declarationFor(specifier, importer) {
  if (!specifier.startsWith(".")) {
    throw new Error(
      `${importer} reaches into ${specifier}, another package, which is not followed`
    );
  }
  const base = resolve(dirname(importer), specifier).replace(/\.(m|c)?js$/, "");
  const found = [
    `${base}.d.ts`,
    `${base}.d.mts`,
    `${base}.d.cts`,
    join(base, "index.d.ts"),
  ].find(candidate => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `${specifier} is referenced by ${importer} and no declaration for it exists. ` +
        "These declarations are incomplete; rebuild before asserting against them."
    );
  }
  return found;
}

/**
 * What the export statements of a declaration file say, as written.
 *
 * The one reader of export statements for every check here that asks a built
 * declaration what it publishes. A bundled declaration re-exports through
 * clauses (`export { a as BlockRenderArgs }`), so the exported name is on the
 * right of `as` while the local name is a generated letter, and both have to be
 * read; a statement form this does not know is refused rather than read as
 * exporting nothing, because a shorter list is the answer nobody can tell from
 * a correct one.
 *
 * - `named`: one `{ exported, local, from }` per clause entry, `from` being the
 *   module specifier of an `export { } from` and undefined for a local clause
 * - `declared`: the names its `export <declaration>` statements declare
 * - `stars`: one `{ from, as }` per `export *`, `as` naming the namespace of an
 *   `export * as ns` and undefined otherwise
 */
export function exportStatements(file) {
  const { program } = parseSource(readFileSync(file, "utf8"), file);
  const statements = { named: [], declared: [], stars: [] };
  for (const statement of program.body) {
    const read = READERS[statement.type];
    if (read) read(statement, statements, file);
    else if (/^(?:Export|TSExport|TSNamespaceExport)/.test(statement.type)) {
      throw new Error(`${file}: cannot read ${statement.type}`);
    }
  }
  return statements;
}

/** How each export statement adds to what a file exports. */
const READERS = {
  ExportNamedDeclaration(statement, statements, file) {
    if (statement.declaration) {
      statements.declared.push(...declaredNames(statement.declaration, file));
    }
    for (const specifier of statement.specifiers) {
      statements.named.push({
        exported: clauseName(specifier.exported),
        local: clauseName(specifier.local),
        from: statement.source?.value,
      });
    }
  },
  ExportAllDeclaration(statement, statements) {
    statements.stars.push({
      from: statement.source.value,
      as: statement.exported ? clauseName(statement.exported) : undefined,
    });
  },
  ExportDefaultDeclaration(_statement, statements) {
    statements.declared.push("default");
  },
};

/** A name in an import or export clause, written as an identifier or a string. */
export function clauseName(node) {
  return node.type === "Identifier" ? node.name : String(node.value);
}

/** The names an exported declaration binds; an unknown form is refused. */
function declaredNames(declaration, file) {
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.map(declarator => declarator.id.name);
  }
  if (
    !DECLARATIONS.has(declaration.type) ||
    declaration.id?.type !== "Identifier"
  ) {
    throw new Error(`${file}: cannot read an exported ${declaration.type}`);
  }
  return [declaration.id.name];
}

/** The declaration kinds that bind one name, their `id`. */
const DECLARATIONS = new Set([
  "TSDeclareFunction",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);

/**
 * Every name a declaration file exports, types and values alike, following
 * each `export *` to the declaration `follow(from, file)` names. One that
 * cannot be followed is refused, so the answer is never a shorter list.
 */
export function exportedNames(file, follow = declarationFor, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const { named, declared, stars } = exportStatements(file);
  const names = new Set([...named.map(entry => entry.exported), ...declared]);
  for (const star of stars) {
    if (star.as !== undefined) names.add(star.as);
    else
      addAll(
        names,
        exportedNames(follow(star.from, file), follow, seen),
        "default"
      );
  }
  return names;
}

/** `from` added into `into`, except `but`: `export *` never carries a default. */
function addAll(into, from, but) {
  for (const name of from) if (name !== but) into.add(name);
}
