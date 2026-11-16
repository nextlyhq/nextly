"use client";

/**
 * The shared field picker as the Schema Builder configures it.
 *
 * The Builder offers the catalog's ui-schema types, less what its config or
 * the place excludes, with plugin types declared for entries. A new field's
 * name is derived from its label and kept clear of its siblings' names, and a
 * field group is chosen from the existing ones by address. The add itself is
 * the host's: the field is placed with `insertField` at the position the
 * picker was opened for, and the page saves it with every other edit.
 */
import { MOST_USED_FIELD_TYPES } from "nextly/field-catalog";
import { isFieldGroupFieldType } from "nextly/field-group-type";
import type { JSX } from "react";
import { useMemo } from "react";

import {
  FieldPicker,
  type FieldPickerChoice,
} from "@admin/components/field-ui";
import { toast } from "@admin/components/ui";
import { useFieldGroups } from "@admin/hooks/queries";
import {
  findFieldById,
  generateFieldId,
  toSnakeName,
} from "@admin/lib/builder";
import { distinguishEntities } from "@admin/lib/builder/distinguishing-label";
import { nextDuplicateName } from "@admin/lib/builder/duplicate-field-name";
import {
  builderNameProblem,
  nameIsTakenAt,
  nameSurfaceOf,
  type BuilderNamePlace,
} from "@admin/lib/builder/field-name-check";
import {
  insertField,
  type FieldInsertPosition,
} from "@admin/lib/builder/insert-field";
import { namingLevelFor } from "@admin/lib/builder/move-rule";
import { BUILDER_FIELD_TYPES } from "@admin/lib/builder/offered-field-types";
import { fieldsWithDeleted } from "@admin/lib/builder/outline/pending-rows";

import { pickerExcludedTypes, type BuilderConfig } from "./builder-config";
import { FIELD_TYPES_CATALOG } from "./field-picker-modal/field-types-catalog";
import type { BuilderField } from "./types";

/** The Builder's types: the catalog rows a ui-schema can store, described once. */

/** The type that embeds a field group, as the catalog spells it. */
const FIELD_GROUP_TYPE = FIELD_TYPES_CATALOG.find(entry =>
  isFieldGroupFieldType(entry.type)
)?.type;

type Props = {
  config: BuilderConfig;
  fields: BuilderField[];
  position: FieldInsertPosition;
  /** The address of the entity being edited, so a field group never embeds itself. */
  entitySlug?: string;
  onCancel: () => void;
  onFieldsChange: (next: BuilderField[]) => void;
  /** Called after each add, with the new field's id. */
  onAdded: (fieldId: string, how: { addAnother: boolean }) => void;
  /**
   * The fields as last saved. A field deleted but not yet saved still holds its name until the
   * save, so a new field may not take it.
   */
  savedFields?: readonly BuilderField[];
  /** Whether Draft/Published is on, as stored or as the pending settings set it. */
  lifecycleEnabled?: boolean;
};

/**
 * Where a field added at `position` is named, by the save's own rules: the naming level it lands
 * on (a layout container is part of the level holding it), and the names already there, with every
 * pending delete put back where it was saved, since each still holds its name until the save.
 */
function namePlaceAt(
  fields: readonly BuilderField[],
  position: FieldInsertPosition,
  savedFields: readonly BuilderField[] | undefined,
  rules: Pick<BuilderNamePlace, "surface" | "lifecycleEnabled">
): BuilderNamePlace {
  const shown = savedFields ? fieldsWithDeleted(fields, savedFields) : fields;
  const { level, siblings } = namingLevelFor(shown, position.parentFieldId);
  return {
    ...rules,
    // Inside a named container the value is a key in that container's value.
    nested: level !== null,
    siblingNames: siblings.map(field => field.name),
  };
}

export function BuilderFieldPicker({
  config,
  fields,
  position,
  entitySlug,
  onCancel,
  onFieldsChange,
  onAdded,
  savedFields,
  lifecycleEnabled = false,
}: Props): JSX.Element {
  const { data: fieldGroupData, isLoading: fieldGroupsLoading } =
    useFieldGroups({
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "label", direction: "asc" }],
      filters: {},
    });

  const parent = position.parentFieldId
    ? findFieldById(fields, position.parentFieldId)
    : undefined;
  const place = namePlaceAt(fields, position, savedFields, {
    surface: nameSurfaceOf(config.kind),
    lifecycleEnabled,
  });

  const fieldGroupOptions = useMemo(
    () =>
      distinguishEntities(
        (fieldGroupData?.items ?? [])
          // A field group embedding itself would never finish rendering.
          .filter(
            group =>
              !(config.kind === "field-group" && group.slug === entitySlug)
          )
          .map(group => ({
            kind: "field-group" as const,
            label: group.label,
            slug: group.slug,
          }))
      ).map(entity => ({
        slug: entity.slug,
        label: entity.label,
        text: entity.text,
      })),
    [fieldGroupData, config.kind, entitySlug]
  );

  const add = (choice: FieldPickerChoice, how: { addAnother: boolean }) => {
    const field: BuilderField = {
      id: generateFieldId(),
      name: choice.name,
      label: choice.label,
      type: choice.type,
      validation: {},
      ...(choice.fieldGroup ? { component: choice.fieldGroup } : {}),
    };
    const next = insertField(fields, field, position);
    if (next === null) {
      toast.error(
        "The field was not added: the place it was meant for no longer exists."
      );
      onCancel();
      return;
    }
    onFieldsChange(next);
    onAdded(field.id, how);
  };

  return (
    <FieldPicker
      open
      title="Add a field"
      placement={parent ? `to ${parent.label || parent.name}` : undefined}
      config={{
        surface: "entries",
        // The Builder's own types, the list a template's are checked against.
        types: BUILDER_FIELD_TYPES,
        exclude: pickerExcludedTypes(config),
        mostUsed: MOST_USED_FIELD_TYPES,
        // A label with nothing the name rule keeps (a label in another
        // script, say) still gets a name, "field", which the editor can change.
        // A derived name that is taken, by a sibling or as a built-in or Draft/Published name, gets
        // the next free suffix; one the rules refuse for its spelling or length is shown as refused.
        deriveName: label =>
          nextDuplicateName(
            toSnakeName(label) || "field",
            place.siblingNames,
            name => nameIsTakenAt(name, { ...place, siblingNames: [] })
          ),
        nameProblem: name => builderNameProblem(name, place),
        fieldGroups: FIELD_GROUP_TYPE
          ? {
              type: FIELD_GROUP_TYPE,
              options: fieldGroupOptions,
              loading: fieldGroupsLoading,
            }
          : undefined,
      }}
      onCancel={onCancel}
      onAdd={add}
    />
  );
}
