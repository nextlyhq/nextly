"use client";

/**
 * The overlays a builder page mounts over its field list: the settings modal,
 * the field-type picker, and the field editor sheet in its create and edit
 * modes.
 *
 * One overlay is open at a time, so the page holds a single `ActiveOverlay`
 * value rather than four booleans that could disagree.
 */
import { findFieldById, findParentContainerId } from "@admin/lib/builder";
import { isInsideRepeatingAncestor } from "@admin/lib/builder/is-inside-repeating-ancestor";

import type { BuilderConfig } from "./builder-config";
import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "./BuilderSettingsModal";
import { FieldEditorSheet } from "./FieldEditorSheet";
import { FieldPickerModal } from "./FieldPickerModal";
import type { BuilderField, BuilderFieldsApi } from "./types";

/**
 * Which overlay is open, and the state that overlay needs.
 *
 * `create` carries a draft rather than appending a placeholder field: a
 * cancelled create then leaves nothing behind. `picker` and `create` both
 * carry an optional `parentFieldId` so the same overlay serves an add at the
 * top level and an add inside a group or repeater, at any depth.
 */
export type ActiveOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "picker"; insertAt: number; parentFieldId?: string }
  | { kind: "create"; draft: BuilderField; parentFieldId?: string }
  | { kind: "edit"; fieldId: string };

type Props = {
  active: ActiveOverlay;
  onActiveChange: (next: ActiveOverlay) => void;
  config: BuilderConfig;
  builder: BuilderFieldsApi;
  /** Current settings values; the modal edits a copy of these. */
  settings: BuilderSettingsValues;
  onSettingsChange: (next: BuilderSettingsValues) => void;
  /** Code-first entities render every editing affordance disabled. */
  readOnly: boolean;
};

/**
 * A new field id.
 *
 * Deliberately not `generateFieldId` from `lib/builder`: that one draws 9
 * random characters where the builder pages have always drawn 7, and the two
 * are not interchangeable without changing ids the running page already holds.
 */
function newFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Whether a field added under `parentFieldId` would sit inside a repeating
 * container. True when the parent repeats itself, or when the parent already
 * lives inside something that does — the helper only walks ancestors, so the
 * parent's own type has to be checked here.
 */
function addingIntoRepeatingContainer(
  fields: BuilderField[],
  parentFieldId: string
): boolean {
  const parent = findFieldById(fields, parentFieldId);
  if (!parent) return false;
  const parentIsRepeating =
    parent.type === "repeater" ||
    (parent.type === "component" && parent.repeatable === true);
  return parentIsRepeating || isInsideRepeatingAncestor(parent.id, fields);
}

/**
 * The fields a newly created field will sit beside: its parent's children when
 * one is named, otherwise the top level.
 */
function siblingsForNewField(
  fields: BuilderField[],
  parentFieldId?: string
): BuilderField[] {
  if (!parentFieldId) return fields;
  return findFieldById(fields, parentFieldId)?.fields ?? [];
}

/**
 * The fields an edited field must stay uniquely named among: its parent's other
 * children when it is nested, otherwise the other top-level fields.
 */
function siblingsForEditedField(
  fields: BuilderField[],
  field: BuilderField
): BuilderField[] {
  const parent = findParentContainerId(fields, field.id);
  if (!parent) return fields.filter(f => f.id !== field.id);
  const container = findFieldById(fields, parent.containerId);
  return (container?.fields ?? []).filter(f => f.id !== field.id);
}

export function BuilderOverlays({
  active,
  onActiveChange,
  config,
  builder,
  settings,
  onSettingsChange,
  readOnly,
}: Props) {
  const close = () => onActiveChange({ kind: "none" });

  /** Commit a configured field to its parent, or to the top level. */
  const commitField = (field: BuilderField, parentFieldId?: string) => {
    if (parentFieldId) {
      builder.handleNestedFieldAdd(parentFieldId, field);
    } else {
      builder.setFields([...builder.fields, field]);
    }
    close();
  };

  const editingField =
    active.kind === "edit"
      ? (findFieldById(builder.fields, active.fieldId) ?? null)
      : null;

  return (
    <>
      {/* Settings modal — read-only for code-first entities. */}
      {active.kind === "settings" && (
        <BuilderSettingsModal
          open
          mode="edit"
          config={config}
          initialValues={settings}
          readOnly={readOnly}
          onCancel={close}
          onSubmit={next => {
            onSettingsChange(next);
            close();
          }}
        />
      )}

      {/* Field picker — opens off the toolbar's add affordance or the in-list
          one. Picking a type does not add a field; it opens the editor sheet
          in create mode against a draft. */}
      {active.kind === "picker" && (
        <FieldPickerModal
          open
          title={
            active.parentFieldId
              ? `Add field to ${
                  findFieldById(builder.fields, active.parentFieldId)?.name ??
                  "parent"
                }`
              : undefined
          }
          excludedTypes={config.picker.excludedTypes ?? []}
          onCancel={close}
          onSelect={type =>
            onActiveChange({
              kind: "create",
              parentFieldId: active.parentFieldId,
              draft: {
                id: newFieldId(),
                name: "",
                label: "",
                type,
                validation: {},
              },
            })
          }
        />
      )}

      {active.kind === "create" && (
        <FieldEditorSheet
          open
          mode="create"
          field={active.draft}
          siblingFields={siblingsForNewField(
            builder.fields,
            active.parentFieldId
          )}
          readOnly={readOnly}
          isInsideRepeatingAncestor={
            active.parentFieldId
              ? addingIntoRepeatingContainer(
                  builder.fields,
                  active.parentFieldId
                )
              : false
          }
          onCancel={close}
          onApply={next => commitField(next, active.parentFieldId)}
          // Delete is hidden in create mode, so this is unreachable; it exists
          // to satisfy the sheet's prop contract.
          onDelete={close}
        />
      )}

      {active.kind === "edit" && editingField && (
        <FieldEditorSheet
          open
          mode="edit"
          field={editingField}
          siblingFields={siblingsForEditedField(builder.fields, editingField)}
          readOnly={readOnly}
          isInsideRepeatingAncestor={isInsideRepeatingAncestor(
            editingField.id,
            builder.fields
          )}
          onCancel={close}
          onApply={next => {
            builder.handleFieldUpdate(next);
            close();
          }}
          onDelete={() => {
            builder.handleFieldDelete(editingField.id);
            close();
          }}
        />
      )}
    </>
  );
}
