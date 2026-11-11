/**
 * Registering an installed plugin in a site's config: the import of its
 * export, and an entry in the `plugins` list of the one `defineConfig({ ... })`
 * call the file makes.
 *
 * Read with the parser and the rules `generate:widget` lists a widget with,
 * so the file's own structure has to prove the place: one `defineConfig`
 * call, given an object literal that writes `plugins` once as a list literal
 * with no spread. A config without `plugins` gets one. Anything else, a name
 * the import would collide with, or a file that does not parse, leaves the
 * file byte for byte as it was, and the lines to add are returned for the
 * person to place.
 *
 * A plugin is listed once: a config with an entry that is a binding imported
 * from the package, as a value (`seo`) or a call (`seo({ ... })`), is left
 * as it is, whatever options it gives.
 *
 * @module cli/commands/plugins-add/config-registration
 */
import { isNode, declaredNames, nameOf } from "../generate-widget/bindings";
import {
  type ConfigParser,
  type ImportDeclaration,
  type Insertion,
  type MemberValue,
  type ObjectExpression,
  type Program,
  importInsertion,
  indentAt,
  inserted,
  member,
  readProgram,
  rootObject,
} from "../generate-widget/config-edit";

export interface PluginRegistrationInput {
  /** The config file, for messages. */
  file: string;
  text: string;
  /** What the file is read with. */
  parser: ConfigParser;
  /** The package the plugin is imported from. */
  packageName: string;
  /** The export the plugin is, `default` for a default export. */
  exportName: string;
  /** The name a new import binds it to; a named export's is its own name. */
  localName: string;
  /** The entry for `plugins`, given the name the plugin is bound to. */
  entry: (local: string) => string;
}

export type PluginRegistrationEdit =
  /** The file with the plugin registered. */
  | { kind: "edit"; after: string }
  /** The file already lists the plugin, bound as `local`. */
  | { kind: "listed"; local: string }
  /** Why the file was left as it was, and the lines to add by hand. */
  | { kind: "manual"; reason: string; lines: string[] };

type ArrayValue = Extract<MemberValue, { type: "ArrayExpression" }>;

/** The file's value imports from `packageName`, each binding by its local name. */
function packageImports(
  program: Program,
  packageName: string
): ImportDeclaration[] {
  return program.body.filter(
    (node): node is ImportDeclaration =>
      node.type === "ImportDeclaration" &&
      node.source.value === packageName &&
      node.importKind !== "type"
  );
}

/** The local names the file binds to `packageName`'s exports as values. */
function valueBindings(imports: readonly ImportDeclaration[]): Set<string> {
  const names = new Set<string>();
  for (const declaration of imports) {
    for (const binding of declaration.specifiers) {
      const typeOnly =
        binding.type === "ImportSpecifier" && binding.importKind === "type";
      if (!typeOnly) names.add(binding.local.name);
    }
  }
  return names;
}

/** The local name `exportName` is already imported under, as a value. */
function importedAs(
  imports: readonly ImportDeclaration[],
  exportName: string
): string | undefined {
  for (const declaration of imports) {
    for (const binding of declaration.specifiers) {
      if (exportName === "default") {
        if (binding.type === "ImportDefaultSpecifier") {
          return binding.local.name;
        }
        continue;
      }
      if (
        binding.type === "ImportSpecifier" &&
        binding.importKind !== "type" &&
        nameOf(binding.imported) === exportName
      ) {
        return binding.local.name;
      }
    }
  }
  return undefined;
}

/** Whether the file binds `name` in any way: a declaration or any import. */
function bindsName(program: Program, name: string): boolean {
  return program.body.some(node => {
    if (node.type === "ImportDeclaration") {
      return node.specifiers.some(binding => binding.local.name === name);
    }
    return declaredNames(node).includes(name);
  });
}

/** The binding an entry of the list is: `seo` for `seo` and for `seo(...)`. */
function entryBinding(element: ArrayValue["elements"][number]): string | null {
  if (element?.type === "Identifier") return element.name;
  if (
    element?.type === "CallExpression" &&
    isNode(element.callee) &&
    element.callee.type === "Identifier"
  ) {
    return element.callee.name;
  }
  return null;
}

