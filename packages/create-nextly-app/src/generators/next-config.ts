import path from "path";

import { parse } from "@babel/parser";
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  ImportSpecifier,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  Statement,
  TSAsExpression,
  TSNonNullExpression,
  TSSatisfiesExpression,
  TSTypeAssertion,
  VariableDeclarator,
} from "@babel/types";
import fs from "fs-extra";

import type { DatabaseConfig } from "../types";

import type { GeneratedFiles } from "./generated-files";

/**
 * Where Nextly explains the Cache Components settings every app it makes or
 * joins carries, and why each one is there.
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
 * Nextly's cache handlers, as the settings that install them. Under Cache
 * Components, Next.js's default cache serves a page's previous shell once
 * after a write expires its tags; these expire it at once.
 */
const HANDLER_SETTINGS = [
  "cacheHandler",
  "cacheMaxMemorySize",
  "cacheHandlers",
] as const;
const HANDLER_PROPERTIES = [
  'cacheHandler: require.resolve("nextly/cache-handler")',
  "cacheMaxMemorySize: 0",
  'cacheHandlers: { default: require.resolve("nextly/cache-handlers") }',
];

/** The two options Nextly runs with on. */
const CACHE_COMPONENTS = "cacheComponents";
const PARTIAL_PREFETCHING = "partialPrefetching";
const ON_OPTIONS = [CACHE_COMPONENTS, PARTIAL_PREFETCHING] as const;

/** Every setting Nextly needs, as lines of a config object. */
const ON_LINES = [
  ...ON_OPTIONS.map(option => `${option}: true`),
  ...HANDLER_PROPERTIES,
].map(property => `  ${property},`);

/**
 * The settings every config this writes carries, with their reason in the
 * file: the developer who finds them is the one deciding whether to change
 * them.
 */
const CACHE_COMPONENTS_ON = `  // Nextly runs with Cache Components and Partial Prefetching on. Its cache
  // handlers make the first read after a write show the new version, where
  // Next.js's default cache would serve the previous page once more:
  // ${CACHE_COMPONENTS_DOCS_URL}
${ON_LINES.join("\n")}`;

/**
 * How an ES module config gets `require`, which Node defines only in
 * CommonJS, to resolve the handlers from the app's own node_modules.
 */
const REQUIRE_IMPORT = 'import { createRequire } from "node:module";';
/** The declaration, calling `createRequire` by the name the file has it under. */
const requireDeclaration = (createRequireName: string) =>
  `// Resolves Nextly's cache handlers from this app's node_modules.
const require = ${createRequireName}(import.meta.url);`;
const REQUIRE_DECLARATION = requireDeclaration("createRequire");

/**
 * Render a complete next.config.ts file for the selected database.
 */
export function buildNextConfigTemplate(database: DatabaseConfig): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
${CACHE_COMPONENTS_ON}
  serverExternalPackages: ${packageListLiteral(database)},
};

export default nextConfig;
`;
}

/** The same config as a JavaScript module, for an app without TypeScript. */
function buildNextConfigModule(database: DatabaseConfig): string {
  return `${REQUIRE_IMPORT}

${REQUIRE_DECLARATION}

/** @type {import("next").NextConfig} */
const nextConfig = {
${CACHE_COMPONENTS_ON}
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

/**
 * Why a config with the deprecated list is left alone. Named, so the advice
 * printed for it can say what to do with that list rather than the advice
 * for every other refusal, which says to keep the experimental keys there.
 */
const LEGACY_LIST_REASON = `it lists packages under experimental.${LEGACY_PROPERTY}, which Next.js copies over ${PROPERTY}, replacing the packages added there`;

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
  return appendProperties(source, object, (indent, ownLines) => [
    ownLines
      ? `${PROPERTY}: [\n${entries.map(entry => `${indent}  ${entry},\n`).join("")}${indent}]`
      : `${PROPERTY}: [${entries.join(", ")}]`,
  ]);
}

