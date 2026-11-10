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
import type { UpdateCollectionInput } from "../../dynamic-collections/services/dynamic-collection-service";

/**
 * The settings an update may name, as the update's input spells them: taken
 * from `UpdateCollectionInput`, so the two cannot disagree on a setting.
 */
export type UpdateSettings = Pick<
  UpdateCollectionInput,
  | "label"
  | "labels"
  | "description"
  | "icon"
  | "group"
  | "useAsTitle"
  | "hidden"
  | "order"
  | "sidebarGroup"
  | "status"
  | "localized"
  | "versions"
  | "versionsMaxPerDoc"
  | "revalidate"
  | "webhooks"
  | "hooks"
>;

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

/**
 * The fills an update gives the rows already there for each Required field it
 * adds (`pushAnswers.fills`), as the writer takes them: the value its push
 * fills them with, which its file must fill them with too, before the column
 * becomes NOT NULL. A unique field takes no one value, and a field the push
 * gives no value (a relationship) has none to write: the push and the file
 * refuse those alike.
 */
export function updateFills(
  fills: ReadonlyArray<{ field: string; value: unknown; required: boolean }>,
  fields: readonly FieldDefinition[]
): Array<{ column: string; kind: "fill"; value: unknown }> {
  return fills
    .filter(
      fill =>
        fill.required &&
        fill.value !== null &&
        fill.value !== undefined &&
        fields.find(f => f.name === fill.field)?.unique !== true
    )
    .map(fill => ({
      column: fill.field,
      kind: "fill" as const,
      value: fill.value,
    }));
}
