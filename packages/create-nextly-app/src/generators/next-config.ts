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
 * Render a complete next.config.ts file for the selected database.
 */
export function buildNextConfigTemplate(database: DatabaseConfig): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ${packageListLiteral(database)},
};

export default nextConfig;
`;
}

/** The same config as a JavaScript module, for an app without TypeScript. */
function buildNextConfigModule(database: DatabaseConfig): string {
  return `/** @type {import("next").NextConfig} */
const nextConfig = {
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
      /**
       * Which spelling of the option to print: Next.js 14 reads
       * `experimental.serverComponentsExternalPackages`, and "either" gives
       * both when the app's version could not be read. Absent, the
       * top-level `serverExternalPackages` of Next.js 15 and later.
       */
      spelling?: "legacy" | "either";
      /**
       * The app has no Next config yet, so `file` is the one to create and
       * the advice is a whole file rather than a key to add.
       */
      create?: true;
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

/** The first Next.js major whose option is the top-level `serverExternalPackages`. */
const FIRST_TOP_LEVEL_MAJOR = 15;

const PROPERTY = "serverExternalPackages";

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
const EXPERIMENTAL_SETTINGS = [
  "optimizePackageImports",
  "serverComponentsExternalPackages",
];

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
  if (propertyValue(experimental, "serverComponentsExternalPackages")) {
    return `it lists packages under experimental.serverComponentsExternalPackages, which Next.js moves to ${PROPERTY}; keep a single list there`;
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

/** The string at `keys` inside a parsed JSON file, or null. */
function stringAt(json: unknown, keys: readonly string[]): string | null {
  let value = json;
  for (const key of keys) {
    if (typeof value !== "object" || value === null || !(key in value))
      return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : null;
}

/** A JSON file of the app's, or null when it is missing or does not parse. */
async function readJsonOrNull(file: string): Promise<unknown> {
  try {
    return (await fs.readJson(file)) as unknown;
  } catch {
    return null;
  }
}

/**
 * A version range that admits one major only, such as `^15.1.0`, `~16.0`,
 * `15.x` or `16.0.0-canary.3`, with the major it admits. A range such as
 * `>=14`, `14 || 15` or `latest` admits several, or names none.
 */
const SINGLE_MAJOR = /^[\^~]?(\d+)(?:\.(?:\d+|[xX*])){0,2}(?:-[\w.]+)?$/;

/**
 * The major version of the app's Next.js: the installed one, read from its
 * own `node_modules`, or else the one its package.json range admits when
 * that range admits a single major. Null when neither tells, as when
 * dependencies are not installed yet and the range is `latest`.
 */
export async function nextMajor(cwd: string): Promise<number | null> {
  const installed = stringAt(
    await readJsonOrNull(
      path.join(cwd, "node_modules", "next", "package.json")
    ),
    ["version"]
  );
  const manifest = await readJsonOrNull(path.join(cwd, "package.json"));
  const range =
    stringAt(manifest, ["dependencies", "next"]) ??
    stringAt(manifest, ["devDependencies", "next"]);
  const match = SINGLE_MAJOR.exec((installed ?? range ?? "").trim());
  return match ? Number(match[1]) : null;
}

/**
 * Why the option cannot be written for the app's Next.js, and which spelling
 * to print instead, or null when it can. Next.js 14 reads the list under
 * another name, and an unknown version may be 14: writing the top-level list
 * there would report success and externalise nothing.
 */
function versionBlock(
  major: number | null
): { reason: string; spelling: "legacy" | "either" } | null {
  if (major === null)
    return {
      reason: "the version of Next.js the app uses could not be read",
      spelling: "either",
    };
  return major < FIRST_TOP_LEVEL_MAJOR
    ? {
        reason: `the app runs Next.js ${major}, which reads the list as experimental.serverComponentsExternalPackages and runs instrumentation.ts only with experimental.instrumentationHook`,
        spelling: "legacy",
      }
    : null;
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
  // A version that reads the list under another name, or one that cannot be
  // told, gets the exact option to add rather than a config that may do
  // nothing.
  const blocked = versionBlock(await nextMajor(cwd));
  if (blocked) {
    return {
      kind: "manual",
      file: file ?? (await nextConfigFileToChange(cwd)),
      packages: required,
      ...blocked,
      ...(file ? {} : { create: true as const }),
    };
  }
  if (!file) return createNextConfig(cwd, database);
  const source = await fs.readFile(path.join(cwd, file), "utf-8");
  const edited = editConfig(source, file, required);
  if ("reason" in edited)
    return { kind: "manual", file, reason: edited.reason, packages: required };
  if (edited.added.length === 0) return { kind: "unchanged", file };
  await fs.writeFile(path.join(cwd, file), edited.text, "utf-8");
  return { kind: "written", file, added: edited.added };
}

/**
 * What to add by hand, in the spelling the app's Next.js reads.
 *
 * On Next.js 14 the package list and the instrumentation opt-in are keys of
 * one `experimental` object, so they are given as one: two `experimental`
 * properties, pasted as given, leave only the second. The instrumentation
 * hook Nextly starts from needs the opt-in there, and no other step says so.
 * `wrap` turns each spelling into what to paste: the key itself, or a whole
 * config file when the app has none.
 */
function optionText(
  packages: string[],
  spelling: "legacy" | "either" | undefined,
  wrap: (option: string) => string = option => option
): string {
  const list = packages.map(name => JSON.stringify(name)).join(", ");
  const current = wrap(`  ${PROPERTY}: [${list}],`);
  const legacy = wrap(
    `  experimental: { instrumentationHook: true, serverComponentsExternalPackages: [${list}] },`
  );
  if (spelling === "legacy") return legacy;
  return spelling === "either"
    ? `On Next.js 15 or later:\n\n${current}\n\nOn Next.js 14:\n\n${legacy}`
    : current;
}

/**
 * A whole config holding `option`, for an app that has none. ESM in `.mjs`,
 * which loads whatever the package's own "type" says.
 */
function wholeConfig(option: string): string {
  return `/** @type {import('next').NextConfig} */\nexport default {\n${option}\n};\n`;
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
      files.skipped.push(
        patch.create
          ? {
              path: patch.file,
              why: `Nextly's packages were not added: ${patch.reason}, and the app has no Next.js config. Create ${patch.file} with:`,
              toAdd: optionText(patch.packages, patch.spelling, wholeConfig),
            }
          : {
              path: patch.file,
              why: `Nextly's packages were not added: ${patch.reason}. Add them to the config object it exports, keeping any packages and experimental keys already there`,
              toAdd: optionText(patch.packages, patch.spelling),
            }
      );
  }
  return files;
}