/** Where the entry goes in a list literal: after its last element, or inside it when empty. */
function listInsertion(
  text: string,
  list: ArrayValue,
  entry: string
): Insertion | undefined {
  const last = list.elements.at(-1);
  if (last === undefined || last === null) {
    return typeof list.start === "number"
      ? { at: list.start + 1, text: entry }
      : undefined;
  }
  if (typeof last.start !== "number" || typeof last.end !== "number") {
    return undefined;
  }
  // A list written one entry per line keeps that shape: the new entry goes on
  // a line of its own at the last entry's indentation. A trailing comma after
  // the last entry is left where it is, so it then follows the new one.
  const multiline = text
    .slice(list.start ?? last.start, last.start)
    .includes("\n");
  return multiline
    ? { at: last.end, text: `,\n${indentAt(text, last.start)}${entry}` }
    : { at: last.end, text: `, ${entry}` };
}

/** A `plugins` list added as the first property of the root object. */
function newListInsertion(
  text: string,
  root: ObjectExpression,
  entry: string
): Insertion | undefined {
  if (typeof root.start !== "number") return undefined;
  const indent = `${indentAt(text, root.start)}  `;
  return { at: root.start + 1, text: `\n${indent}plugins: [${entry}],` };
}

/** The import line for the plugin, bound to `local`. */
function importLine(input: PluginRegistrationInput, local: string): string {
  const binding =
    input.exportName === "default"
      ? local
      : local === input.exportName
        ? `{ ${local} }`
        : `{ ${input.exportName} as ${local} }`;
  return `import ${binding} from "${input.packageName}";`;
}

/** The edit that registers the plugin, or why it was not made and what to add. */
export function pluginRegistrationEdit(
  input: PluginRegistrationInput
): PluginRegistrationEdit {
  const manual = (reason: string): PluginRegistrationEdit => ({
    kind: "manual",
    reason,
    lines: [
      importLine(input, input.localName),
      `plugins: [${input.entry(input.localName)}]`,
    ],
  });
  const program = readProgram(input.text, input.parser);
  if ("unread" in program) {
    return manual(`${input.file} could not be read (${program.unread})`);
  }
  const root = rootObject(program, "defineConfig");
  if (root === undefined) {
    return manual(
      `${input.file} does not make exactly one defineConfig({ ... }) call given an object`
    );
  }
  const list = member(root, "plugins");
  if (list === undefined) {
    return manual(
      `${input.file} could hold \`plugins\` where it cannot be read: in a spread, a computed key or more than once`
    );
  }
  if (
    list !== null &&
    (list.type !== "ArrayExpression" ||
      list.elements.some(element => element?.type === "SpreadElement"))
  ) {
    return manual(
      `${input.file} sets \`plugins\` to something other than a list written in place`
    );
  }

  const imports = packageImports(program, input.packageName);
  const bound = valueBindings(imports);
  const listed = (list?.elements ?? [])
    .map(entryBinding)
    .find((name): name is string => name !== null && bound.has(name));
  if (listed !== undefined) return { kind: "listed", local: listed };

  const existing = importedAs(imports, input.exportName);
  if (existing === undefined && bindsName(program, input.localName)) {
    return manual(
      `${input.file} already uses the name ${input.localName} for something else`
    );
  }
  const local = existing ?? input.localName;
  const entry = input.entry(local);
  const place =
    list === null
      ? newListInsertion(input.text, root, entry)
      : listInsertion(input.text, list, entry);
  if (place === undefined) {
    return manual(`${input.file} has no position to place the entry at`);
  }
  const lastImport = program.body
    .filter(node => node.type === "ImportDeclaration")
    .at(-1);
  const after = inserted(input.text, [
    place,
    ...(existing === undefined
      ? [importInsertion(lastImport?.end ?? 0, importLine(input, local))]
      : []),
  ]);
  return { kind: "edit", after };
}
