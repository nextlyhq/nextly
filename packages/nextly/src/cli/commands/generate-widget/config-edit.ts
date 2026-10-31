/**
 * Registering a generated widget where its owner lists widgets: a site's
 * `admin.dashboard.widgets`, or a plugin's `contributes.dashboard.widgets`.
 *
 * 🔴 Only where the file's own structure proves the place. The file is parsed
 * (with @babel/parser, as create-nextly-app reads a config),
 * and the list is reached from the one `defineConfig({ ... })` (a plugin's
 * `definePlugin({ ... })`) call it makes, through object literals that each
 * write the key once. A level the file does not have yet is added. Anything
 * else (a second call, a level held in a variable, a spread or a computed key
 * that could carry the level, a file that does not parse) leaves the file byte
 * for byte as it was, and the edit is printed for the author to make. A widget
 * already in the list is left there, so generating it again lists it once.
 *
 * @module cli/commands/generate-widget/config-edit
 */
import { dirname, relative } from "node:path";

import type { parse } from "@babel/parser";

/** An edit to one file: the whole text before it, and after it. */
export interface FileEdit {
  path: string;
  before: string;
  after: string;
}

export type RegistrationEdit =
  | { kind: "edit"; edits: FileEdit[]; summary: string }
  | { kind: "manual"; instructions: string };

/** The indentation of the line `index` falls on. */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/** Inserts `entry` on its own line right after the character at `opening` (a `{` or `[`). */
function insertAfter(text: string, opening: number, entry: string): string {
  const at = opening + 1;
  const indent = `${indentAt(text, opening)}  `;
  return `${text.slice(0, at)}\n${indent}${entry}${text.slice(at)}`;
}

/** Where the widget goes: already listed, or inserted after the `{` or `[` at `opening`. */
type Placement = { listed: true } | { opening: number; entry: string };

/**
 * The parser a file is read with: @babel/parser's `parse`, which the caller
 * loads when it needs it, so nothing else that imports this module pays for it.
 */
export type ConfigParser = typeof parse;

type Statement = ReturnType<ConfigParser>["program"]["body"][number];
type Expression = Extract<
  Statement,
  { type: "ExpressionStatement" }
>["expression"];
type CallExpression = Extract<Expression, { type: "CallExpression" }>;
type ObjectExpression = Extract<Expression, { type: "ObjectExpression" }>;
type ObjectMember = ObjectExpression["properties"][number];
type KeyedMember = Exclude<ObjectMember, { type: "SpreadElement" }>;
/** What an object literal gives one of its keys. */
type MemberValue = Extract<ObjectMember, { type: "ObjectProperty" }>["value"];

/** The parser's options: a module, in TypeScript with JSX, as create-nextly-app reads one. */
const PARSE_OPTIONS: Parameters<ConfigParser>[1] = {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
  attachComment: false,
};

/** Whether `node` is a call to the function named `callee`. */
function isCallTo(node: unknown, callee: string): node is CallExpression {
  if (!isNode(node) || node.type !== "CallExpression") return false;
  const called = node.callee;
  return (
    isNode(called) && called.type === "Identifier" && called.name === callee
  );
}

