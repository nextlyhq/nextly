"use client";

/**
 * The overlays a builder page mounts over its field list: the settings modal,
 * the field picker, and the field editor sheet.
 *
 * One overlay is open at a time, so the page holds a single `ActiveOverlay`
 * value rather than four booleans that could disagree.
 */
import type { JSX } from "react";

import { findFieldById, findParentContainerId } from "@admin/lib/builder";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import { isInsideRepeatingAncestor } from "@admin/lib/builder/is-inside-repeating-ancestor";

import type { BuilderConfig } from "./builder-config";
import { BuilderFieldPicker } from "./BuilderFieldPicker";
import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "./BuilderSettingsModal";
import { FieldEditorSheet } from "./FieldEditorSheet";
import type { BuilderField, BuilderFieldsApi } from "./types";

/**
 * Which overlay is open, and the state that overlay needs.
 *
 * `picker` carries the position the new field lands at: the container (the
 * top level when none) and the field it goes before (the end when none). The
 * picker adds the field there, then the editor opens on it.
 */
export type ActiveOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "picker"; position: FieldInsertPosition }
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
}: Props): JSX.Element {
  const close = () => onActiveChange({ kind: "none" });

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

      {/* Field picker: picking a type and a label adds the field where the
          picker was opened, then opens it in the editor; add-and-add-another
          stays in the picker for the next one. */}
      {active.kind === "picker" && (
        <BuilderFieldPicker
          config={config}
          fields={builder.fields}
          position={active.position}
          entitySlug={settings.slug}
          onCancel={close}
          onFieldsChange={builder.setFields}
          onAdded={(fieldId, how) => {
            if (!how.addAnother) onActiveChange({ kind: "edit", fieldId });
          }}
        />
      )}

      {active.kind === "edit" && editingField && (
        <FieldEditorSheet
          open
          mode="edit"
          kind={config.kind}
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
