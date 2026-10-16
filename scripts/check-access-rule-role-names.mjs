#!/usr/bin/env node

/**
 * A shipped access rule decides by permission, never by a role's name.
 *
 * A role's name is a label an admin can change and a site can choose freely.
 * A rule that admits `admin`, `editor` or `author` refuses a custom role that
 * holds exactly the permission it needs, and every API key whose roles carry
 * none of those names, while the role screen says both may act. Templates and
 * first-party plugins are what sites copy, so a rule shipped there is the
 * pattern every site repeats.
 *
 * What counts as an access rule, so that a role mentioned elsewhere — a seed
 * that creates roles, a route that checks super-admin, prose — is not one:
 *
 * - a function that is the value of a property inside an `access: { ... }`
 *   object, a collection's or a field's alike, including one declared apart
 *   and named there (`access: shared`, or `{ access }`);
 * - a function declared with an access-rule type (`AccessControlFunction`,
 *   `AccessRule`, a field access function, or an index of
 *   `CollectionAccessControl`), whether or not anything uses it yet;
 * - an identifier inside an `access: { ... }` object, followed to its
 *   declaration in the same file or, through a relative import, in the file it
 *   names.
 *
 * Such a rule is reported when it reads a role: it destructures `roles` or
 * `role` from what it is given, or reads a `.roles` or `.role` property. There
 * is no other reason for a rule to read either, since the context carries the
 * caller's permissions beside them.
 *
 * 🔴 The source is parsed, not matched as text: the blog template's comments
 * and the plugin's JSDoc mention roles in prose, and a check that fires on
 * correct files is one that gets silenced.
 *
 * Imports are followed whether named or default, and `export default` is
 * followed to the declaration it names.
 *
 * ⚠️ What this does not follow: a rule built by a helper from another package,
 * or one reached through `export * from` or a namespace import
 * (`import * as`). A named re-export, and an object spread into an access
 * object, are followed. Each is a reason to widen this deliberately.
 *
 * Usage:
 *   node scripts/check-access-rule-role-names.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where shipped rules live: the templates, and the first-party plugins' source. */
const SHIPPED = /^(templates\/|packages\/plugin-[^/]+\/src\/)/;

/** Path segments that hold tests, fixtures or builds rather than shipped code. */
const NOT_SHIPPED = new Set([
  "__tests__",
  "__fixtures__",
  "node_modules",
  "dist",
]);

/** The property names through which a rule reads a role. */
const ROLE_KEYS = new Set(["roles", "role"]);

/** Type names that declare a function to be an access rule. */
const RULE_TYPE =
  /\b(AccessControlFunction|AccessRule|FieldAccess\w*)\b|CollectionAccessControl\s*\[/;

/** Whether a tracked path is shipped source rather than a test or a build. */
export function isShippedSource(path) {
  return (
    SHIPPED.test(path) &&
    /\.[cm]?tsx?$/.test(path) &&
    !/\.(d|test|spec)\.[cm]?tsx?$/.test(path) &&
    !path.split("/").some(part => NOT_SHIPPED.has(part))
  );
}

function isFunctionNode(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/**
 * The expression under parentheses, `as`, `satisfies` and `!`, which change
 * what the compiler believes about a value and nothing about what it is.
 */
function unwrap(node) {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  )
    inner = inner.expression;
  return inner;
}

/** The name a property is written under, when it is written plainly. */
function propertyName(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : undefined;
}

/** `{ roles }` or `{ role: r }` in a destructuring pattern. */
function bindsRole(node) {
  if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent))
    return false;
  return ROLE_KEYS.has(
    propertyName(node.propertyName) ?? propertyName(node.name) ?? ""
  );
}

/** `x.roles`, `x.role`, `x["roles"]` or `x["role"]`. */
function accessesRole(node) {
  if (ts.isPropertyAccessExpression(node)) return ROLE_KEYS.has(node.name.text);
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    ROLE_KEYS.has(node.argumentExpression.text)
  );
}

/** Whether a function reads a role anywhere in its parameters or body. */
function readsRole(fn) {
  const visit = node =>
    bindsRole(node) ||
    accessesRole(node) ||
    ts.forEachChild(node, visit) === true;
  return ts.forEachChild(fn, visit) === true;
}

/**
 * A top-level `function` or `const` declaration, as the index keeps it: the
 * node it declares (the function, or the `const`'s initializer) and whether
 * its type names it an access rule.
 */
function declarationsOf(statement, source) {
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    return [["default", { node: unwrap(statement.expression), typed: false }]];
  }
  if (ts.isFunctionDeclaration(statement)) {
    const entry = { node: statement, typed: false };
    const isDefault = statement.modifiers?.some(
      modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword
    );
    return [
      ...(statement.name ? [[statement.name.text, entry]] : []),
      ...(isDefault ? [["default", entry]] : []),
    ];
  }
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations
    .filter(decl => ts.isIdentifier(decl.name) && decl.initializer)
    .map(decl => [
      decl.name.text,
      {
        node: unwrap(decl.initializer),
        typed:
          decl.type !== undefined && RULE_TYPE.test(decl.type.getText(source)),
      },
    ]);
}