/**
 * Add properties after an object's last one, in the object's layout: on one
 * line, as `{ a: 1, b: 2 }`, when it is written that way, and otherwise one
 * per line at the indentation its properties use, before the closing brace,
 * with a comma put after the last property first when it has none.
 * `properties` gets that indentation, and whether each property has a line
 * of its own, so a property spanning lines can follow the same layout.
 */
function appendProperties(
  source: string,
  object: ObjectExpression,
  properties: (indent: string, ownLines: boolean) => string[]
): Edit[] {
  const open = (object.start ?? 0) + 1;
  const close = (object.end ?? 0) - 1;
  if (!spansLines(source, open, close)) {
    return [appendOnTheSameLine(object, properties("", false).join(", "))];
  }
  const last = object.properties.at(-1);
  const indent = last
    ? indentAt(source, last.start ?? 0)
    : `${indentAt(source, close)}  `;
  const lines = properties(indent, true)
    .map(property => `${indent}${property},\n`)
    .join("");
  const needsComma =
    last !== undefined && !/^\s*,/.test(source.slice(last.end ?? 0, close));
  const comma: Edit[] = needsComma
    ? [{ at: last.end ?? 0, remove: 0, text: "," }]
    : [];
  return [...comma, beforeClosingBrace(source, close, lines)];
}

