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

/**
 * The JSDoc written directly above each declaration of `name` in the given
 * declaration files: a function, a const, an interface or a type alias,
 * exported or declared. Empty when the name is declared nowhere.
 */
function docsOf(name: string, files: readonly string[]): string[] {
  const declaration = new RegExp(
    String.raw`(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*(?:export\s+)?(?:declare\s+)?(?:function|const|interface|type)\s+` +
      name +
      String.raw`\b`,
    "g"
  );
  return files.flatMap(text =>
    [...text.matchAll(declaration)].map(match => match[1] ?? "")
  );
}

const adminDeclarations = declarationsIn(distOf("@nextlyhq/admin"));
const sdkAdminDeclarations = declarationsIn(
  distOf("@nextlyhq/plugin-sdk/admin")
).join("\n");

describe("the old field-UI parts in the published declarations", () => {
  it.each(Object.entries(REPLACED_BY))(
    "%s is deprecated, naming %s and the release that may remove it",
    (name, replacement) => {
      // Still exported from the SDK's admin entry: deprecated, not removed.
      expect(sdkAdminDeclarations).toMatch(new RegExp(String.raw`\b${name}\b`));

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
