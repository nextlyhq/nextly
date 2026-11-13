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

/** What the registry stores for a field group, as the writer reads it. */
export interface StoredFieldGroup {
  slug: string;
  label?: string | null;
  description?: string | null;
  admin?: Record<string, unknown> | null;
  localized?: boolean | null;
  fields?: readonly unknown[] | null;
}

/** What the registry stores for a Single, as the writer reads it. */
export interface StoredSingle extends StoredFieldGroup {
  status?: boolean | null;
  versions?: ResolvedVersionsConfig | boolean | null;
  revalidate?: boolean | null;
  webhooks?: boolean | null;
}

/** A field group as the definition file records it. */
export function fieldGroupEntity(stored: StoredFieldGroup): UiSchemaEntity {
  const label = stored.label ?? stored.slug;
  return {
    slug: stored.slug,
    labels: { singular: label, plural: label },
    // A setting stored as null is left unsaid, as the definition file writes it.
    ...(stored.description == null ? {} : { description: stored.description }),
    ...(stored.admin == null ? {} : { admin: stored.admin }),
    ...(stored.localized == null ? {} : { localized: stored.localized }),
    fields: (stored.fields ?? []) as UiSchemaEntity["fields"],
  };
}

/** A Single as the definition file records it. */
export function singleEntity(stored: StoredSingle): UiSchemaEntity {
  // The registry keeps history as a resolved config; the file keeps the
  // switch and the cap it was resolved from.
  const history =
    stored.versions == null ? {} : builderVersionsOf(stored.versions);
  return {
    ...fieldGroupEntity(stored),
    ...(stored.status == null ? {} : { status: stored.status }),
    ...history,
    ...(stored.revalidate == null ? {} : { revalidate: stored.revalidate }),
    ...(stored.webhooks == null ? {} : { webhooks: stored.webhooks }),
  };
}