/** The specifier of a relative import, or undefined for any other statement. */
function relativeSpecifier(statement) {
  if (!ts.isImportDeclaration(statement)) return undefined;
  const specifier = statement.moduleSpecifier;
  return ts.isStringLiteral(specifier) && specifier.text.startsWith(".")
    ? specifier.text
    : undefined;
}

/** A relative import's default and named bindings, by local name. */
function relativeImportsOf(statement) {
  const from = relativeSpecifier(statement);
  const clause = from && statement.importClause;
  if (!clause) return [];
  const named =
    clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map(element => [
          element.name.text,
          { from, name: (element.propertyName ?? element.name).text },
        ])
      : [];
  return clause.name
    ? [[clause.name.text, { from, name: "default" }], ...named]
    : named;
}

/** The named elements of an `export { ... }`, or none for any other statement. */
function exportedElements(statement) {
  return ts.isExportDeclaration(statement) &&
    !statement.isTypeOnly &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements
    : [];
}

/**
 * What a file passes on under another name. `export { a } from "./b"` reads
 * as an import of `a` from `./b`; `export { a as b }` as a local `b` naming
 * `a`, which is followed as `export default a` is.
 */
function reExportsOf(statement) {
  const elements = exportedElements(statement);
  const specifier = statement.moduleSpecifier;
  if (specifier && ts.isStringLiteral(specifier)) {
    return {
      imports: specifier.text.startsWith(".")
        ? elements.map(element => [
            element.name.text,
            {
              from: specifier.text,
              name: (element.propertyName ?? element.name).text,
            },
          ])
        : [],
      declarations: [],
    };
  }
  return {
    imports: [],
    declarations: elements
      .filter(element => element.propertyName)
      .map(element => [
        element.name.text,
        { node: element.propertyName, typed: false },
      ]),
  };
}

/** Top-level declarations by name, and the relative imports by local name. */
function indexFile(source) {
  const reExports = source.statements.map(reExportsOf);
  return {
    declarations: new Map([
      ...source.statements.flatMap(statement =>
        declarationsOf(statement, source)
      ),
      ...reExports.flatMap(entry => entry.declarations),
    ]),
    imports: new Map([
      ...source.statements.flatMap(relativeImportsOf),
      ...reExports.flatMap(entry => entry.imports),
    ]),
  };
}

/** The tracked file a relative specifier names, as the bundler resolves it. */
function resolveRelative(fromPath, specifier, has) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const stem = base.replace(/\.[cm]?js$/, "");
  const candidates = [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
  ];
  return candidates.find(has);
}

/** What a property's value names: an inline function, or an identifier. */
function ruleOfValue(written, operation) {
  const value = unwrap(written);
  if (isFunctionNode(value)) return { fn: value, name: operation };
  if (ts.isIdentifier(value))
    return { identifier: value.text, name: value.text };
  return undefined;
}

/**
 * What a property of an `access: { ... }` object names: an inline function,
 * or an identifier to follow, with the name a finding reports it under.
 */
function ruleOfProperty(property) {
  const operation = propertyName(property.name) ?? "access";
  if (ts.isMethodDeclaration(property))
    return { fn: property, name: operation };
  if (ts.isShorthandPropertyAssignment(property))
    return ruleOfValue(property.name, operation);
  return ts.isPropertyAssignment(property)
    ? ruleOfValue(property.initializer, operation)
    : undefined;
}

/**
 * Every `access` a file declares: an object literal written in place, or the
 * name of one declared elsewhere (`access: shared`, or `{ access }`).
 */
