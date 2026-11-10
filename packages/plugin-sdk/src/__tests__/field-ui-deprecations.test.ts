/**
 * Each old field-UI part `@nextlyhq/plugin-sdk/admin` exports is marked
 * deprecated in the PUBLISHED type declarations, naming the part that replaces
 * it and the release that may remove it.
 *
 * A `*.test-d.ts` cannot assert this: a deprecation is a JSDoc tag, which the
 * type checker reports in an editor but no type assertion can observe. So
 * this reads the declarations a plugin's editor reads: the admin's built
 * `.d.mts` files, found from the entry the SDK itself resolves, and the
 * SDK's own `admin` declarations for the re-export. It needs both packages
 * built, as the render contract beside it does.
 *
 * The parts keep working until then; `field-ui-compat.test-d.ts` and
 * `field-ui-compat.render.test.tsx` still pin their props and rendering.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REMOVAL = "Removed no earlier than 0.0.2-alpha.75";

const PANEL = "FieldSettingsPanel";
const PICKER = "FieldPicker";

/** Each old part, and the shared part its deprecation must name. */
const REPLACED_BY: Readonly<Record<string, string>> = {
  FieldTypePicker: PICKER,
  FieldTypePickerProps: PICKER,
  usePluginFieldTypeEntries: PICKER,
  FieldDefaultValueInput: PANEL,
  FieldDefaultValueInputProps: PANEL,
  FieldDefaultOption: PANEL,
  FieldOptionsEditor: PANEL,
  withOptionIds: PANEL,
  FieldOption: PANEL,
  FieldOptionsEditorProps: PANEL,
  ConditionRow: PANEL,
  operatorsForType: PANEL,
  operatorTakesValue: PANEL,
  ConditionOperatorName: PANEL,
  ConditionRange: PANEL,
  ConditionRowProps: PANEL,
  ConditionSource: PANEL,
  ConditionSourceOption: PANEL,
  ConditionValue: PANEL,
  ValidationNumberField: PANEL,
  ValidationNumberFieldProps: PANEL,
  ValidationRulesEditor: PANEL,
  drawsAnyValidationRule: PANEL,
  EDITABLE_VALIDATION_RULES: PANEL,
  ValidationRulesEditorProps: PANEL,
  ValidationRuleValues: PANEL,
};

/** Every declaration file under a built package's `dist`. */
function declarationsIn(distDir: string): string[] {
  return readdirSync(distDir, { recursive: true, encoding: "utf8" })
    .filter(file => /\.d\.m?ts$/.test(file))
    .map(file => readFileSync(join(distDir, file), "utf8"));
}

/** The `dist` directory holding a package entry the SDK resolves. */
function distOf(specifier: string): string {
  return dirname(fileURLToPath(import.meta.resolve(specifier)));
}

/** A name as a pattern, with the `$` a bundler adds to a renamed clash escaped. */
function literal(name: string): string {
  return name.replace(/[$]/g, "\\$");
}

/**
 * The local name a declaration file exports `name` under, the way the type
 * checker resolves it: an `export { local as name }` or `export { name }`
 * entry (with or without `type`), or an inline `export` on the declaration.
 * A bundler renames clashing declarations (`FieldOption$1`), so a name alone
 * can point at an unrelated type; the export list says which one is meant.
 */
function localNameOf(name: string, text: string): string | undefined {
  for (const list of text.matchAll(/^export \{([^}]*)\};?$/gm)) {
    for (const entry of list[1].split(",")) {
      const spec = entry.trim().replace(/^type\s+/, "");
      const parts = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(spec);
      if (parts && (parts[2] ?? parts[1]) === name) return parts[1];
    }
  }
  const inline = new RegExp(
    String.raw`^export (?:declare )?(?:function|const|interface|type) ${literal(name)}(?![\w$])`,
    "m"
  );
  return inline.test(text) ? name : undefined;
}

/**
 * The JSDoc directly above the declaration of `local` at the start of a line,
 * `""` when it has none, or `undefined` when the file does not declare it.
 */
function docOf(local: string, text: string): string | undefined {
  const declaration = new RegExp(
    String.raw`(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\n(?:export )?(?:declare )?(?:function|const|interface|type) ` +
      literal(local) +
      String.raw`(?![\w$])`
  );
  const found = declaration.exec(text);
  return found ? (found[1] ?? "") : undefined;
}

/** The JSDoc of the declaration each file exporting `name` resolves it to. */
function docsOf(name: string, files: readonly string[]): string[] {
  return files.flatMap(text => {
    const local = localNameOf(name, text);
    const doc = local === undefined ? undefined : docOf(local, text);
    return doc === undefined ? [] : [doc];
  });
}

const adminDeclarations = declarationsIn(distOf("@nextlyhq/admin"));
/**
 * The declaration file of the SDK's `admin` entry itself, beside the module
 * the entry resolves to. Read alone rather than with the rest of `dist`, so a
 * name still mentioned elsewhere (a type an export refers to) is not taken
 * for one the entry publishes.
 */
function entryDeclarationOf(specifier: string): string {
  const module = fileURLToPath(import.meta.resolve(specifier));
  for (const candidate of [
    module.replace(/\.m?js$/, ".d.ts"),
    module.replace(/\.m?js$/, ".d.mts"),
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Not this spelling; the next one is tried.
    }
  }
  throw new Error(`no declaration file beside ${module}`);
}

const sdkAdminEntry = entryDeclarationOf("@nextlyhq/plugin-sdk/admin");

describe("the old field-UI parts in the published declarations", () => {
  it.each(Object.entries(REPLACED_BY))(
    "%s is deprecated, naming %s and the release that may remove it",
    (name, replacement) => {
      // Still in the SDK's admin entry's own export list: deprecated, not
      // removed. A mention anywhere else in the SDK's declarations would not do.
      expect(
        localNameOf(name, sdkAdminEntry),
        `${name} is published`
      ).toBeDefined();

      const docs = docsOf(name, adminDeclarations);
      expect(docs.length, `${name} is declared`).toBeGreaterThan(0);
      for (const doc of docs) {
        expect(doc).toMatch(/@deprecated/);
        expect(doc).toContain(`\`${replacement}\``);
        expect(doc).toContain(REMOVAL);
      }
    }
  );

  // The control: the parts that replace them are declared and NOT deprecated,
  // so the check above cannot pass by matching every declaration it finds.
  it.each([PANEL, PICKER])("%s, a replacement, is not deprecated", name => {
    const docs = docsOf(name, adminDeclarations);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) expect(doc).not.toMatch(/@deprecated/);
  });
});
