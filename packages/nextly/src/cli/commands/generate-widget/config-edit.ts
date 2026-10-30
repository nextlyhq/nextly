/**
 * Registering a generated widget where its owner lists widgets: a site's
 * `admin.dashboard.widgets`, or a plugin's `contributes.dashboard.widgets`.
 *
 * 🔴 Only a shape it can edit without guessing. Each anchor it inserts at
 * (`widgets: [`, `dashboard: {`, `admin: {`, `contributes: {`,
 * `defineConfig({`) must occur exactly once in the file, or the edit could land
 * in the wrong object; a file it cannot read that plainly is left byte for
 * byte as it was, and the edit is printed for the author to make.
 *
 * @module cli/commands/generate-widget/config-edit
 */
import { dirname, relative } from "node:path";

/** An edit to one file: the whole text before it, and after it. */
export interface FileEdit {
  path: string;
  before: string;
  after: string;
}

export type RegistrationEdit =
  | { kind: "edit"; edits: FileEdit[]; summary: string }
  | { kind: "manual"; instructions: string };

const count = (text: string, anchor: RegExp): number =>
  (text.match(new RegExp(anchor.source, "g")) ?? []).length;

/** The indentation of the line `index` falls on. */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/** Inserts `entry` on its own line right after the one match of `anchor`. */
function insertAfter(text: string, anchor: RegExp, entry: string): string {
  const match = anchor.exec(text)!;
  const at = match.index + match[0].length;
  const indent = `${indentAt(text, match.index)}  `;
  return `${text.slice(0, at)}\n${indent}${entry}${text.slice(at)}`;
}

/**
 * The objects a widget is listed through, outermost first: each anchor, and
 * how that level is written when the file does not have it yet.
 */
type Ladder = { anchor: RegExp; wrap: (inner: string) => string }[];

/**
 * Where to insert and what: at the deepest level the file has (its anchor
 * found exactly once), the levels it lacks wrapped around the widget's name.
 * Nothing when an anchor it needs occurs more than once, or none does.
 */
function placement(
  text: string,
  ladder: Ladder,
  name: string
): { anchor: RegExp; entry: string } | undefined {
  let inner = name;
  // Deepest level first: the innermost object the file already has wins.
  for (const step of [...ladder].reverse()) {
    const found = count(text, step.anchor);
    if (found > 1) return undefined;
    if (found === 1) return { anchor: step.anchor, entry: `${inner},` };
    inner = step.wrap(inner);
  }
  return undefined;
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

const SITE_LADDER: Ladder = [
  { anchor: /defineConfig\(\s*\{/, wrap: inner => inner },
  { anchor: /\badmin:\s*\{/, wrap: inner => `admin: { ${inner} }` },
  { anchor: /\bdashboard:\s*\{/, wrap: inner => `dashboard: { ${inner} }` },
  { anchor: /\bwidgets:\s*\[/, wrap: inner => `widgets: [${inner}]` },
];

const PLUGIN_LADDER: Ladder = [
  { anchor: /\bcontributes:\s*\{/, wrap: inner => inner },
  { anchor: /\bdashboard:\s*\{/, wrap: inner => `dashboard: { ${inner} }` },
  { anchor: /\bwidgets:\s*\[/, wrap: inner => `widgets: [${inner}]` },
];

export interface RegistrationInput {
  /** The file widgets are listed in: the site config, or the plugin's entry. */
  file: string;
  text: string;
  kind: "site" | "plugin";
  /** The declaration's exported name, and its file. */
  exportName: string;
  declarationPath: string;
}

/** The edit that lists the widget, or what to do by hand when none is safe. */
export function registrationEdit(input: RegistrationInput): RegistrationEdit {
  const importLine = `import { ${input.exportName} } from "${specifierFrom(input.file, input.declarationPath)}";`;
  const where =
    input.kind === "site"
      ? "admin.dashboard.widgets"
      : "contributes.dashboard.widgets";
  const ladder = input.kind === "site" ? SITE_LADDER : PLUGIN_LADDER;
  const place = placement(input.text, ladder, input.exportName);
  if (!place) {
    return {
      kind: "manual",
      instructions: `In ${input.file}, add\n  ${importLine}\nand list ${input.exportName} in ${where}.`,
    };
  }
  const after = withImport(
    insertAfter(input.text, place.anchor, place.entry),
    importLine
  );
  return {
    kind: "edit",
    edits: [{ path: input.file, before: input.text, after }],
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
