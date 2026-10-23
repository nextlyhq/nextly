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

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

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

/** The node types a rule can be written as. */
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

function isFunctionNode(node) {
  return FUNCTION_TYPES.has(node?.type);
}

/**
 * The expression under parentheses, `as`, `satisfies` and `!`, which change
 * what the compiler believes about a value and nothing about what it is.
 */
function unwrap(node) {
  let inner = node;
  while (
    inner.type === "ParenthesizedExpression" ||
    inner.type === "TSAsExpression" ||
    inner.type === "TSSatisfiesExpression" ||
    inner.type === "TSNonNullExpression" ||
    inner.type === "TSTypeAssertion"
  )
    inner = inner.expression;
  return inner;
}

/** A quoted string's value, or undefined for anything else. */
function quotedString(node) {
  const isString = node?.type === "Literal" && typeof node.value === "string";
  return isString ? node.value : undefined;
}

/** A name written plainly: an identifier, or a quoted string. */
function plainName(node) {
  return node?.type === "Identifier" ? node.name : quotedString(node);
}

/**
 * The name a property is written under: a plain key, or a computed key that is
 * a string (`["role"]`), which names the property as surely. A key computed
 * from anything else has no name to read.
 */
function propertyName(property) {
  return property.computed
    ? quotedString(property.key)
    : plainName(property.key);
}

/** `{ roles }` or `{ role: r }` in a destructuring pattern. */
function bindsRole(node, parent) {
  if (node.type !== "Property" || parent?.type !== "ObjectPattern")
    return false;
  return ROLE_KEYS.has(propertyName(node) ?? "");
}

/** `x.roles`, `x.role`, `x["roles"]` or `x["role"]`. */
function accessesRole(node) {
  if (node.type !== "MemberExpression") return false;
  const key = node.computed
    ? quotedString(node.property)
    : plainName(node.property);
  return ROLE_KEYS.has(key ?? "");
}

/** Whether a function reads a role anywhere in its parameters or body. */
function readsRole(fn) {
  let reads = false;
  walk(fn, (node, ancestors) => {
    if (reads) return false;
    if (bindsRole(node, ancestors.at(-1)) || accessesRole(node)) reads = true;
  });
  return reads;
}

/**
 * A top-level `function` or `const` declaration, as the index keeps it: the
 * node it declares (the function, or the `const`'s initializer) and whether
 * its type names it an access rule. An `export` around a declaration changes
 * nothing about what it declares.
 */
function declarationsOf(statement, text) {
  if (statement.type === "ExportDefaultDeclaration") {
    const declared = statement.declaration;
    if (declared.type === "FunctionDeclaration") {
      const entry = { node: declared, typed: false };
      return [
        ...(declared.id ? [[declared.id.name, entry]] : []),
        ["default", entry],
      ];
    }
    return declared.type === "ClassDeclaration"
      ? []
      : [["default", { node: unwrap(declared), typed: false }]];
  }
  const declared =
    statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
  if (declared?.type === "FunctionDeclaration") {
    return declared.id
      ? [[declared.id.name, { node: declared, typed: false }]]
      : [];
  }
  if (declared?.type !== "VariableDeclaration") return [];
  return declared.declarations
    .filter(decl => decl.id.type === "Identifier" && decl.init)
    .map(decl => {
      const annotation = decl.id.typeAnnotation?.typeAnnotation;
      return [
        decl.id.name,
        {
          node: unwrap(decl.init),
          typed:
            annotation !== undefined &&
            annotation !== null &&
            RULE_TYPE.test(text.slice(annotation.start, annotation.end)),
        },
      ];
    });
}

/** The specifier of a relative import, or undefined for any other statement. */
function relativeSpecifier(statement) {
  if (statement.type !== "ImportDeclaration") return undefined;
  const specifier = statement.source.value;
  return specifier.startsWith(".") ? specifier : undefined;
}

/** A relative import's default and named bindings, by local name. */
function relativeImportsOf(statement) {
  const from = relativeSpecifier(statement);
  if (!from) return [];
  return statement.specifiers.flatMap(specifier => {
    if (specifier.type === "ImportDefaultSpecifier")
      return [[specifier.local.name, { from, name: "default" }]];
    if (specifier.type === "ImportSpecifier")
      return [
        [specifier.local.name, { from, name: plainName(specifier.imported) }],
      ];
    return [];
  });
}

