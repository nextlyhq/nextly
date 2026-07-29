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
import type { BlockFieldCatalogType } from "../../../collections/fields/catalog";
import { STORAGE_PRIMITIVE_AS_FIELD_TYPE } from "../../../collections/fields/catalog";
import type {
  PluginFieldCodegenImport,
  PluginFieldInstance,
} from "../../../plugins/contributions";
import { detachedField } from "../../../shared/lib/detached-field";
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
 * The field as its own type sees it: options folded into one flat view.
 *
 * The Schema Builder writes unmodelled options into `pluginOptions`, so a
 * callback reading `field.ratingScale` would find it on a code-first field and
 * lose it the moment an ordinary save moved it into the container. The same
 * view `validate` and `validateOptions` are given, built by the same helper, so
 * generated output cannot depend on where an option happened to be stored.
 */
function optionView(field: CodegenField): PluginFieldInstance {
  return detachedField(field as unknown as { name?: string; type: string });
}

/**
 * The TypeScript type a plugin field type declares, or nothing.
 *
 * The field is passed as declared so a type can narrow its output to the
 * options in front of it.
 */
export function pluginTsType(field: CodegenField): string | undefined {
  const emit = codegenFor(field)?.tsType;
  return emit?.(optionView(field));
}

/**
 * The built-in field type a plugin type stores as, for a type that contributes
 * no rendering of its own.
 *
 * Generating such a field as `unknown`, or omitting it, would lose what the
 * registry already knows: a `number`-backed type stores a number whether or not
 * its author wrote a `tsType`. Substituting the storage primitive's built-in
 * type lets both generators reuse the branch they already have for it, which is
 * the same substitution the write path makes when it applies the primitive's
 * rules to a custom type.
 */
export function pluginStorageFieldType(
  field: CodegenField
): BlockFieldCatalogType | undefined {
  if (typeof field.type !== "string") return undefined;
  const registered = getFieldType(field.type);
  if (!registered) return undefined;
  return STORAGE_PRIMITIVE_AS_FIELD_TYPE[registered.storage];
}

/**
 * The same field, retyped as the built-in its plugin type stores as.
 *
 * The generators dispatch on `type`, so re-entering with it substituted makes
 * them emit the primitive's shape while every other option on the field stays
 * visible. Spread through a record because a field config is a union of
 * per-type shapes and TypeScript will not spread one directly.
 */
export function asStorageEquivalentField<T extends CodegenField>(
  field: T,
  storageType: BlockFieldCatalogType
): T {
  return { ...(field as Record<string, unknown>), type: storageType } as T;
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
  return emit?.(optionView(field));
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
