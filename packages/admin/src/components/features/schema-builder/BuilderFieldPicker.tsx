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
import { useCallback, useMemo, useState } from "react";

import {
  FieldPicker,
  type FieldGroupOption,
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
import {
  addUnsavedEntity,
  type UnsavedEntity,
  unsavedFieldGroupFrom,
  useUnsavedEntitiesOf,
} from "@admin/lib/builder/unsaved-entities";

import { pickerExcludedTypes, type BuilderConfig } from "./builder-config";
import type { BuilderSettingsValues } from "./BuilderSettingsModal";
import { FIELD_GROUP_BUILDER_CONFIG } from "./field-group-builder-config";
import { FIELD_TYPES_CATALOG } from "./field-picker-modal/field-types-catalog";
import { NewEntityDialog } from "./new-entity/NewEntityDialog";
import type { BuilderField } from "./types";

/** The Builder's types: the catalog rows a ui-schema can store, described once. */

/** The type that embeds a field group, as the catalog spells it. */
const FIELD_GROUP_TYPE = FIELD_TYPES_CATALOG.find(entry =>
  isFieldGroupFieldType(entry.type)
)?.type;

/**
 * Field groups as the picker lists them, each told apart by its kind and address, and one not
 * saved yet marked so: choosing it embeds a group the host's save creates first.
 */
function fieldGroupOptionsOf(
  groups: readonly { label: string; slug: string }[],
  state: "saved" | "unsaved"
): FieldGroupOption[] {
  return distinguishEntities(
    groups.map(group => ({
      kind: "field-group" as const,
      label: group.label,
      slug: group.slug,
    }))
  ).map(entity => ({
    slug: entity.slug,
    label: entity.label,
    text: state === "unsaved" ? `${entity.text} · not saved yet` : entity.text,
  }));
}

/**
 * "New field group": the new-entity dialog over the picker, its Create held in the store as an
 * unsaved field group `host` owns and handed back to the picker as chosen; null when the dialog
 * is closed. Each one opens a fresh dialog, never the values a cancelled one left.
 */
function useNewFieldGroupDialog(host: UnsavedEntity["ownedBy"]) {
  const [making, setMaking] = useState<
    ((made: FieldGroupOption | null) => void) | null
  >(null);
  const [operation, setOperation] = useState(0);
  const onNew = useCallback(
    () =>
      new Promise<FieldGroupOption | null>(resolve => {
        setOperation(count => count + 1);
        setMaking(() => resolve);
      }),
    []
  );
  const finish = (made: FieldGroupOption | null) => {
    making?.(made);
    setMaking(null);
  };
  const onCreate = (values: BuilderSettingsValues) => {
    const entity = unsavedFieldGroupFrom(values, host);
    // The dialog's check counts an unsaved entity's address as used, so this is reached only if
    // another unsaved field group took it meanwhile.
    if (!addUnsavedEntity(entity)) {
      toast.error(
        "A field group not saved yet already uses this address. Choose another."
      );
      return;
    }
    const [option] = fieldGroupOptionsOf(
      [{ label: entity.settings.singularName, slug: entity.address }],
      "unsaved"
    );
    finish(option);
  };
  return {
    onNew,
    dialog: {
      key: operation,
      open: making !== null,
      config: FIELD_GROUP_BUILDER_CONFIG,
      onCancel: () => finish(null),
      onCreate,
    },
  };
}

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

  // The entity this picker adds to, as a field group made here names its owner.
  const host = useMemo(
    () => (entitySlug ? { kind: config.kind, address: entitySlug } : undefined),
    [config.kind, entitySlug]
  );
  const unsavedFieldGroups = useUnsavedEntitiesOf("field-group");

  const fieldGroupOptions = useMemo(() => {
    // A field group embedding itself would never finish rendering.
    const notThisOne = (slug: string) =>
      !(config.kind === "field-group" && slug === entitySlug);
    const saved = (fieldGroupData?.items ?? []).filter(group =>
      notThisOne(group.slug)
    );
    // An unsaved field group is offered where this host's save would create it: one made from
    // its own picker, or one made from its own create page, which no host owns. One another
    // host's picker made is that host's to create or drop at its save.
    const unsaved = unsavedFieldGroups
      .filter(
        group =>
          notThisOne(group.address) &&
          (group.ownedBy === undefined ||
            (group.ownedBy.kind === host?.kind &&
              group.ownedBy.address === host.address))
      )
      .map(group => ({
        label: group.settings.singularName,
        slug: group.address,
      }));
    return [
      ...fieldGroupOptionsOf(saved, "saved"),
      ...fieldGroupOptionsOf(unsaved, "unsaved"),
    ];
  }, [fieldGroupData, unsavedFieldGroups, config.kind, entitySlug, host]);

  const newGroup = useNewFieldGroupDialog(host);

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
    <>
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
                onNew: newGroup.onNew,
              }
            : undefined,
        }}
        onCancel={onCancel}
        onAdd={add}
      />
      {/* Over the picker, which waits on the chooser until it is made or closed. */}
      <NewEntityDialog {...newGroup.dialog} />
    </>
  );
}
