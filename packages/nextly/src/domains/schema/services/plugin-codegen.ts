/**
 * What the code generators emit for plugin-contributed field types.
 *
 * The generators know the built-in types by name. A plugin type reaching them
 * without this resolves to its storage primitive's default — `string` for the
 * TypeScript types, an unconstrained value for the Zod schemas — which is the
 * difference between a generated type an app can use and one it casts at every
 * call site. A type states its own rendering through `PluginFieldType.codegen`
 * and this module is where both generators read it.
 *
 * @module domains/schema/services/plugin-codegen
 */
import type {
  PluginFieldCodegenImport,
  PluginFieldInstance,
} from "../../../plugins/contributions";
import { getFieldType } from "../field-types/field-type-registry";

/** A field as the generators hold it: a type, maybe a name, maybe children. */
interface CodegenField {
  type?: unknown;
  fields?: unknown;
}

/**
 * The declared type's own rendering, when it has one.
 *
 * Returns nothing for built-ins and for unregistered types, so each caller
 * keeps its existing handling and only consults this where it would otherwise
 * fall back.
 */
function codegenFor(field: CodegenField) {
  if (typeof field.type !== "string") return undefined;
  return getFieldType(field.type)?.codegen;
}

/**
 * The TypeScript type a plugin field type declares, or nothing.
 *
 * The field is passed as declared so a type can narrow its output to the
 * options in front of it.
 */
export function pluginTsType(field: CodegenField): string | undefined {
  const emit = codegenFor(field)?.tsType;
  return emit?.(field as unknown as PluginFieldInstance);
}

/**
 * Whether a field's type is one a plugin contributed.
 *
 * `isDataField` tests membership of the built-in list, so a plugin type fails
 * it and the generators skip the field outright — the value is stored and
 * simply absent from the generated interface. The generators pair this with
 * that guard so a contributed type is emitted like any other stored value.
 */
export function isPluginDataField(field: CodegenField): boolean {
  return typeof field.type === "string" && !!getFieldType(field.type);
}

/** The Zod expression a plugin field type declares, or nothing. */
export function pluginZodSchema(field: CodegenField): string | undefined {
  const emit = codegenFor(field)?.zodSchema;
  return emit?.(field as unknown as PluginFieldInstance);
}

/** Every field in a tree, container children included. */
function* walkFields(fields: readonly unknown[]): Generator<CodegenField> {
  for (const entry of fields) {
    if (entry === null || typeof entry !== "object") continue;
    const field = entry as CodegenField;
    yield field;
    if (Array.isArray(field.fields)) yield* walkFields(field.fields);
  }
}

/**
 * The `import type` lines a generated file needs for the plugin types it uses.
 *
 * Collected from the fields actually emitted, so a registered type nobody
 * declares adds nothing. Names are merged per module and sorted, so the file is
 * byte-identical between runs — it is committed, and an unstable import block
 * would read as a change on every build.
 */
export function pluginCodegenImports(
  entities: ReadonlyArray<{ fields?: unknown }>
): string[] {
  const byModule = new Map<string, Set<string>>();

  const record = (imports: readonly PluginFieldCodegenImport[]): void => {
    for (const entry of imports) {
      const names = byModule.get(entry.from) ?? new Set<string>();
      for (const name of entry.names) names.add(name);
      byModule.set(entry.from, names);
    }
  };

  for (const entity of entities) {
    if (!Array.isArray(entity?.fields)) continue;
    for (const field of walkFields(entity.fields)) {
      const imports = codegenFor(field)?.imports;
      if (imports) record(imports);
    }
  }

  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([from, names]) =>
        `import type { ${[...names].sort().join(", ")} } from "${from}";`
    );
}
