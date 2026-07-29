/**
 * Keep a plugin field type's own options across a manifest parse.
 *
 * `uiSchemaFieldSchema` strips every key it does not declare, and a plugin
 * type's options are exactly those. The database keeps them — the field-payload
 * writer persists what it was given — so a parse that dropped them would leave
 * the committed manifest describing a different field from the one stored, and
 * a deployment sourced from it would rebuild the field without its options.
 *
 * Applied on BOTH sides of the round trip: reading `ui-schema.json` and writing
 * it. Restoring only on write would still lose the options of every entity the
 * current request did not touch, because the loaded manifest they came from was
 * already stripped.
 *
 * @module domains/schema/ui-schema/preserve-plugin-options
 */
import type { UiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { getFieldType } from "../field-types/field-type-registry";

/**
 * Copy back every key the parse dropped, at any depth.
 *
 * Shallow would not be enough: a plugin option that reuses a core key survives
 * as a key while losing its own members. `admin: { width, toolbar }` parses with
 * `admin` retained and `toolbar` stripped, so a top-level presence check finds
 * `admin` there and restores nothing.
 *
 * Only fills gaps — a value the parse kept is the validated one and wins.
 */
function mergeMissing(
  parsed: Record<string, unknown>,
  original: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(original)) {
    if (!(key in parsed)) {
      parsed[key] = value;
      continue;
    }
    const kept = parsed[key];
    if (isRecord(kept) && isRecord(value)) mergeMissing(kept, value);
  }
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
export function restorePluginFieldOptions(
  parsed: UiSchemaManifest,
  submitted: unknown
): UiSchemaManifest {
  if (!isRecord(submitted)) return parsed;
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
        mergeMissing(parsedField, original);
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
