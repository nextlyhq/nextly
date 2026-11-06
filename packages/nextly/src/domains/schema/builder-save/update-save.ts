/**
 * A collection's update (`updateCollection`: the admin's settings save, a
 * plugin's or the API's update) as the definition records it after the save:
 * the collection as it stood, with each setting the update names and its
 * fields as they are now, spelled as a create's definition is
 * (`manifestEntityFor`).
 *
 * @module domains/schema/builder-save/update-save
 */
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";

/** The settings an update may name, as the update's input spells them. */
export interface UpdateSettings {
  label?: string;
  labels?: { singular: string; plural: string };
  description?: string;
  icon?: string;
  group?: string;
  useAsTitle?: string;
  hidden?: boolean;
  order?: number;
  sidebarGroup?: string;
  status?: boolean;
  localized?: boolean;
  versions?: unknown;
  versionsMaxPerDoc?: unknown;
  revalidate?: unknown;
  webhooks?: unknown;
  hooks?: unknown;
}

/** `previous` after the update: each named setting replaced, its fields as they are now. */
export function entityAfterUpdate(
  previous: UiSchemaEntity,
  update: UpdateSettings,
  fields: readonly FieldDefinition[]
): UiSchemaEntity {
  const admin: Record<string, unknown> = { ...previous.admin };
  for (const key of [
    "useAsTitle",
    "icon",
    "hidden",
    "order",
    "sidebarGroup",
  ] as const) {
    if (update[key] !== undefined) admin[key] = update[key];
  }
  if (update.group !== undefined) admin.group = update.group.toLowerCase();
  const named: Record<string, unknown> = {};
  for (const key of [
    "description",
    "status",
    "localized",
    "versions",
    "versionsMaxPerDoc",
    "revalidate",
    "webhooks",
    "hooks",
  ] as const) {
    if (update[key] !== undefined) named[key] = update[key];
  }
  const labels =
    update.labels ??
    (update.label === undefined
      ? previous.labels
      : { singular: update.label, plural: `${update.label}s` });
  return {
    ...previous,
    ...named,
    labels,
    admin,
    fields: [...fields],
  };
}