/** The named elements of an `export { ... }`, or none for any other statement. */
function exportedElements(statement) {
  return statement.type === "ExportNamedDeclaration" &&
    statement.exportKind !== "type" &&
    statement.declaration === null
    ? statement.specifiers
    : [];
}

/**
 * What a file passes on under another name. `export { a } from "./b"` reads
 * as an import of `a` from `./b`; `export { a as b }` as a local `b` naming
 * `a`, which is followed as `export default a` is.
 */
function reExportsOf(statement) {
  const elements = exportedElements(statement);
  const from =
    statement.type === "ExportNamedDeclaration"
      ? statement.source?.value
      : undefined;
  return from === undefined
    ? { imports: [], declarations: renamedLocals(elements) }
    : { imports: forwardedImports(elements, from), declarations: [] };
}

/** `export { a } from "./b"`: each name passed on, as an import of it from that module. */
function forwardedImports(elements, from) {
  if (!from.startsWith(".")) return [];
  return elements.map(element => [
    plainName(element.exported),
    { from, name: plainName(element.local) },
  ]);
}

/** `export { a as b }`: each renamed local, as a declaration of `b` naming `a`. */
function renamedLocals(elements) {
  return elements
    .filter(element => plainName(element.local) !== plainName(element.exported))
    .map(element => [
      plainName(element.exported),
      { node: element.local, typed: false },
    ]);
}

/** Top-level declarations by name, and the relative imports by local name. */
function indexFile(program, text) {
  const reExports = program.body.map(reExportsOf);
  return {
    declarations: new Map([
      ...program.body.flatMap(statement => declarationsOf(statement, text)),
      ...reExports.flatMap(entry => entry.declarations),
    ]),
    imports: new Map([
      ...program.body.flatMap(relativeImportsOf),
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
  if (value.type === "Identifier")
    return { identifier: value.name, name: value.name };
  return undefined;
}

/**
 * What a property of an `access: { ... }` object names: an inline function,
 * or an identifier to follow, with the name a finding reports it under. A
 * getter or setter names no rule.
 */
function ruleOfProperty(property) {
  if (property.type !== "Property" || property.kind !== "init")
    return undefined;
  const operation = propertyName(property) ?? "access";
  if (property.method) return { fn: property.value, name: operation };
  // A shorthand property's value is the identifier it names.
  return ruleOfValue(property.value, operation);
}

/**
 * Every `access` a file declares: an object literal written in place, or the
 * name of one declared elsewhere (`access: shared`, or `{ access }`). Only
 * properties of an object LITERAL count; `const { access } = config` reads
 * one rather than declaring it.
 */
function accessObjects(program) {
  const found = [];
  walk(program, (node, ancestors) => {
    if (
      node.type !== "Property" ||
      node.kind !== "init" ||
      node.method ||
      ancestors.at(-1)?.type !== "ObjectExpression" ||
      propertyName(node) !== "access"
    ) {
      return;
    }
    if (node.shorthand) {
      found.push({ identifier: "access" });
      return;
    }
    const value = unwrap(node.value);
    if (value.type === "ObjectExpression") found.push({ object: value });
    else if (value.type === "Identifier")
      found.push({ identifier: value.name });
  });
  return found;
}

/** A memoised parse of each file in `files`, with its declarations indexed. */
function parserOver(files) {
  const parsed = new Map();
  return path => {
    if (!parsed.has(path)) {
      const text = files.get(path);
      const { program } = parseSource(text, path);
      parsed.set(path, { program, text, ...indexFile(program, text) });
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
  if (local?.type === "Identifier")
    return follow(files, parse, path, local.name, seen);
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
  return target?.node.type === "ObjectExpression"
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
    if (property.type !== "SpreadElement") return [{ path: at.path, property }];
    const spread = unwrap(property.argument);
    const inner =
      spread.type === "ObjectExpression"
        ? { path: at.path, object: spread }
        : spread.type === "Identifier"
          ? accessObjectAt(files, parse, at.path, { identifier: spread.name })
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
  const { program, declarations } = parse(path);
  const typed = [...declarations]
    .filter(([, entry]) => entry.typed && isFunctionNode(entry.node))
    .map(([name, entry]) => ({ path, fn: entry.node, name }));
  const declared = accessObjects(program)
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
    const key = `${rule.path}:${rule.fn.start}`;
    if (!rules.has(key)) rules.set(key, rule);
  }
  return [...rules.values()]
    .filter(({ fn }) => readsRole(fn))
    .map(({ path, fn, name }) => {
      const { text } = parse(path);
      return { path, line: text.slice(0, fn.start).split("\n").length, name };
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