const isNode = (
  value: unknown
): value is { type: string; [key: string]: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** Every call to `callee` in `node` and below it. */
function callsTo(
  node: unknown,
  callee: string,
  found: CallExpression[] = []
): CallExpression[] {
  if (Array.isArray(node)) {
    for (const child of node) callsTo(child, callee, found);
    return found;
  }
  if (!isNode(node)) return found;
  if (isCallTo(node, callee)) found.push(node);
  // `loc` is positions, not syntax: nothing below it is a call.
  for (const [key, child] of Object.entries(node)) {
    if (key !== "loc") callsTo(child, callee, found);
  }
  return found;
}

/**
 * The object literal the one call to `callee` is given, or why there is none
 * to edit: a file that does not parse, no call or more than one, or a call
 * given something other than an object literal.
 */
function rootObject(
  text: string,
  callee: string,
  parser: ConfigParser
): ObjectExpression | { unread: string } | undefined {
  let program: ReturnType<ConfigParser>["program"];
  try {
    program = parser(text, PARSE_OPTIONS).program;
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
  const calls = callsTo(program.body, callee);
  const [argument] = calls.length === 1 ? (calls[0]?.arguments ?? []) : [];
  return argument?.type === "ObjectExpression" ? argument : undefined;
}

/** A property's key as written, when it is a plain name or a string. */
function keyOf(property: KeyedMember): string | undefined {
  if (property.computed) return undefined;
  const { key } = property;
  if (key.type === "Identifier") return key.name;
  return key.type === "StringLiteral" ? key.value : undefined;
}

/**
 * The members of `object` written with `key`, methods among them, or nothing
 * when a spread or a computed key could carry it unseen.
 */
function membersKeyed(
  object: ObjectExpression,
  key: string
): KeyedMember[] | undefined {
  const opaque = object.properties.some(
    property => property.type === "SpreadElement" || property.computed
  );
  if (opaque) return undefined;
  return object.properties.filter(
    (property): property is KeyedMember =>
      property.type !== "SpreadElement" && keyOf(property) === key
  );
}

/**
 * The value `object` gives `key`: `null` when it provably gives none, and
 * `undefined` when that cannot be told (a spread or a computed key could carry
 * it, it is written twice, or as a method or a shorthand).
 */
function member(
  object: ObjectExpression,
  key: string
): MemberValue | null | undefined {
  const matches = membersKeyed(object, key);
  if (matches === undefined) return undefined;
  const [only, second] = matches;
  if (only === undefined) return null;
  const plain =
    second === undefined && only.type === "ObjectProperty" && !only.shorthand;
  return plain ? only.value : undefined;
}

/** `keys` written around the widget's name, for a level the file does not have: `dashboard: { widgets: [x] }`. */
function wrapped(keys: readonly string[], name: string): string {
  const [key, ...rest] = keys;
  return rest.length === 0
    ? `${key}: [${name}]`
    : `${key}: { ${wrapped(rest, name)} }`;
}

/** Where a widget goes after the `{` or `[` a node opens with, when the parser placed it. */
function opensAt(
  node: { start?: number | null },
  entry: string
): Placement | undefined {
  return typeof node.start === "number"
    ? { opening: node.start, entry }
    : undefined;
}

/** The place in a `widgets` array literal: listed already, or its start. */
function inList(list: MemberValue, name: string): Placement | undefined {
  if (list.type !== "ArrayExpression") return undefined;
  // A spread could already hold the widget, which nothing here can see.
  if (list.elements.some(element => element?.type === "SpreadElement")) {
    return undefined;
  }
  const listed = list.elements.some(
    element => element?.type === "Identifier" && element.name === name
  );
  return listed ? { listed: true } : opensAt(list, `${name},`);
}

/** The place down `keys` from `object`: in the list, or where the first missing level goes. */
function placement(
  object: ObjectExpression,
  keys: readonly string[],
  name: string
): Placement | undefined {
  const [key, ...rest] = keys;
  if (key === undefined) return undefined;
  const value = member(object, key);
  if (value === undefined) return undefined;
  if (value === null) return opensAt(object, `${wrapped(keys, name)},`);
  if (rest.length === 0) return inList(value, name);
  return value.type === "ObjectExpression"
    ? placement(value, rest, name)
    : undefined;
}

/** Adds `line` after the file's last import, or at its top. */
function withImport(text: string, line: string): string {
  if (text.includes(line)) return text;
  const imports = [...text.matchAll(/^import[^;]*;\s*$/gm)];
  const last = imports.at(-1);
  if (!last) return `${line}\n${text}`;
  const at = last.index + last[0].length;
  return `${text.slice(0, at)}\n${line}${text.slice(at)}`;
}

/** A relative module specifier from one file to another, without its extension. */
function specifierFrom(fromFile: string, toFile: string): string {
  const path = relative(dirname(fromFile), toFile)
    .split("\\")
    .join("/")
    .replace(/\.tsx?$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** The call each owner lists widgets through, and the keys down to the list. */
const OWNERS = {
  site: { callee: "defineConfig", keys: ["admin", "dashboard", "widgets"] },
  plugin: {
    callee: "definePlugin",
    keys: ["contributes", "dashboard", "widgets"],
  },
} as const;

export interface RegistrationInput {
  /** The file widgets are listed in: the site config, or the plugin's entry. */
  file: string;
  text: string;
  /** What the file is read with. */
  parser: ConfigParser;
  kind: "site" | "plugin";
  /** The declaration's exported name, and its file. */
  exportName: string;
  declarationPath: string;
}

/** The edit that lists the widget, or what to do by hand when none is safe. */
export function registrationEdit(input: RegistrationInput): RegistrationEdit {
  const importLine = `import { ${input.exportName} } from "${specifierFrom(input.file, input.declarationPath)}";`;
  const owner = OWNERS[input.kind];
  const where = owner.keys.join(".");
  const root = rootObject(input.text, owner.callee, input.parser);
  const place =
    root !== undefined && !("unread" in root)
      ? placement(root, owner.keys, input.exportName)
      : undefined;
  if (!place) {
    // Why it is left to the author: a file it could not read, or one whose
    // shape does not prove where the widget goes.
    const why =
      root !== undefined && "unread" in root
        ? `Could not read ${input.file} (${root.unread}), so it was left as it was. In it, add`
        : `In ${input.file}, add`;
    return {
      kind: "manual",
      instructions: `${why}\n  ${importLine}\nand list ${input.exportName} in ${where}.`,
    };
  }
  const listed =
    "listed" in place
      ? input.text
      : insertAfter(input.text, place.opening, place.entry);
  return {
    kind: "edit",
    edits: [
      {
        path: input.file,
        before: input.text,
        after: withImport(listed, importLine),
      },
    ],
    summary: `listed ${input.exportName} in ${where} in ${input.file}`,
  };
}

/** The line that exports a plugin's widget component from its admin entry. */
export function adminExportEdit(
  adminIndex: string,
  text: string,
  exportName: string,
  componentPath: string
): FileEdit {
  const line = `export { ${exportName} } from "${specifierFrom(adminIndex, componentPath)}";`;
  const after = text.includes(line)
    ? text
    : `${text.replace(/\n*$/, "\n")}${line}\n`;
  return { path: adminIndex, before: text, after };
}
