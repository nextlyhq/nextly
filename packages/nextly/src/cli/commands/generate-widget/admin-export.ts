/**
 * Exporting a plugin's widget component from its admin entry, where the
 * dashboard loads it from by name.
 *
 * The entry is parsed, as the widget list's file is, so an export already
 * there is found however it is formatted: the card's own export from its
 * module is kept as it is, and the name exported by anything else (another
 * module, or the entry itself) leaves the entry byte for byte as it was, with
 * the line printed for the author. Two exports of one name do not compile.
 *
 * @module cli/commands/generate-widget/admin-export
 */
import { declaredNames, nameOf } from "./bindings";
import {
  moduleOf,
  readProgram,
  specifierFrom,
  type ConfigParser,
  type FileEdit,
  type Program,
} from "./config-edit";

type ExportNamedDeclaration = Extract<
  Program["body"][number],
  { type: "ExportNamedDeclaration" }
>;
type ExportBinding = ExportNamedDeclaration["specifiers"][number];

/** The line that exports a plugin's widget component from its admin entry. */
export function adminExportLine(
  adminIndex: string,
  exportName: string,
  componentPath: string
): string {
  return `export { ${exportName} } from "${specifierFrom(adminIndex, componentPath)}";`;
}

/** What one export statement does with the card's name: nothing, the card's own export, or takes it for something else. */
type ExportUse = "none" | "card" | { takenBy: string };

/** Whether a specifier re-exports the card itself: by its name, as a value, from its module. */
function isCardExport(
  statement: ExportNamedDeclaration,
  binding: ExportBinding,
  name: string,
  cardModule: string
): boolean {
  if (statement.exportKind === "type" || binding.type !== "ExportSpecifier") {
    return false;
  }
  return (
    binding.exportKind !== "type" &&
    nameOf(binding.local) === name &&
    statement.source !== null &&
    statement.source !== undefined &&
    moduleOf(statement.source.value) === cardModule
  );
}

/** What `statement` does with the name `name`. */
function exportUse(
  statement: ExportNamedDeclaration,
  name: string,
  cardModule: string
): ExportUse {
  if (declaredNames(statement.declaration).includes(name)) {
    return { takenBy: "by a declaration of its own" };
  }
  const binding = statement.specifiers.find(
    each => nameOf(each.exported) === name
  );
  if (binding === undefined) return "none";
  if (isCardExport(statement, binding, name, cardModule)) return "card";
  const source = statement.source?.value;
  return {
    takenBy: source === undefined ? "by the file itself" : `from "${source}"`,
  };
}

/** How the entry already exports the card's name, read from its syntax. */
function exportOf(
  program: Program,
  name: string,
  cardModule: string
): ExportUse {
  let found: ExportUse = "none";
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const use = exportUse(statement, name, cardModule);
    if (typeof use === "object") return use;
    if (use === "card") found = use;
  }
  return found;
}

export interface AdminExportInput {
  /** The admin entry, and its text. */
  file: string;
  text: string;
  /** What the entry is read with. */
  parser: ConfigParser;
  /** The card's exported name, and its file. */
  exportName: string;
  componentPath: string;
}

export type AdminExportEdit =
  | { kind: "edit"; edit: FileEdit }
  | { kind: "manual"; instructions: string };

/**
 * The edit adding the card's export to the admin entry (none when it is there
 * already), or what to do by hand when the entry cannot take it safely.
 */
export function adminExportEdit(input: AdminExportInput): AdminExportEdit {
  const { file, text, exportName } = input;
  const line = adminExportLine(file, exportName, input.componentPath);
  const program = readProgram(text, input.parser);
  if ("unread" in program) {
    return {
      kind: "manual",
      instructions: `Could not read ${file} (${program.unread}), so it was left as it was. In it, add\n  ${line}`,
    };
  }
  const cardModule = moduleOf(specifierFrom(file, input.componentPath));
  const use = exportOf(program, exportName, cardModule);
  if (typeof use === "object") {
    return {
      kind: "manual",
      instructions: `In ${file}, ${exportName} is already exported ${use.takenBy}, so it was left as it was. The dashboard loads the card by that name: free it, then add\n  ${line}`,
    };
  }
  const after =
    use === "card" ? text : `${text.replace(/\n*$/, "\n")}${line}\n`;
  return { kind: "edit", edit: { path: file, before: text, after } };
}
