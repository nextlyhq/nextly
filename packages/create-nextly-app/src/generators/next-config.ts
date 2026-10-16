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
      /** Next.js 14 spells the option `experimental.serverComponentsExternalPackages`. */
      legacyOption?: boolean;
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
 * The value `export default` or `module.exports =` hands Next.js, or why
 * there is none this can follow.
 */
function exportedValue(body: Statement[]): Expression | string {
  for (const statement of body) {
    const value = defaultExportOf(statement) ?? moduleExportsOf(statement);
    if (value) return value;
  }
  return "it has no default export";
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
  depth = 0
): ObjectExpression | string {
  if (depth > 8) return "its config is built in a way this cannot follow";
  if (value.type === "ObjectExpression") return value;
  if (isTypeAssertion(value))
    return configObject(value.expression, body, depth + 1);
  if (value.type === "Identifier")
    return followVariable(value.name, body, depth);
  if (value.type === "CallExpression") return followCall(value, body, depth);
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
 * The config a variable holds, when the file declares it and never replaces
 * or changes it afterwards: the declared object is then the one Next.js gets.
 */
function followVariable(
  name: string,
  body: Statement[],
  depth: number
): ObjectExpression | string {
  if (isReassigned(name, body)) {
    return `its ${name} is assigned or changed after it is declared`;
  }
  const declared = declaredValue(name, body);
  return declared
    ? configObject(declared, body, depth + 1)
    : "its config is not declared in this file";
}

/**
 * The config a wrapper call is handed. With one argument, as in
 * `withMDX(nextConfig)`, that argument is the config. With several, the first
 * is followed only when it alone is a named value, as in
 * `withSentryConfig(nextConfig, { org })`; otherwise which argument Next.js
 * receives as its config cannot be told, so it answers why.
 */
function followCall(
  call: CallExpression,
  body: Statement[],
  depth: number
): ObjectExpression | string {
  const [first, ...rest] = call.arguments;
  const unclear =
    "it exports the result of a call whose config argument cannot be told";
  if (
    !first ||
    first.type === "SpreadElement" ||
    first.type === "ArgumentPlaceholder"
  ) {
    return unclear;
  }
  if (rest.length === 0) return configObject(first, body, depth + 1);
  const firstIsTheNamedOne =
    first.type === "Identifier" &&
    rest.every(argument => argument.type !== "Identifier");
  return firstIsTheNamedOne ? configObject(first, body, depth + 1) : unclear;
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

/** Every node under a node, depth first. */
function* nodesUnder(node: unknown): Generator<Node> {
  if (Array.isArray(node)) return yield* nodesIn(node);
  if (!isNode(node)) return;
  yield node;
  yield* nodesIn(
    Object.entries(node)
      .filter(([key]) => !NOT_CODE.has(key))
      .map(([, value]) => value)
  );
}

function* nodesIn(values: unknown[]): Generator<Node> {
  for (const value of values) yield* nodesUnder(value);
}

/** What an assignment or an increment writes to, or null for any other node. */
function writtenTarget(node: Node): Node | null {
  if (node.type === "AssignmentExpression") return node.left;
  if (node.type === "UpdateExpression") return node.argument;
  return null;
}

/** Whether writing to `target` changes the variable `name` or one of its properties. */
const writesTo = (target: Node, name: string) =>
  isNamed(target, name) ||
  (target.type === "MemberExpression" && isNamed(target.object, name));

const isMethodCall = (callee: Node, object: string, method: string) =>
  callee.type === "MemberExpression" &&
  isNamed(callee.object, object) &&
  isNamed(callee.property, method);

/** Whether a node is `Object.assign(name, ...)`. */
function isObjectAssignTo(node: Node, name: string): boolean {
  if (node.type !== "CallExpression") return false;
  const [first] = node.arguments;
  return (
    isMethodCall(node.callee, "Object", "assign") &&
    first !== undefined &&
    isNamed(first, name)
  );
}

/**
 * Whether the file assigns to the variable after declaring it, assigns to one
 * of its properties, or hands it to `Object.assign`: any of those can replace
 * the object, or its list, after the point this would edit.
 */
function isReassigned(name: string, body: Statement[]): boolean {
  for (const node of nodesUnder(body)) {
    const target = writtenTarget(node);
    if ((target && writesTo(target, name)) || isObjectAssignTo(node, name))
      return true;
  }
  return false;
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
 * Whether a property might define the list in a way this cannot read: a
 * computed key built at run time, or a getter or method of that name.
 */
function mightBeTheList(property: Node): boolean {
  if (property.type === "ObjectMethod") {
    const name = keyName(property);
    return name === null || name === PROPERTY;
  }
  return property.type === "ObjectProperty" && keyName(property) === null;
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
 * edited: a spread after it may hold or replace it, and a list that is not an
 * array literal cannot be read here.
 */
function existingList(
  object: ObjectExpression
): ArrayExpression | null | string {
  const { properties } = object;
  if (properties.some(mightBeTheList)) {
    return `it has a computed or accessor property that may define ${PROPERTY}`;
  }
  const listIndex = lastIndexOf(properties, isListProperty);
  const spreadIndex = lastIndexOf(
    properties,
    property => property.type === "SpreadElement"
  );
  if (spreadIndex > listIndex)
    return "it spreads another object, which may hold or replace the list";
  const property = properties[listIndex];
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

/** Why the config's other settings make an edit unsafe, or null when none does. */
function conflictOf(
  object: ObjectExpression,
  required: string[]
): string | null {
  const experimental = experimentalOf(object);
  if (typeof experimental === "string") return experimental;
  if (
    experimental &&
    propertyValue(experimental, "serverComponentsExternalPackages")
  ) {
    return `it lists packages under experimental.serverComponentsExternalPackages, which Next.js moves to ${PROPERTY}; keep a single list there`;
  }
  return (
    clashReason("transpilePackages", object, "transpilePackages", required) ??
    (experimental
      ? clashReason(
          "experimental.optimizePackageImports",
          experimental,
          "optimizePackageImports",
          required
        )
      : null)
  );
}

/** The object literal the file exports as its config, or why there is none to edit. */
function exportedConfig(body: Statement[]): ObjectExpression | string {
  const exported = exportedValue(body);
  return typeof exported === "string" ? exported : configObject(exported, body);
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
 * The major version of the Next.js the app has installed, read from its own
 * `node_modules`, or null when it cannot be read: the range in package.json
 * can admit several majors, and only the installed one decides the option.
 */
async function installedNextMajor(cwd: string): Promise<number | null> {
  try {
    const manifest: unknown = await fs.readJson(
      path.join(cwd, "node_modules", "next", "package.json")
    );
    const version =
      typeof manifest === "object" && manifest !== null && "version" in manifest
        ? manifest.version
        : null;
    const major =
      typeof version === "string" ? Number.parseInt(version, 10) : Number.NaN;
    return Number.isInteger(major) ? major : null;
  } catch {
    return null;
  }
}

/** The app's Next config file, by the name Next.js would read first. */
async function findConfigFile(cwd: string): Promise<string | null> {
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
  // Next.js 14 reads the list under another name. Writing the top-level one
  // there would report success and externalise nothing, so a 14 app is told
  // the exact option to add rather than given a config that does nothing.
  const major = await installedNextMajor(cwd);
  if (major !== null && major < FIRST_TOP_LEVEL_MAJOR) {
    return {
      kind: "manual",
      file: file ?? "next.config.js",
      reason: `the app runs Next.js ${major}, which reads the list as experimental.serverComponentsExternalPackages`,
      packages: required,
      legacyOption: true,
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

/** The line the CLI prints for a patch: what changed, or exactly what to add and where. */
export function nextConfigReport(patch: NextConfigPatch): {
  level: "info" | "warn";
  message: string;
} {
  switch (patch.kind) {
    case "written":
      return {
        level: "info",
        message: `${patch.file}: added ${patch.added.join(", ")} to ${PROPERTY}`,
      };
    case "created":
      return {
        level: "info",
        message: `${patch.file}: created, with ${PROPERTY} listing ${patch.added.join(", ")}`,
      };
    case "unchanged":
      return {
        level: "info",
        message: `${patch.file} already lists every package Nextly needs in ${PROPERTY}`,
      };
    case "manual": {
      const list = patch.packages.map(name => JSON.stringify(name)).join(", ");
      const option = patch.legacyOption
        ? `experimental: { serverComponentsExternalPackages: [${list}] },`
        : `${PROPERTY}: [${list}],`;
      return {
        level: "warn",
        message: `Nextly's packages were not added to ${patch.file}: ${patch.reason}. Add them to the config object it exports, keeping any packages already listed:\n\n  ${option}`,
      };
    }
  }
}
