/**
 * A field group or a Single as the Builder's definition file records it,
 * built from what the registry stores for it: what the Builder save writer
 * (`writeCollectionSave`) reads and writes for one, as it does a collection's
 * entity. Every setting the definition carries is mapped, so a migration
 * replayed on a fresh database ends with the same settings: a field group's
 * description, admin options and translation; a Single's Draft/Published,
 * translation, history, revalidation and webhooks.
 *
 * @module domains/schema/builder-save/stored-entity
 */
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import { builderVersionsOf } from "../../versions/builder-versions";

/**
 * What the registry stores for a field group, as the writer reads it: a
 * registry row, or the create input that becomes one. Read loosely, since the
 * two spell some settings differently; each is checked as it is read.
 */
export interface StoredFieldGroup {
  slug: string;
  label?: unknown;
  description?: unknown;
  admin?: unknown;
  localized?: unknown;
  fields?: unknown;
}

/** What the registry stores for a Single, as the writer reads it. */
export interface StoredSingle extends StoredFieldGroup {
  status?: unknown;
  versions?: unknown;
  revalidate?: unknown;
  webhooks?: unknown;
}

/** A field group as the definition file records it. */
export function fieldGroupEntity(stored: StoredFieldGroup): UiSchemaEntity {
  const label = typeof stored.label === "string" ? stored.label : stored.slug;
  return {
    slug: stored.slug,
    labels: { singular: label, plural: label },
    // A setting stored as null is left unsaid, as the definition file writes it.
    ...(typeof stored.description === "string"
      ? { description: stored.description }
      : {}),
    ...(stored.admin !== null && typeof stored.admin === "object"
      ? { admin: stored.admin }
      : {}),
    ...(typeof stored.localized === "boolean"
      ? { localized: stored.localized }
      : {}),
    fields: (Array.isArray(stored.fields)
      ? stored.fields
      : []) as UiSchemaEntity["fields"],
  };
}

/** A Single as the definition file records it. */
export function singleEntity(stored: StoredSingle): UiSchemaEntity {
  return {
    ...fieldGroupEntity(stored),
    ...(typeof stored.status === "boolean" ? { status: stored.status } : {}),
    // The registry keeps history as a resolved config; the file keeps the
    // switch and the cap it was resolved from.
    ...(stored.versions == null
      ? {}
      : builderVersionsOf(stored.versions as ResolvedVersionsConfig | boolean)),
    // The registry keeps an opt-out as its config (`resolveBuilderRevalidate`,
    // `resolveBuilderWebhooks`); the file keeps the switch, said only when off.
    ...(builderSwitchOff(stored.revalidate, "disable", true)
      ? { revalidate: false }
      : {}),
    ...(builderSwitchOff(stored.webhooks, "record", false)
      ? { webhooks: false }
      : {}),
  };
}

/**
 * Whether a stored setting is the Builder's switch turned off: `false`, or
 * the config the switch resolves to when off (`{ disable: true }` for
 * revalidation, `{ record: false }` for webhooks). Null is the default, on.
 */
function builderSwitchOff(
  stored: unknown,
  key: "disable" | "record",
  offWhen: boolean
): boolean {
  if (stored === false) return true;
  return (
    stored !== null &&
    typeof stored === "object" &&
    (stored as Record<string, unknown>)[key] === offWhen
  );
}
