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

type Program = ReturnType<ConfigParser>["program"];
type ImportDeclaration = Extract<Statement, { type: "ImportDeclaration" }>;

/** The file's syntax tree, or why it could not be read. */
function readProgram(
  text: string,
  parser: ConfigParser
): Program | { unread: string } {
  try {
    return parser(text, PARSE_OPTIONS).program;
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The object literal the one call to `callee` is given, or nothing when there
 * is none to edit: no call or more than one, or a call given something other
 * than an object literal.
 */
function rootObject(
  program: Program,
  callee: string
): ObjectExpression | undefined {
  const calls = callsTo(program.body, callee);
  const [argument] = calls.length === 1 ? (calls[0]?.arguments ?? []) : [];
  return argument?.type === "ObjectExpression" ? argument : undefined;
}

/** A module specifier without its extension, so `./a.widget.js` and `./a.widget` are one module. */
const moduleOf = (specifier: string): string =>
  specifier.replace(/\.[cm]?[jt]sx?$/, "");

/** Whether `declaration` binds `name` as a value, not only as a type. */
function bindsValue(declaration: ImportDeclaration, name: string): boolean {
  if (declaration.importKind === "type") return false;
  return declaration.specifiers.some(
    specifier =>
      specifier.local.name === name &&
      !("importKind" in specifier && specifier.importKind === "type")
  );
}

/**
 * How the file already imports the widget's name, read from its syntax, so
 * quotes and formatting do not matter: from the declaration's module
 * (`same`), from another module or only as a type (`other`), or not at all
 * (`none`, with where a new import goes: after the last one, or at the top).
 */
function importOf(
  program: Program,
  name: string,
  specifier: string
):
  | { kind: "same" }
  | { kind: "other"; source: string }
  | { kind: "none"; after: number } {
  const imports = program.body.filter(
    (node): node is ImportDeclaration => node.type === "ImportDeclaration"
  );
  const binding = imports.find(declaration =>
    declaration.specifiers.some(each => each.local.name === name)
  );
  if (binding === undefined) {
    return { kind: "none", after: imports.at(-1)?.end ?? 0 };
  }
  const same =
    moduleOf(binding.source.value) === moduleOf(specifier) &&
    bindsValue(binding, name);
  return same
    ? { kind: "same" }
    : { kind: "other", source: binding.source.value };
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

/** Text to put into a file at one offset. */
interface Insertion {
  at: number;
  text: string;
}

/** Applies `insertions`, all at offsets into the original text, the last first. */
function inserted(text: string, insertions: readonly Insertion[]): string {
  return [...insertions]
    .sort((a, b) => b.at - a.at)
    .reduce(
      (current, { at, text: added }) =>
        `${current.slice(0, at)}${added}${current.slice(at)}`,
      text
    );
}

/** The widget's entry, on its own line right after the `{` or `[` it opens. */
function entryInsertion(
  text: string,
  place: { opening: number; entry: string }
): Insertion {
  const indent = `${indentAt(text, place.opening)}  `;
  return { at: place.opening + 1, text: `\n${indent}${place.entry}` };
}

/** The import, on its own line after the file's last import, or at its top. */
const importInsertion = (after: number, line: string): Insertion =>
  after > 0 ? { at: after, text: `\n${line}` } : { at: 0, text: `${line}\n` };

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

/** The manual answer: why, then the import and where to list the widget. */
const manual = (
  why: string,
  importLine: string,
  input: RegistrationInput
): RegistrationEdit => ({
  kind: "manual",
  instructions: `${why}\n  ${importLine}\nand list ${input.exportName} in ${OWNERS[input.kind].keys.join(".")}.`,
});

/** The edit that lists the widget, or what to do by hand when none is safe. */
export function registrationEdit(input: RegistrationInput): RegistrationEdit {
  const specifier = specifierFrom(input.file, input.declarationPath);
  const importLine = `import { ${input.exportName} } from "${specifier}";`;
  const owner = OWNERS[input.kind];
  const program = readProgram(input.text, input.parser);
  if ("unread" in program) {
    const why = `Could not read ${input.file} (${program.unread}), so it was left as it was. In it, add`;
    return manual(why, importLine, input);
  }
  const root = rootObject(program, owner.callee);
  const place = root && placement(root, owner.keys, input.exportName);
  const imported = importOf(program, input.exportName, specifier);
  if (imported.kind === "other") {
    const why = `In ${input.file}, ${input.exportName} is already imported from "${imported.source}", so it was left as it was. Import the widget under another name:`;
    return manual(why, importLine, input);
  }
  if (!place) return manual(`In ${input.file}, add`, importLine, input);
  const after = inserted(input.text, [
    ...("listed" in place ? [] : [entryInsertion(input.text, place)]),
    ...(imported.kind === "none"
      ? [importInsertion(imported.after, importLine)]
      : []),
  ]);
  return {
    kind: "edit",
    edits: [{ path: input.file, before: input.text, after }],
    summary: `listed ${input.exportName} in ${owner.keys.join(".")} in ${input.file}`,
  };
}

/** The line that exports a plugin's widget component from its admin entry. */
export function adminExportLine(
  adminIndex: string,
  exportName: string,
  componentPath: string
): string {
  return `export { ${exportName} } from "${specifierFrom(adminIndex, componentPath)}";`;
}

/** The edit adding that line to the admin entry, unless it is there already. */
export function adminExportEdit(
  adminIndex: string,
  text: string,
  exportName: string,
  componentPath: string
): FileEdit {
  const line = adminExportLine(adminIndex, exportName, componentPath);
  const after = text.includes(line)
    ? text
    : `${text.replace(/\n*$/, "\n")}${line}\n`;
  return { path: adminIndex, before: text, after };
}