function accessObjects(source) {
  const found = [];
  const visit = node => {
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "access")
      found.push({ identifier: "access" });
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "access") {
      const value = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(value)) found.push({ object: value });
      else if (ts.isIdentifier(value)) found.push({ identifier: value.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A memoised parse of each file in `files`, with its declarations indexed. */
function parserOver(files) {
  const parsed = new Map();
  return path => {
    if (!parsed.has(path)) {
      const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const source = ts.createSourceFile(
        path,
        files.get(path),
        ts.ScriptTarget.Latest,
        true,
        kind
      );
      parsed.set(path, { source, ...indexFile(source) });
    }
    return parsed.get(path);
  };
}

/**
 * Follow an identifier to the node it names, here or across a relative import:
 * the function or the initializer declared under that name.
 */
function follow(files, parse, path, identifier, seen = new Set()) {
  const key = `${path}#${identifier}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const file = parse(path);
  const local = file.declarations.get(identifier)?.node;
  // `export default access` names another declaration; follow it.
  if (local && ts.isIdentifier(local))
    return follow(files, parse, path, local.text, seen);
  if (local) return { path, node: local };
  const imported = file.imports.get(identifier);
  const target =
    imported && resolveRelative(path, imported.from, p => files.has(p));
  return target ? follow(files, parse, target, imported.name, seen) : undefined;
}

/** An `access` entry as the object literal it is, and the file it is in. */
function accessObjectAt(files, parse, path, entry) {
  if (entry.object) return { path, object: entry.object };
  const target = follow(files, parse, path, entry.identifier);
  return target && ts.isObjectLiteralExpression(target.node)
    ? { path: target.path, object: target.node }
    : undefined;
}

/**
 * An access object's own properties, with those of every object spread into
 * it (`{ ...shared }`), each beside the file it is written in.
 */
function propertiesOf(files, parse, at, seen = new Set()) {
  if (seen.has(at.object)) return [];
  seen.add(at.object);
  return at.object.properties.flatMap(property => {
    if (!ts.isSpreadAssignment(property)) return [{ path: at.path, property }];
    const spread = unwrap(property.expression);
    const inner = ts.isObjectLiteralExpression(spread)
      ? { path: at.path, object: spread }
      : ts.isIdentifier(spread)
        ? accessObjectAt(files, parse, at.path, { identifier: spread.text })
        : undefined;
    return inner ? propertiesOf(files, parse, inner, seen) : [];
  });
}

/** A rule an `access` object names, as the function it is, where declared. */
function ruleAt(files, parse, path, rule) {
  if (rule.fn) return { path, fn: rule.fn, name: rule.name };
  const target = follow(files, parse, path, rule.identifier);
  return target && isFunctionNode(target.node)
    ? { path: target.path, fn: target.node, name: rule.name }
    : undefined;
}

/** One file's access rules, each with where it is declared and its name. */
function rulesIn(files, parse, path) {
  const { source, declarations } = parse(path);
  const typed = [...declarations]
    .filter(([, entry]) => entry.typed && isFunctionNode(entry.node))
    .map(([name, entry]) => ({ path, fn: entry.node, name }));
  const declared = accessObjects(source)
    .map(entry => accessObjectAt(files, parse, path, entry))
    .filter(Boolean)
    .flatMap(at => propertiesOf(files, parse, at))
    .map(({ path: at, property }) => {
      const rule = ruleOfProperty(property);
      return rule && ruleAt(files, parse, at, rule);
    })
    .filter(Boolean);
  return [...typed, ...declared];
}

/**
 * Every access rule in `files` that reads a role, as `{ path, line, name }`.
 *
 * `files` maps each repository-relative path to its source text; an import is
 * followed only to a file in that map, which is what keeps this testable over
 * fixtures and bounded to the scanned roots. A rule reached several ways is
 * reported once, where it is declared, under the first name seen for it.
 */
export function findRoleNameRules(files) {
  const parse = parserOver(files);
  const rules = new Map();
  for (const rule of [...files.keys()].flatMap(path =>
    rulesIn(files, parse, path)
  )) {
    const key = `${rule.path}:${rule.fn.pos}`;
    if (!rules.has(key)) rules.set(key, rule);
  }
  return [...rules.values()]
    .filter(({ fn }) => readsRole(fn))
    .map(({ path, fn, name }) => {
      const { source } = parse(path);
      const { line } = source.getLineAndCharacterOfPosition(
        fn.getStart(source)
      );
      return { path, line: line + 1, name };
    })
    .sort((x, y) => x.path.localeCompare(y.path) || x.line - y.line);
}

/** The shipped source under the scan roots, from git rather than a walk. */
export function shippedFiles(cwd = root, run = execFileSync) {
  const listed = run("git", ["ls-files", "-z", "--", "templates", "packages"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Map();
  for (const path of listed.split("\0").filter(Boolean)) {
    if (isShippedSource(path))
      files.set(path, readFileSync(join(cwd, path), "utf8"));
  }
  return files;
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("check-access-rule-role-names.mjs")
) {
  const files = shippedFiles();
  const findings = findRoleNameRules(files);
  if (findings.length > 0) {
    console.error(
      `check-access-rule-role-names: ${findings.length} shipped access rule(s) decide by a role's name:\n`
    );
    for (const { path, line, name } of findings) {
      console.error(`  ${path}:${line}  ${name}`);
    }
    console.error(
      "\nDecide by the caller's permission instead: the rule is given " +
        "`permissions` as `resource:action`, e.g. " +
        "`({ permissions, collection, operation }) => " +
        "permissions.includes(`${collection}:${operation}`)`."
    );
    process.exit(1);
  }
  console.log(
    `check-access-rule-role-names: ok - no access rule reads a role, across ${files.size} shipped source file(s).`
  );
}
