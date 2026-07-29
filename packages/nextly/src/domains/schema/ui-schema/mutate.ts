/**
 * In-memory `ui-schema.json` mutations for the dev write API (spec §4.12.3).
 *
 * `mutateManifest` applies one upsert/delete by slug and re-validates the whole
 * manifest through the shared Zod schema (validation Layer 4) — throwing
 * NEXTLY_UI_SCHEMA_INVALID before the caller writes anything. Pure: no HTTP, no
 * filesystem. The HTTP handler (route-handler/dev-schema-handler.ts) loads the
 * current manifest, calls this, then serializes + writes the result.
 *
 * @module domains/schema/ui-schema/mutate
 * @since v0.0.3-alpha (Plan D3)
 */
import { NextlyError } from "../../../errors";
import {
  parseUiSchema,
  type UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { getFieldType } from "../field-types/field-type-registry";

export type ManifestKind = "collections" | "singles" | "components";

export type ManifestMutation =
  | { type: "upsert"; kind: ManifestKind; entity: unknown }
  | { type: "delete"; kind: ManifestKind; slug: string };

function slugOf(entity: unknown): string | undefined {
  const s = (entity as { slug?: unknown }).slug;
  return typeof s === "string" ? s : undefined;
}

/**
 * Apply a mutation to a validated manifest and re-validate the result.
 * Throws NEXTLY_UI_SCHEMA_INVALID (400) when the change would make the file
 * invalid — the caller then leaves the file untouched.
 */
export function mutateManifest(
  current: UiSchemaManifest,
  mutation: ManifestMutation
): UiSchemaManifest {
  const draft: Record<string, unknown> = {
    $schema: current.$schema,
    version: current.version,
    collections: [...current.collections],
    singles: [...current.singles],
    components: [...current.components],
  };

  const list = [...(draft[mutation.kind] as unknown[])];
  if (mutation.type === "upsert") {
    const slug = slugOf(mutation.entity);
    const idx =
      slug === undefined ? -1 : list.findIndex(e => slugOf(e) === slug);
    // Full-replace by slug is intentional: callers (the admin builder via
    // settings-to-manifest.ts) send a COMPLETE entity, so replacing lets a
    // user unset an optional flag (e.g. turn Draft/Published off). We do not
    // merge with the stored entity — a shallow merge would make unsetting
    // impossible (an omitted key would silently retain the old value).
    // Structurally-partial entities (missing slug/fields) are already
    // rejected by the Zod re-validation below (NEXTLY_UI_SCHEMA_INVALID).
    if (idx >= 0) list[idx] = mutation.entity;
    else list.push(mutation.entity);
  } else {
    const filtered = list.filter(e => slugOf(e) !== mutation.slug);
    list.length = 0;
    list.push(...filtered);
  }
  draft[mutation.kind] = list;

  const result = parseUiSchema(draft);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `ui-schema change rejected: ${issues}`,
    });
  }
  // The parse strips every key the manifest schema does not declare, and a
  // plugin field type's own options are exactly those. The database keeps them
  // (the field-payload writer persists what it was given), so returning the
  // parsed copy verbatim would commit a manifest describing a different field
  // from the one stored — and a deployment sourced from it would rebuild the
  // field without its options.
  return restorePluginFieldOptions(result.data, draft);
}

/** Whether a value is a `{}` literal, as opposed to an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Put back the option keys a registered plugin field type owns.
 *
 * Deliberately narrow: only fields whose `type` resolves to a plugin type get
 * their extra keys back. Stripping is load-bearing everywhere else — an
 * undeclared key on a built-in field is a typo or a stale option, and keeping
 * it would persist a field that reads as if it constrains something it does
 * not. A plugin type is the one case where core cannot know the vocabulary, so
 * it is the one case where the submitted keys are authoritative.
 */
function restorePluginFieldOptions(
  parsed: UiSchemaManifest,
  submitted: Record<string, unknown>
): UiSchemaManifest {
  const restoreFields = (
    parsedFields: readonly unknown[],
    submittedFields: unknown
  ): void => {
    if (!Array.isArray(submittedFields)) return;
    parsedFields.forEach((parsedField, index) => {
      const original = submittedFields[index];
      if (!isRecord(parsedField) || !isRecord(original)) return;
      // Positional pairing is safe: the parse preserves array order and never
      // drops elements — a field it could not accept fails the whole parse.
      if (
        typeof parsedField.type === "string" &&
        getFieldType(parsedField.type)
      ) {
        for (const [key, value] of Object.entries(original)) {
          if (!(key in parsedField)) parsedField[key] = value;
        }
      }
      if (Array.isArray(parsedField.fields)) {
        restoreFields(parsedField.fields, original.fields);
      }
    });
  };

  for (const kind of ["collections", "singles", "components"] as const) {
    const submittedEntities = submitted[kind];
    if (!Array.isArray(submittedEntities)) continue;
    parsed[kind].forEach((entity, index) => {
      const original = submittedEntities[index];
      if (isRecord(original)) restoreFields(entity.fields, original.fields);
    });
  }

  return parsed;
}