/** Properties added to an object written on one line, as `{ a: 1, b: 2 }`. */
function appendOnTheSameLine(object: ObjectExpression, text: string): Edit {
  const last = object.properties.at(-1);
  const open = (object.start ?? 0) + 1;
  return last
    ? { at: last.end ?? 0, remove: 0, text: `, ${text}` }
    : { at: open, remove: (object.end ?? 0) - 1 - open, text: ` ${text} ` };
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
    return LEGACY_LIST_REASON;
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

/**
 * What Nextly's cache handlers came to in an existing app's config: `added`,
 * already `present`, or left out, with why, the lines to add by hand, and the
 * lines that define `require` for them when the file has none.
 */
type HandlerOutcome =
  | "added"
  | "present"
  | { skipped: string; lines: string[]; requireSetup: string | null };

/**
 * What turning Cache Components on in an existing app's config did.
 *
 * - `turned-on`: the options in `turnedOn` were set to `true`, added where
 *   the config did not set them, and `handlers` says whether Nextly's cache
 *   handlers went in beside them.
 * - `unchanged`: both options were on and the handlers settled already.
 * - `manual`: an option could not be read or changed safely, so the file was
 *   left as it was.
 */
export type CacheComponentsPatch =
  | {
      kind: "turned-on";
      file: string;
      turnedOn: string[];
      handlers: HandlerOutcome;
    }
  | { kind: "unchanged"; file: string; handlers: HandlerOutcome }
  | {
      kind: "manual";
      file: string;
      reason: string;
      requireSetup: string | null;
    };

/**
 * The exported config object, when every setting this edits can be read in
 * it; else why not. Not through a wrapper call: Next.js receives what the
 * wrapper returns, which may set an option again, so the literal passed in
 * says nothing final.
 */
function cacheComponentsObject(body: Statement[]): ObjectExpression | string {
  const object = exportedConfig(body, false);
  if (typeof object === "string") return object;
  return (
    hiddenSettings(object, [...ON_OPTIONS, ...HANDLER_SETTINGS], "it") ?? object
  );
}

/**
 * How to turn one option on: the `false` to flip, the property to add when the
 * config does not set it, nothing when it is on, or why the value cannot be
 * read.
 */
function optionStep(
  object: ObjectExpression,
  name: string
): { flip?: Edit; add?: string } | string {
  const value = propertyValue(object, name);
  if (!value) return { add: `${name}: true` };
  if (value.type !== "BooleanLiteral") {
    return `its ${name} is not true or false written in place`;
  }
  if (value.value) return {};
  return {
    flip: {
      at: value.start ?? 0,
      remove: (value.end ?? 0) - (value.start ?? 0),
      text: "true",
    },
  };
}

/**
 * Whether Node loads the config as an ES module, where `require` is not
 * defined: `.mjs` and `.mts` always, and `.js` when it imports or exports,
 * which a config in a package of `"type": "module"` must, and which Node
 * detects in any other. Next.js compiles `next.config.ts` to CommonJS.
 */
function loadsAsModule(file: string, body: Statement[]): boolean {
  if (/\.m[jt]s$/.test(file)) return true;
  return (
    file.endsWith(".js") &&
    body.some(
      statement =>
        statement.type === "ImportDeclaration" ||
        statement.type === "ExportDefaultDeclaration" ||
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration"
    )
  );
}

/**
 * The name an ES module config imports `createRequire` under from
 * `node:module`, whatever it renamed it to, or null when it imports none.
 */
function createRequireImport(body: Statement[]): string | null {
  const fromNodeModule = body.flatMap(statement =>
    statement.type === "ImportDeclaration" &&
    (statement.source.value === "node:module" ||
      statement.source.value === "module")
      ? statement.specifiers
      : []
  );
  const specifier = fromNodeModule.find(
    item =>
      item.type === "ImportSpecifier" && importedName(item) === "createRequire"
  );
  return specifier?.local.name ?? null;
}

/** The name an import specifier takes from its module, written plain or quoted. */
function importedName(specifier: ImportSpecifier): string {
  const { imported } = specifier;
  return imported.type === "Identifier" ? imported.name : imported.value;
}

/** Whether the file binds `require` at its top level, by a declaration or an import. */
function declaresRequire(body: Statement[]): boolean {
  return body.some(
    statement => importsRequire(statement) || declaresRequireVariable(statement)
  );
}

/** Whether `statement` imports a binding named `require`: hoisted, so bound anywhere. */
function importsRequire(statement: Statement): boolean {
  return (
    statement.type === "ImportDeclaration" &&
    statement.specifiers.some(specifier => isNamed(specifier.local, "require"))
  );
}

/** The declarators in `statement` that name a variable `require`, exported or not. */
function requireDeclarators(statement: Statement): VariableDeclarator[] {
  const declaration =
    statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
  return declaration?.type === "VariableDeclaration"
    ? declaration.declarations.filter(declarator =>
        isNamed(declarator.id, "require")
      )
    : [];
}

/** Whether `statement` declares a variable named `require`, exported or not. */
function declaresRequireVariable(statement: Statement): boolean {
  return requireDeclarators(statement).length > 0;
}

/**
 * Whether the file binds `require` only by a variable declared after `at`,
 * where the config object starts. The object's `require.resolve` runs when
 * the object is evaluated, while that declaration is still in its temporal dead
 * zone, so it would throw: the lines are printed rather than written.
 */
function declaresRequireAfter(body: Statement[], at: number): boolean {
  if (body.some(importsRequire)) return false;
  // By each declarator rather than its statement: in
  // `const nextConfig = {...}, require = createRequire(...)` the statement
  // starts before the object, but `require` is initialised after it.
  const declarators = body.flatMap(requireDeclarators);
  return (
    declarators.length > 0 &&
    declarators.every(declarator => (declarator.start ?? 0) >= at)
  );
}

/**
 * What an ES module config needs at its top for the handlers' `require`:
 * nothing when it binds `require` already, the declaration alone, calling its
 * own `createRequire` by its name, when it imports one, and otherwise the
 * import and the declaration.
 */
function requireSetupFor(body: Statement[]): string | null {
  if (declaresRequire(body)) return null;
  const imported = createRequireImport(body);
  return imported
    ? requireDeclaration(imported)
    : `${REQUIRE_IMPORT}\n\n${REQUIRE_DECLARATION}`;
}

/**
 * The edit that gives an ES module config `require`, before the first
 * statement that runs, and before the comments that lead it, such as a
 * `@type` annotation. Imports are hoisted, so one written further down still
 * loads first; the declaration is not, and a `require.resolve` evaluated
 * above it would throw.
 */
function requireEdit(source: string, body: Statement[], setup: string): Edit {
  const first = body.find(statement => statement.type !== "ImportDeclaration");
  const at = lineStart(
    source,
    first?.leadingComments?.[0]?.start ?? first?.start ?? 0
  );
  return { at, remove: 0, text: `${setup}\n\n` };
}

/** Whether `node` is `require.resolve("<specifier>")`. */
function resolvesTo(node: Node | undefined, specifier: string): boolean {
  if (node?.type !== "CallExpression") return false;
  const { callee, arguments: args } = node;
  const [only] = args;
  return (
    callee.type === "MemberExpression" &&
    isNamed(callee.object, "require") &&
    isNamed(callee.property, "resolve") &&
    args.length === 1 &&
    only?.type === "StringLiteral" &&
    only.value === specifier
  );
}

/** Whether the config's cache settings are Nextly's handlers, as this writes them. */
function hasNextlysHandlers(object: ObjectExpression): boolean {
  const handlers = propertyValue(object, "cacheHandlers");
  const memory = propertyValue(object, "cacheMaxMemorySize");
  return (
    resolvesTo(propertyValue(object, "cacheHandler"), "nextly/cache-handler") &&
    handlers?.type === "ObjectExpression" &&
    resolvesTo(propertyValue(handlers, "default"), "nextly/cache-handlers") &&
    memory?.type === "NumericLiteral" &&
    memory.value === 0
  );
}

/** The settings that make a cache of the app's own: a handler for either cache. */
const OWN_CACHE_SETTINGS = ["cacheHandler", "cacheHandlers"] as const;

/** Whether the config gives `name` a value: written, and not `undefined`. */
function setsValue(object: ObjectExpression, name: string): boolean {
  const value = propertyValue(object, name);
  return value !== undefined && !isNamed(value, "undefined");
}

/**
 * Why Nextly's handlers cannot go into this config as it stands, or null when
 * they can. A setting written as `undefined` is a placeholder to fill, not a
 * value; a handler of the app's own is not replaced; and `cacheMaxMemorySize`
 * must be 0, so Next.js keeps no second copy of the handlers' entries.
 */
function handlerConflict(object: ObjectExpression): string | null {
  const placeholders = HANDLER_SETTINGS.filter(
    name =>
      propertyValue(object, name) !== undefined && !setsValue(object, name)
  );
  if (placeholders.length > 0) {
    return `it sets ${placeholders.join(", ")} to undefined`;
  }
  const own = OWN_CACHE_SETTINGS.filter(name => setsValue(object, name));
  if (own.length > 0) {
    return `it has cache handlers of its own (${own.join(", ")}), which were kept`;
  }
  const memory = propertyValue(object, "cacheMaxMemorySize");
  return memory && !(memory.type === "NumericLiteral" && memory.value === 0)
    ? "it sets cacheMaxMemorySize to a value other than 0, which Nextly's handlers need so that Next.js keeps no second copy of their entries"
    : null;
}

/**
 * How to install Nextly's cache handlers: the properties to add and any edit
 * that gives the file `require`, or why they are left out, with the lines to
 * put in place of the config's own settings.
 */
function handlerStep(
  source: string,
  object: ObjectExpression,
  body: Statement[],
  esm: boolean
): { add: string[]; edits: Edit[]; outcome: HandlerOutcome } {
  const none = { add: [], edits: [] };
  if (hasNextlysHandlers(object)) return { ...none, outcome: "present" };
  const setup = esm ? requireSetupFor(body) : null;
  const conflict =
    esm && declaresRequireAfter(body, object.start ?? 0)
      ? "it declares require after its config object, so the handlers' require.resolve would run before require exists; move that declaration above the object"
      : handlerConflict(object);
  if (conflict) {
    return {
      ...none,
      outcome: {
        skipped: conflict,
        lines: HANDLER_PROPERTIES,
        requireSetup: setup,
      },
    };
  }
  const memorySet = propertyValue(object, "cacheMaxMemorySize") !== undefined;
  // A `cacheMaxMemorySize: 0` the app already has stays as it is.
  const add = HANDLER_PROPERTIES.filter(
    property => !(memorySet && property.startsWith("cacheMaxMemorySize"))
  );
  if (setup === null) return { add, edits: [], outcome: "added" };
  // A `require` used without being bound, or a `createRequire` of the file's
  // own that is not Node's, would clash with the lines that define them.
  const clashes =
    referenceCount("require", body) > 0 ||
    (createRequireImport(body) === null &&
      referenceCount("createRequire", body) > 0);
  if (clashes) {
    return {
      ...none,
      outcome: {
        skipped:
          "it is an ES module that uses require, or a createRequire not imported from node:module, without binding require, so the lines that define it could clash",
        lines: add,
        requireSetup: setup,
      },
    };
  }
  return {
    add,
    edits: [requireEdit(source, body, setup)],
    outcome: "added",
  };
}

/** The edits that turn Cache Components on in a config, or why it cannot be changed. */
function cacheComponentsPlan(
  source: string,
  file: string,
  esm: boolean
):
  | { edits: Edit[]; turnedOn: string[]; handlers: HandlerOutcome }
  | { reason: string } {
  const body = parseBody(source, file);
  if (!body) return { reason: "it could not be parsed" };
  const object = cacheComponentsObject(body);
  if (typeof object === "string") return { reason: object };
  const options = optionsPlan(object);
  if ("reason" in options) return options;
  const handlers = handlerStep(source, object, body, esm);
  const add = [...options.add, ...handlers.add];
  const edits = [...options.flips, ...handlers.edits];
  if (add.length > 0)
    edits.push(...appendProperties(source, object, () => add));
  return { edits, turnedOn: options.turnedOn, handlers: handlers.outcome };
}

/** How to turn both options on: the values to flip, the properties to add, and which options change. */
function optionsPlan(
  object: ObjectExpression
): { flips: Edit[]; add: string[]; turnedOn: string[] } | { reason: string } {
  const plan = {
    flips: [] as Edit[],
    add: [] as string[],
    turnedOn: [] as string[],
  };
  for (const option of ON_OPTIONS) {
    const step = optionStep(object, option);
    if (typeof step === "string") return { reason: step };
    if (step.flip) plan.flips.push(step.flip);
    if (step.add) plan.add.push(step.add);
    if (step.flip || step.add) plan.turnedOn.push(option);
  }
  return plan;
}

/**
 * Turn Next.js Cache Components and Partial Prefetching on in an existing
 * app's config, with Nextly's cache handlers: Nextly runs with both on.
 * Apps that an earlier Nextly release turned off are turned on again.
 *
 * Only settings written in place as `true` or `false`, or absent, are
 * changed; a value this cannot read leaves the file as it was, with what to
 * add. The edit is trusted only once the result parses and reads as on.
 */
export async function turnOnCacheComponents(
  cwd: string
): Promise<CacheComponentsPatch> {
  const file = await nextConfigFileToChange(cwd);
  const source = await fs
    .readFile(path.join(cwd, file), "utf-8")
    .catch(() => null);
  if (source === null) {
    return {
      kind: "manual",
      file,
      reason: "the app has no Next config",
      requireSetup: loadsAsModule(file, []) ? requireSetupFor([]) : null,
    };
  }
  const body = parseBody(source, file);
  if (!body) {
    return {
      kind: "manual",
      file,
      reason: "it could not be parsed",
      requireSetup: loadsAsModule(file, []) ? requireSetupFor([]) : null,
    };
  }
  const esm = loadsAsModule(file, body);
  const requireSetup = esm ? requireSetupFor(body) : null;
  // Read structurally even when the file never names the options: a spread or
  // a wrapper can still set them, and only the parser can say it cannot tell.
  const plan = cacheComponentsPlan(source, file, esm);
  if ("reason" in plan) {
    return { kind: "manual", file, reason: plan.reason, requireSetup };
  }
  if (plan.edits.length === 0) {
    return { kind: "unchanged", file, handlers: plan.handlers };
  }
  const text = applyEdits(source, plan.edits);
  const recheck = cacheComponentsPlan(text, file, esm);
  if ("reason" in recheck || recheck.edits.length > 0) {
    return {
      kind: "manual",
      file,
      reason: "the edit could not be confirmed",
      requireSetup,
    };
  }
  await fs.writeFile(path.join(cwd, file), text, "utf-8");
  return {
    kind: "turned-on",
    file,
    turnedOn: plan.turnedOn,
    handlers: plan.handlers,
  };
}

/**
 * What turning Cache Components on did, for the run's report: each change and
 * a notice saying why, or, for a config it could not change, the exact lines
 * to add.
 */
export function cacheComponentsFiles(
  patch: CacheComponentsPatch
): GeneratedFiles {
  const files: GeneratedFiles = { written: [], changed: [], skipped: [] };
  if (patch.kind === "manual") {
    files.skipped.push({
      path: patch.file,
      why: `Cache Components was not turned on: ${patch.reason}. Nextly runs with Cache Components and Partial Prefetching on, with its cache handlers (${CACHE_COMPONENTS_DOCS_URL}); add these to the config object Next.js receives, in place of any value of theirs`,
      toAdd: linesToAdd(ON_LINES, patch.requireSetup),
    });
    return files;
  }
  const handlersAdded = patch.handlers === "added";
  if (patch.kind === "turned-on") {
    files.changed.push({
      path: patch.file,
      added: [
        ...patch.turnedOn.map(option => `${option}: true`),
        ...(handlersAdded ? [...HANDLER_SETTINGS] : []),
      ],
    });
    const done = [
      ...(patch.turnedOn.length > 0
        ? [`turned ${patch.turnedOn.join(" and ")} on`]
        : []),
      ...(handlersAdded ? ["installed Nextly's cache handlers"] : []),
    ].join(" and ");
    files.notices = [
      `In ${patch.file}, ${done}: Nextly runs with Cache Components and Partial Prefetching on. ` +
        `What each setting does: ${CACHE_COMPONENTS_DOCS_URL}`,
    ];
  }
  if (typeof patch.handlers === "object") {
    files.skipped.push({
      path: patch.file,
      // A cache of the app's own receives no write made outside a request, so
      // the app is bounded as one without Nextly's handlers: say what that costs.
      why: `Nextly's cache handlers were not added: ${patch.handlers.skipped}. Without them a page read right after a write can show the previous version once, and in production every cached public read refreshes within a minute of a visit, since a write from another instance, the CLI or a job reaches no other cache (${CACHE_COMPONENTS_DOCS_URL}); to use them, put these in place of the config's own cache settings`,
      toAdd: linesToAdd(
        patch.handlers.lines.map(property => `  ${property},`),
        patch.handlers.requireSetup
      ),
    });
  }
  return files;
}

/**
 * The config lines to add by hand. An ES module config with no `require`
 * also gets the lines that define it for the handlers, at the top of the file.
 */
function linesToAdd(lines: string[], requireSetup: string | null): string {
  const config = lines.join("\n");
  return requireSetup
    ? `// At the top of the file:\n${requireSetup.replace("\n\n", "\n")}\n\n// In the config object:\n${config}`
    : config;
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
        why:
          patch.reason === LEGACY_LIST_REASON
            ? `Nextly's packages were not added: ${patch.reason}. Move the packages under experimental.${LEGACY_PROPERTY} into a top-level ${PROPERTY} list, add Nextly's to it, and delete experimental.${LEGACY_PROPERTY}, keeping the config's other experimental keys`
            : `Nextly's packages were not added: ${patch.reason}. Add them to the config object it exports, keeping any packages and experimental keys already there`,
        toAdd: optionText(patch.packages),
      });
  }
  return files;
}
