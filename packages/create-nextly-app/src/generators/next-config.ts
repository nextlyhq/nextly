import path from "path";

import { parse } from "@babel/parser";
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  Statement,
  TSAsExpression,
  TSNonNullExpression,
  TSSatisfiesExpression,
  TSTypeAssertion,
} from "@babel/types";
import fs from "fs-extra";

import type { DatabaseConfig } from "../types";

import type { GeneratedFiles } from "./generated-files";

/**
 * Where Nextly explains why Cache Components is off and when it will be
 * supported: the same page `nextly` links from the error it stops with.
 */
export const CACHE_COMPONENTS_DOCS_URL =
  "https://nextlyhq.com/docs/getting-started/installation#cache-components";

/**
 * Packages that are always externalized by the scaffolded Next.js config.
 *
 * These packages are used by Nextly at runtime and should stay out of the
 * server bundle regardless of the selected database.
 */
const COMMON_SERVER_EXTERNAL_PACKAGES = [
  "nextly",
  "@nextlyhq/adapter-drizzle",
  "drizzle-orm",
  "drizzle-kit",
  "bcryptjs",
  "sharp",
  "esbuild",
];

/**
 * Database-specific packages needed by the selected adapter.
 */
const DATABASE_SERVER_EXTERNAL_PACKAGES: Record<
  DatabaseConfig["type"],
  string[]
> = {
  postgresql: ["@nextlyhq/adapter-postgres", "pg"],
  mysql: ["@nextlyhq/adapter-mysql", "mysql2"],
  sqlite: ["@nextlyhq/adapter-sqlite", "better-sqlite3"],
};

/**
 * Build the exact list of packages that should be externalized for a chosen
 * database.
 */
export function getServerExternalPackages(database: DatabaseConfig): string[] {
  return [
    ...COMMON_SERVER_EXTERNAL_PACKAGES,
    ...DATABASE_SERVER_EXTERNAL_PACKAGES[database.type],
  ];
}

/** The package list as an indented array literal, for a config written whole. */
function packageListLiteral(database: DatabaseConfig): string {
  return JSON.stringify(getServerExternalPackages(database), null, 2).replace(
    /\n/g,
    "\n  "
  );
}

/**
 * The setting every config this writes carries, with its reason in the file:
 * the developer who finds it is the one deciding whether to change it.
 */
const CACHE_COMPONENTS_OFF = `  // Nextly does not support Cache Components yet: it caches with
  // unstable_cache, and Cache Components refuses \`runtime\` route exports.
  // ${CACHE_COMPONENTS_DOCS_URL}
  cacheComponents: false,`;

/**
 * Render a complete next.config.ts file for the selected database.
 */
export function buildNextConfigTemplate(database: DatabaseConfig): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
${CACHE_COMPONENTS_OFF}
  serverExternalPackages: ${packageListLiteral(database)},
};

export default nextConfig;
`;
}

/** The same config as a JavaScript module, for an app without TypeScript. */
function buildNextConfigModule(database: DatabaseConfig): string {
  return `/** @type {import("next").NextConfig} */
const nextConfig = {
${CACHE_COMPONENTS_OFF}
  serverExternalPackages: ${packageListLiteral(database)},
};

