"use client";

/**
 * The overlays a builder page mounts over its field list: the settings modal
 * and the field picker. The field settings panel is docked beside the list
 * rather than laid over it, so the layout draws it (`BuilderFieldSettings`).
 *
 * One of these is open at a time, or a field is being edited, so the page
 * holds a single `ActiveOverlay` value rather than booleans that could
 * disagree.
 */
import type { JSX } from "react";

import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { StoredHookConfig } from "@admin/types/collection";

import type { BuilderConfig } from "./builder-config";
import { BuilderFieldPicker } from "./BuilderFieldPicker";
import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "./BuilderSettingsModal";
import type { BuilderFieldsApi } from "./types";

/**
 * Which overlay is open, and the state that overlay needs.
 *
 * `picker` carries the position the new field lands at: the container (the
 * top level when none) and the field it goes before (the end when none). The
 * picker adds the field there, then the settings panel opens on it (`edit`).
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
  /** A collection's stored hooks, which the settings modal shows read-only. */
  storedHooks?: readonly StoredHookConfig[];
};

export function BuilderOverlays({
  active,
  onActiveChange,
  config,
  builder,
  settings,
  onSettingsChange,
  readOnly,
  storedHooks,
}: Props): JSX.Element {
  const close = () => onActiveChange({ kind: "none" });

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
          storedHooks={storedHooks}
          onCancel={close}
          onSubmit={next => {
            onSettingsChange(next);
            close();
          }}
        />
      )}

      {/* Field picker: picking a type and a label adds the field where the
          picker was opened, then opens it in the settings panel; add-and-add-another
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
    </>
  );
}