export default nextConfig;
`;
}

/**
 * What patching the app's Next config did.
 *
 * - `written`: the packages in `added` were added to an existing config.
 * - `created`: the app had no Next config, so one was written.
 * - `unchanged`: every package was already listed.
 * - `manual`: the config could not be changed safely, so it was left as it was
 *   and `packages` is what the developer adds by hand.
 */
export type NextConfigPatch =
  | { kind: "written" | "created"; file: string; added: string[] }
  | { kind: "unchanged"; file: string }
  | {
      kind: "manual";
      file: string;
      reason: string;
      packages: string[];
    };

/**
 * The config files Next.js reads, in the order it prefers them (its
 * `CONFIG_FILES`). `next.config.mts` is read where Node runs TypeScript itself;
 * an app that has one is using it, so it is looked for wherever it exists.
 */
const CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
];

const PROPERTY = "serverExternalPackages";

/**
 * The deprecated spelling of the list, under `experimental`. Supported
 * releases still read it, by copying it over the top-level list, so an app
 * that has it would lose the packages this adds there.
 */
const LEGACY_PROPERTY = "serverComponentsExternalPackages";

/** A text insertion at an offset of the original source, replacing `remove` characters. */
type Edit = { at: number; remove: number; text: string };
type Plan = { edits: Edit[]; added: string[] } | { reason: string };

/** Where the line holding `offset` starts. */
const lineStart = (source: string, offset: number) =>
  source.lastIndexOf("\n", offset - 1) + 1;

/** The whitespace a line opens with, for the line holding `offset`. */
const indentAt = (source: string, offset: number) =>
  /^[ \t]*/.exec(source.slice(lineStart(source, offset)))?.[0] ?? "";

/** Whether the text between two offsets spans more than one line. */
const spansLines = (source: string, from: number, to: number) =>
  source.slice(from, to).includes("\n");

/** Whether a node is the identifier `name`. */
const isNamed = (node: Node, name: string) =>
  node.type === "Identifier" && node.name === name;

/** The value of `export default`, or why it is not one this can follow. */
function defaultExportOf(statement: Statement): Expression | string | null {
  if (statement.type !== "ExportDefaultDeclaration") return null;
  const value = statement.declaration;
  return value.type === "FunctionDeclaration" ||
    value.type === "ClassDeclaration" ||
    value.type === "TSDeclareFunction"
    ? "it exports a function"
    : value;
}

/** The value assigned to `module.exports`, if the statement is that assignment. */
function moduleExportsOf(statement: Statement): Expression | null {
  if (statement.type !== "ExpressionStatement") return null;
  const { expression } = statement;
  if (expression.type !== "AssignmentExpression") return null;
  const { left } = expression;
  return left.type === "MemberExpression" &&
    isNamed(left.object, "module") &&
    isNamed(left.property, "exports")
    ? expression.right
    : null;
}

/**
 * How many places in the file can set what it exports: each `export default`,
 * and each reference to `module` or `exports`. A CommonJS config that only
 * assigns `module.exports` once refers to `module` once; any other mention,
 * `module["exports"]`, a property set on the export, or `module` handed on,
 * may change what Next.js receives.
 */
const exportSites = (body: Statement[]) =>
  body.filter(statement => statement.type === "ExportDefaultDeclaration")
    .length +
  referenceCount("module", body) +
  referenceCount("exports", body);

/**
 * The value `export default` or `module.exports =` hands Next.js, or why
 * there is none this can follow. Any second place that can set or change the
 * export makes what Next.js receives something reading the file cannot
 * settle, so it answers why instead.
 */
function exportedValue(body: Statement[]): Expression | string {
  const [value] = body.flatMap(statement => {
    const exported = defaultExportOf(statement) ?? moduleExportsOf(statement);
    return exported === null ? [] : [exported];
  });
  if (value === undefined) return "it has no default export";
  return exportSites(body) > 1
    ? "it sets or changes what it exports in more than one place"
    : value;
}

/** The initial value of a variable declared at the top of the file, if it has one. */
function declaredValue(name: string, body: Statement[]): Expression | null {
  for (const statement of body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === "Identifier" && declarator.id.name === name) {
        return declarator.init ?? null;
      }
    }
  }
  return null;
}

/**
 * The object literal the exported value comes from, following a variable, a
 * type assertion such as `satisfies NextConfig`, and a wrapper such as
 * `withMDX(nextConfig)` to its first argument. A function of the build phase,
 * or anything else whose object is not written in this file, cannot be edited
 * safely, so it answers why instead.
 */
function configObject(
  value: Expression,
  body: Statement[],
  depth = 0,
  throughCalls = true
): ObjectExpression | string {
  if (depth > 8) return "its config is built in a way this cannot follow";
  if (value.type === "ObjectExpression") return value;
  if (isTypeAssertion(value))
    return configObject(value.expression, body, depth + 1, throughCalls);
  if (value.type === "Identifier")
    return followVariable(value.name, body, depth, throughCalls);
  if (value.type === "CallExpression") {
    // A wrapper hands Next.js what it returns, not the object it was given:
    // followed for an edit to that object, never trusted to say what Next.js
    // finally receives.
    return throughCalls
      ? followCall(value, body, depth)
      : "its config is the result of a call, which may change any setting";
  }
  return value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression"
    ? "it exports a function"
    : "its config is not an object written in this file";
}

/** A TypeScript assertion around a value, which changes its type and never its contents. */
function isTypeAssertion(
  value: Expression
): value is
  | TSSatisfiesExpression
  | TSAsExpression
  | TSNonNullExpression
  | TSTypeAssertion {
  return (
    value.type === "TSSatisfiesExpression" ||
    value.type === "TSAsExpression" ||
    value.type === "TSNonNullExpression" ||
    value.type === "TSTypeAssertion"
  );
}

/**
 * The config a variable holds, when the file declares it and refers to it
 * only where it is exported: the declared object is then the one Next.js
 * gets. Any other reference, an assignment, a property set at any depth, an
 * alias or a call it is handed to, may change it unseen.
 */
function followVariable(
  name: string,
  body: Statement[],
  depth: number,
  throughCalls = true
): ObjectExpression | string {
  if (referenceCount(name, body) > 1) {
    return `its ${name} is used again after it is declared, where it may be changed`;
  }
  const declared = declaredValue(name, body);
  return declared
    ? configObject(declared, body, depth + 1, throughCalls)
    : "its config is not declared in this file";
}

/**
 * The config a wrapper call is handed, when it is handed exactly one
 * argument, as in `withMDX(nextConfig)`. With several, as in
 * `withSentryConfig(nextConfig, { org })`, which one becomes the config is
 * the wrapper's own contract, which reading the file cannot tell, so it
 * answers why.
 */
function followCall(
  call: CallExpression,
  body: Statement[],
  depth: number
): ObjectExpression | string {
  const [only, ...rest] = call.arguments;
  const followable =
    only !== undefined &&
    rest.length === 0 &&
    only.type !== "SpreadElement" &&
    only.type !== "ArgumentPlaceholder";
  return followable
    ? configObject(only, body, depth + 1)
    : "it exports the result of a call whose config argument cannot be told";
}

/** Keys of a node that hold positions and comments, never code. */
const NOT_CODE = new Set([
  "loc",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value;

/**
 * The keys under which a node names something rather than refers to a
 * variable: a declaration's own name, `b` in `a.b`, and a key written as a
 * plain name. Every other identifier is counted as a reference, a function's
 * parameters among them, which can only refuse more configs, never fewer.
 */
function namingKeys(node: Node): readonly string[] {
  // Only a plain name: a destructuring pattern can hold code, a default
  // value or a computed key, which may use the variable.
  if (node.type === "VariableDeclarator")
    return node.id.type === "Identifier" ? ["id"] : [];
  if ("computed" in node && node.computed) return [];
  if ("property" in node) return ["property"];
  return "key" in node ? ["key"] : [];
}

/** Every node under a node that is code, depth first, leaving out naming positions. */
function* nodesUnder(node: unknown): Generator<Node> {
  if (Array.isArray(node)) return yield* nodesIn(node);
  if (!isNode(node)) return;
  yield node;
  const naming = namingKeys(node);
  yield* nodesIn(
    Object.entries(node)
      .filter(([key]) => !NOT_CODE.has(key) && !naming.includes(key))
      .map(([, value]) => value)
  );
}

function* nodesIn(values: unknown[]): Generator<Node> {
  for (const value of values) yield* nodesUnder(value);
}

/** How many times the file refers to the variable `name`, anywhere in it. */
function referenceCount(name: string, body: Statement[]): number {
  let count = 0;
  for (const node of nodesUnder(body)) if (isNamed(node, name)) count++;
  return count;
}

/**
 * The index of the last item that passes, or -1. The last, because a later
 * property of the same name is the one JavaScript keeps.
 */
function lastIndexOf<T>(
  items: readonly T[],
  test: (item: T) => boolean
): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (test(items[index])) return index;
  }
  return -1;
}

/**
 * The name a property's key spells when it can be read without running the
 * file: an identifier, a string, or a computed key that is a plain string or
 * template. Null for a computed key built from anything else.
 */
function keyName(property: ObjectProperty | ObjectMethod): string | null {
  const { key } = property;
  if (!property.computed && key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** Whether a property is the given one, under any spelling of its key. */
function isPropertyNamed(
  property: Node,
  name: string
): property is ObjectProperty {
  return property.type === "ObjectProperty" && keyName(property) === name;
}

/** Whether a property is the list, under any spelling of its key. */
function isListProperty(property: Node): property is ObjectProperty {
  return isPropertyNamed(property, PROPERTY);
}

/**
 * Whether a property might set one of `names` in a way this cannot read: a
 * spread, a computed key built at run time, or a getter or method of one of
 * those names.
 */
function mayHide(property: Node, names: readonly string[]): boolean {
  if (property.type === "SpreadElement") return true;
  if (property.type !== "ObjectMethod" && property.type !== "ObjectProperty")
    return false;
  const name = keyName(property);
  return (
    name === null || (property.type === "ObjectMethod" && names.includes(name))
  );
}

/**
 * The settings an edit depends on, at the top of the config and under
 * `experimental`: the list itself, and the lists Next.js checks it against.
 */
const TOP_LEVEL_SETTINGS = [PROPERTY, "transpilePackages", "experimental"];
const EXPERIMENTAL_SETTINGS = ["optimizePackageImports", LEGACY_PROPERTY];

/** Why an object might set one of `names` where this cannot read it, or null. */
function hiddenSettings(
  object: ObjectExpression,
  names: readonly string[],
  where: string
): string | null {
  return object.properties.some(property => mayHide(property, names))
    ? `${where} spreads another object or has a computed or accessor property, which may set ${names.join(", ")}`
    : null;
}

/** The package names an array literal already lists. */
function listedNames(array: ArrayExpression): Set<string> {
  const names = new Set<string>();
  for (const element of array.elements) {
    if (element?.type === "StringLiteral") names.add(element.value);
  }
  return names;
}

/** The quote the file already writes strings with, so an addition matches it. */
function quoteOf(array: ArrayExpression | null, body: Statement[]): string {
  const literal =
    array?.elements.find(element => element?.type === "StringLiteral") ??
    body.find(statement => statement.type === "ImportDeclaration")?.source;
  const raw = literal?.extra?.raw;
  return typeof raw === "string" && raw.startsWith("'") ? "'" : '"';
}

/**
 * Add names straight after the last entry of an existing list, in its own
 * layout: one entry per line when the list is written that way, and on the
 * same line otherwise. A trailing comma after the last entry then follows the
 * last added one, so a list that had one keeps it.
 */
function appendToList(
  source: string,
  array: ArrayExpression,
  entries: string[]
): Edit {
  const elements = array.elements.filter(element => element !== null);
  const open = (array.start ?? 0) + 1;
  const last = elements.at(-1);
  if (!last) return fillEmptyList(source, array, entries);
  const separator = spansLines(source, open, last.start ?? 0)
    ? `,\n${indentAt(source, last.start ?? 0)}`
    : ", ";
  return {
    at: last.end ?? 0,
    remove: 0,
    text: entries.map(entry => `${separator}${entry}`).join(""),
  };
}

/**
 * Fill an empty list. Blank brackets are replaced; brackets holding a comment
 * keep it, with the entries written after it, before the closing bracket.
 */
function fillEmptyList(
  source: string,
  array: ArrayExpression,
  entries: string[]
): Edit {
  const open = (array.start ?? 0) + 1;
  const close = (array.end ?? 0) - 1;
  const inside = source.slice(open, close);
  if (inside.trim() === "")
    return { at: open, remove: close - open, text: entries.join(", ") };
  const gap = /\s$/.test(inside) ? "" : " ";
  return { at: close, remove: 0, text: `${gap}${entries.join(", ")}` };
}

/**
 * Add the whole list as the object's last property, in the object's layout,
 * so the app's own properties keep their order and their comments.
 */
function addListProperty(
  source: string,
  object: ObjectExpression,
  entries: string[]
): Edit[] {
  const open = (object.start ?? 0) + 1;
  const close = (object.end ?? 0) - 1;
  return spansLines(source, open, close)
    ? listOnItsOwnLines(source, object, entries)
    : [listOnTheSameLine(object, entries)];
}

/** The list added to an object written on one line, as `{ a: 1, serverExternalPackages: [...] }`. */
function listOnTheSameLine(object: ObjectExpression, entries: string[]): Edit {
  const property = `${PROPERTY}: [${entries.join(", ")}]`;
  const last = object.properties.at(-1);
  const open = (object.start ?? 0) + 1;
  return last
    ? { at: last.end ?? 0, remove: 0, text: `, ${property}` }
    : { at: open, remove: (object.end ?? 0) - 1 - open, text: ` ${property} ` };
}

/**
 * The list added as the last property of an object written over several
 * lines, one entry per line at the indentation the object's properties use.
 * A comma goes after the last property first when it has none.
 */
function listOnItsOwnLines(
  source: string,
  object: ObjectExpression,
  entries: string[]
): Edit[] {
  const close = (object.end ?? 0) - 1;
  const last = object.properties.at(-1);
  const indent = last
    ? indentAt(source, last.start ?? 0)
    : `${indentAt(source, close)}  `;
  const list = `${indent}${PROPERTY}: [\n${entries.map(entry => `${indent}  ${entry},\n`).join("")}${indent}],\n`;
  const needsComma =
    last !== undefined && !/^\s*,/.test(source.slice(last.end ?? 0, close));
  const comma: Edit[] = needsComma
    ? [{ at: last.end ?? 0, remove: 0, text: "," }]
    : [];
  return [...comma, beforeClosingBrace(source, close, list)];
}

/** Text put before an object's closing brace: on the line above it when the brace has a line of its own. */
function beforeClosingBrace(source: string, close: number, text: string): Edit {
  const closeLine = lineStart(source, close);
  return source.slice(closeLine, close).trim() === ""
    ? { at: closeLine, remove: 0, text }
    : { at: close, remove: 0, text: `\n${text}` };
}

/** The file's top-level statements, or null when it does not parse. */
function parseBody(source: string, file: string): Statement[] | null {
  try {
    return parse(source, {
      sourceType: "unambiguous",
      plugins: /\.m?ts$/.test(file) ? ["typescript"] : [],
    }).program.body;
  } catch {
    return null;
  }
}

/**
 * The config's own list, null when it has none, or why the list cannot be
 * edited: a list that is not an array literal cannot be read here. A spread,
 * or a property that may set the list unseen, is refused before this, by
 * `conflictOf`.
 */
function existingList(
  object: ObjectExpression
): ArrayExpression | null | string {
  const { properties } = object;
  const property = properties[lastIndexOf(properties, isListProperty)];
  if (!property || !isListProperty(property)) return null;
  return property.value.type === "ArrayExpression"
    ? property.value
    : `its ${PROPERTY} is not a list written in place`;
}

/** The value of an object's property, under any spelling of its key. */
function propertyValue(
  object: ObjectExpression,
  name: string
): Node | undefined {
  const { properties } = object;
  const property =
    properties[lastIndexOf(properties, item => isPropertyNamed(item, name))];
  return property && isPropertyNamed(property, name)
    ? property.value
    : undefined;
}

/** The names in an array of strings written in place, or null for anything else. */
function literalNames(value: Node): Set<string> | null {
  if (value.type !== "ArrayExpression") return null;
  const names = new Set<string>();
  for (const element of value.elements) {
    if (element?.type !== "StringLiteral") return null;
    names.add(element.value);
  }
  return names;
}

/**
 * Why a list the config already has would make Next.js refuse the edit:
 * Next.js stops a build when a package is in both `transpilePackages` (or
 * `experimental.optimizePackageImports`, which it transpiles too) and
 * `serverExternalPackages`. A list it cannot read is treated the same.
 */
function clashReason(
  label: string,
  holder: ObjectExpression,
  name: string,
  required: string[]
): string | null {
  const value = propertyValue(holder, name);
  if (!value) return null;
  const names = literalNames(value);
  if (!names)
    return `its ${label} is not a list written in place, so it may hold a package Next.js refuses in both lists`;
  const clash = required.filter(item => names.has(item));
  if (clash.length === 0) return null;
  return `${clash.join(", ")} also appear${clash.length === 1 ? "s" : ""} in its ${label}, and Next.js refuses a package in both that and ${PROPERTY}; remove ${clash.length === 1 ? "it" : "them"} from ${label} first`;
}

/** The config's `experimental` object, null when it has none, or why it cannot be read. */
function experimentalOf(
  object: ObjectExpression
): ObjectExpression | null | string {
  const value = propertyValue(object, "experimental");
  if (!value) return null;
  return value.type === "ObjectExpression"
    ? value
    : "its experimental settings are not an object written in place";
}

/**
 * Why the config's other settings make an edit unsafe, or null when none
 * does. A setting this cannot read, at the top or under `experimental`, is
 * treated as one that may clash.
 */
function conflictOf(
  object: ObjectExpression,
  required: string[]
): string | null {
  const hidden = hiddenSettings(object, TOP_LEVEL_SETTINGS, "it");
  if (hidden) return hidden;
  const experimental = experimentalOf(object);
  if (typeof experimental === "string") return experimental;
  return experimental
    ? (hiddenSettings(
        experimental,
        EXPERIMENTAL_SETTINGS,
        "its experimental object"
      ) ?? experimentalConflict(object, experimental, required))
    : clashReason("transpilePackages", object, "transpilePackages", required);
}

/** Why the config's lists clash, given an `experimental` object it can read. */
function experimentalConflict(
  object: ObjectExpression,
  experimental: ObjectExpression,
  required: string[]
): string | null {
  if (propertyValue(experimental, LEGACY_PROPERTY)) {
    return `it lists packages under experimental.${LEGACY_PROPERTY}, which Next.js copies over ${PROPERTY}, replacing the packages added there; move those entries into the top-level ${PROPERTY} list and delete experimental.${LEGACY_PROPERTY}`;
  }
  return (
    clashReason("transpilePackages", object, "transpilePackages", required) ??
    clashReason(
      "experimental.optimizePackageImports",
      experimental,
      "optimizePackageImports",
      required
    )
  );
}

/** The object literal the file exports as its config, or why there is none to edit. */
function exportedConfig(
  body: Statement[],
  throughCalls = true
): ObjectExpression | string {
  const exported = exportedValue(body);
  return typeof exported === "string"
    ? exported
    : configObject(exported, body, 0, throughCalls);
}

/**
 * The strings the exported config lists under `key`, in order; `"absent"`
 * when the config it exports does not set `key`; or null when that cannot be
 * known: the file does not parse, its export cannot be followed or comes from
 * a wrapper call, the value is not an array of strings written in place, or a
 * spread, computed or accessor property may set it unseen. Every step that reads a setting from the app's config asks here,
 * so a commented-out or nested occurrence is never taken for the real one.
 */
export function configStringList(
  source: string,
  file: string,
  key: string
): string[] | "absent" | null {
  const body = parseBody(source, file);
  if (!body) return null;
  // What Next.js receives, so not through a wrapper, whose result may differ.
  const object = exportedConfig(body, false);
  if (typeof object === "string") return null;
  if (hiddenSettings(object, [key], "the config") !== null) return null;
  const value = propertyValue(object, key);
  if (value === undefined) return "absent";
  const names = literalNames(value);
  return names ? [...names] : null;
}

/** The edits that put every required package in the config's list, or why it cannot be changed. */
function planEdits(source: string, file: string, required: string[]): Plan {
  const body = parseBody(source, file);
  if (!body) return { reason: "it could not be parsed" };
  const object = exportedConfig(body);
  if (typeof object === "string") return { reason: object };
  const conflict = conflictOf(object, required);
  if (conflict) return { reason: conflict };
  const array = existingList(object);
  if (typeof array === "string") return { reason: array };
  const listed = array ? listedNames(array) : new Set<string>();
  const added = required.filter(name => !listed.has(name));
  if (added.length === 0) return { edits: [], added };
  const quote = quoteOf(array, body);
  const entries = added.map(name => `${quote}${name}${quote}`);
  return {
    edits: array
      ? [appendToList(source, array, entries)]
      : addListProperty(source, object, entries),
    added,
  };
}

/** Apply edits from the end of the text backwards, so each offset still names its place. */
function applyEdits(source: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.at - a.at)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.at) + edit.text + text.slice(edit.at + edit.remove),
      source
    );
}

/**
 * The edited config, or why the config cannot be changed. The edit is only
 * trusted once the result parses and lists every package, so a layout this
 * did not foresee is reported rather than written broken.
 */
function editConfig(
  source: string,
  file: string,
  required: string[]
): { text: string; added: string[] } | { reason: string } {
  const plan = planEdits(source, file, required);
  if ("reason" in plan) return plan;
  const text = applyEdits(source, plan.edits);
  const recheck = planEdits(text, file, required);
  if ("reason" in recheck || recheck.added.length > 0) {
    return { reason: "the edit could not be confirmed" };
  }
  return { text, added: plan.added };
}

/**
 * The Next config file any advice about the app's config names: the one it
 * has, or, when it has none, the one to create. `.mjs` is ESM whatever the
 * package's own "type" says, so that file loads in any project. Every step
 * that tells the developer to change the config asks here, so two steps never
 * name two different files.
 */
export async function nextConfigFileToChange(cwd: string): Promise<string> {
  return (await findConfigFile(cwd)) ?? "next.config.mjs";
}

/**
 * The app's Next config file, by the name Next.js would read first. Every
 * step that reads the app's config finds it here, so none reads a file that
 * another step would pass over and replace.
 */
export async function findConfigFile(cwd: string): Promise<string | null> {
  for (const name of CONFIG_FILES) {
    if (await fs.pathExists(path.join(cwd, name))) return name;
  }
  return null;
}

/**
 * Write a Next config for an app that has none: TypeScript when the app has a
 * tsconfig.json, a JavaScript module otherwise, since a TypeScript config in
 * an app without TypeScript would not load. `wx` refuses to replace a file
 * that appeared after the search.
 */
async function createNextConfig(
  cwd: string,
  database: DatabaseConfig
): Promise<NextConfigPatch> {
  const typescript = await fs.pathExists(path.join(cwd, "tsconfig.json"));
  const file = typescript ? "next.config.ts" : "next.config.mjs";
  const text = typescript
    ? buildNextConfigTemplate(database)
    : buildNextConfigModule(database);
  await fs.writeFile(path.join(cwd, file), text, {
    encoding: "utf-8",
    flag: "wx",
  });
  return { kind: "created", file, added: getServerExternalPackages(database) };
}

/**
 * Put the packages Nextly needs into the app's Next config, so Next.js loads
 * them from node_modules rather than bundling them.
 *
 * The config is parsed, not matched as text, and only the missing names are
 * inserted: the app's own entries, their order, its comments and its layout
 * stay as they were. A config this cannot change safely is left untouched,
 * and the result says what to add by hand.
 */
export async function patchNextConfig(
  cwd: string,
  database: DatabaseConfig
): Promise<NextConfigPatch> {
  const file = await findConfigFile(cwd);
  const required = getServerExternalPackages(database);
  if (!file) return createNextConfig(cwd, database);
  const source = await fs.readFile(path.join(cwd, file), "utf-8");
  const edited = editConfig(source, file, required);
  if ("reason" in edited)
    return { kind: "manual", file, reason: edited.reason, packages: required };
  if (edited.added.length === 0) return { kind: "unchanged", file };
  await fs.writeFile(path.join(cwd, file), edited.text, "utf-8");
  return { kind: "written", file, added: edited.added };
}

/** The setting Nextly needs off, and the one Next.js accepts only with it on. */
const CACHE_COMPONENTS = "cacheComponents";
const PARTIAL_PREFETCHING = "partialPrefetching";

/**
 * What turning Cache Components off in an existing app's config did.
 *
 * - `turned-off`: `cacheComponents: true` became `false`, and the settings in
 *   `removed`, which Next.js accepts only with it on, were taken out.
 * - `unchanged`: it was already off, or the app has no config, which leaves
 *   Next.js's default, off.
 * - `manual`: the setting could not be read or changed safely, so the file was
 *   left as it was.
 */
export type CacheComponentsPatch =
  | { kind: "turned-off"; file: string; removed: string[] }
  | { kind: "unchanged" }
  | { kind: "manual"; file: string; reason: string };

/**
 * Remove a property with the comma that separates it: the whole line when it
 * has one of its own, else the property and the comma after it, or before it
 * when it is the last one.
 */
function removeProperty(source: string, property: ObjectProperty): Edit {
  const start = property.start ?? 0;
  const end = property.end ?? 0;
  const ownLine = /^\s*$/.test(source.slice(lineStart(source, start), start));
  const rest = /^[ \t]*,?[ \t]*\n/.exec(source.slice(end));
  if (ownLine && rest) {
    const from = lineStart(source, start);
    return { at: from, remove: end + rest[0].length - from, text: "" };
  }
  const after = /^\s*,\s*/.exec(source.slice(end));
  if (after)
    return { at: start, remove: end - start + after[0].length, text: "" };
  const before = /,\s*$/.exec(source.slice(0, start));
  const from = before ? start - before[0].length : start;
  return { at: from, remove: end - from, text: "" };
}

/** The exported config object, when both settings in it can be read; else why not. */
function cacheComponentsObject(
  source: string,
  file: string
): ObjectExpression | string {
  const body = parseBody(source, file);
  if (!body) return "it could not be parsed";
  // Not through a wrapper call: Next.js receives what the wrapper returns, which
  // may set the option again, so the literal passed in says nothing final.
  const object = exportedConfig(body, false);
  if (typeof object === "string") return object;
  return (
    hiddenSettings(object, [CACHE_COMPONENTS, PARTIAL_PREFETCHING], "it") ??
    object
  );
}

/** The `true` to flip, null when Cache Components is off or unset, or why the value cannot be read. */
function enabledValue(object: ObjectExpression): Node | null | string {
  const value = propertyValue(object, CACHE_COMPONENTS);
  if (!value) return null;
  if (value.type !== "BooleanLiteral") {
    return `its ${CACHE_COMPONENTS} is not true or false written in place`;
  }
  return value.value ? value : null;
}

/** The edits that turn Cache Components off in a config, none when it is off, or why it cannot be changed. */
function cacheComponentsPlan(
  source: string,
  file: string
): { edits: Edit[]; removed: string[] } | { reason: string } {
  const object = cacheComponentsObject(source, file);
  if (typeof object === "string") return { reason: object };
  const value = enabledValue(object);
  if (typeof value === "string") return { reason: value };
  if (!value) return { edits: [], removed: [] };
  const flip: Edit = {
    at: value.start ?? 0,
    remove: (value.end ?? 0) - (value.start ?? 0),
    text: "false",
  };
  // Every definition, under any spelling of its key: the last one wins at run
  // time, so removing only the first can leave the one Next.js reads.
  const prefetching = object.properties.filter(
    (property): property is ObjectProperty =>
      isPropertyNamed(property, PARTIAL_PREFETCHING)
  );
  return {
    edits: [
      flip,
      ...prefetching.map(property => removeProperty(source, property)),
    ],
    removed: prefetching.length > 0 ? [PARTIAL_PREFETCHING] : [],
  };
}

/** Whether a config, read as code, still defines `partialPrefetching` anywhere in its exported object. */
function definesPartialPrefetching(source: string, file: string): boolean {
  const object = cacheComponentsObject(source, file);
  return (
    typeof object !== "string" &&
    object.properties.some(property =>
      isPropertyNamed(property, PARTIAL_PREFETCHING)
    )
  );
}

/**
 * Turn Next.js Cache Components off in an existing app's config, which
 * Nextly does not support yet; `create-next-app` 16.4 turns it on by default.
 *
 * Only `cacheComponents: true` written in place is changed, and
 * `partialPrefetching` goes with it, since Next.js refuses that option once
 * Cache Components is off. The edit is trusted only once the result parses
 * and reads as off; anything else is left as it was, with what to change.
 */
export async function turnOffCacheComponents(
  cwd: string
): Promise<CacheComponentsPatch> {
  const file = await findConfigFile(cwd);
  if (!file) return { kind: "unchanged" };
  const source = await fs.readFile(path.join(cwd, file), "utf-8");
  // Read structurally even when the file never names the setting: a spread or
  // a wrapper can still turn it on, and only the parser can say it cannot tell.
  const plan = cacheComponentsPlan(source, file);
  if ("reason" in plan) return { kind: "manual", file, reason: plan.reason };
  if (plan.edits.length === 0) return { kind: "unchanged" };
  const text = applyEdits(source, plan.edits);
  const recheck = cacheComponentsPlan(text, file);
  if (
    "reason" in recheck ||
    recheck.edits.length > 0 ||
    definesPartialPrefetching(text, file)
  ) {
    return { kind: "manual", file, reason: "the edit could not be confirmed" };
  }
  await fs.writeFile(path.join(cwd, file), text, "utf-8");
  return { kind: "turned-off", file, removed: plan.removed };
}

/**
 * What turning Cache Components off did, for the run's report: the change and
 * a notice saying why, or, for a config it could not change, what to change.
 */
export function cacheComponentsFiles(
  patch: CacheComponentsPatch
): GeneratedFiles {
  const files: GeneratedFiles = { written: [], changed: [], skipped: [] };
  if (patch.kind === "turned-off") {
    files.changed.push({
      path: patch.file,
      added: [`${CACHE_COMPONENTS}: false`],
    });
    const removed = patch.removed.length
      ? `, and removed ${patch.removed.join(", ")}, which Next.js accepts only with it on`
      : "";
    files.notices = [
      `Turned Cache Components off in ${patch.file}: Nextly does not support it yet${removed}. ` +
        `Why, and the plan to support it: ${CACHE_COMPONENTS_DOCS_URL}`,
    ];
  } else if (patch.kind === "manual") {
    files.skipped.push({
      path: patch.file,
      why: `Nextly could not confirm Cache Components is off: ${patch.reason}. Nextly does not support it yet (${CACHE_COMPONENTS_DOCS_URL}); make sure the config Next.js receives leaves it unset or sets it to false, with no ${PARTIAL_PREFETCHING}`,
      toAdd: `  ${CACHE_COMPONENTS}: false,`,
    });
  }
  return files;
}

/** What to add by hand: the list, as the config's top-level option. */
function optionText(packages: string[]): string {
  const list = packages.map(name => JSON.stringify(name)).join(", ");
  return `  ${PROPERTY}: [${list}],`;
}

/**
 * What a patch did, in the shape every existing-app step reports in: the
 * packages added, or, when the file could not be changed safely, exactly what
 * to add and where. Nothing is said for a config that already lists them all.
 */
export function nextConfigFiles(patch: NextConfigPatch): GeneratedFiles {
  const files: GeneratedFiles = { written: [], changed: [], skipped: [] };
  switch (patch.kind) {
    case "written":
      files.changed.push({
        path: patch.file,
        added: [`${PROPERTY}: ${patch.added.join(", ")}`],
      });
      break;
    case "created":
      files.written.push(patch.file);
      break;
    case "unchanged":
      break;
    case "manual":
      files.skipped.push({
        path: patch.file,
        why: `Nextly's packages were not added: ${patch.reason}. Add them to the config object it exports, keeping any packages and experimental keys already there`,
        toAdd: optionText(patch.packages),
      });
  }
  return files;
}
