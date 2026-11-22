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

import { useLeaveWithoutWarning } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { PendingAddress } from "@admin/services/addressCheckApi";
import type { StoredHookConfig } from "@admin/types/collection";

import type { BuilderConfig } from "./builder-config";
import { BuilderFieldPicker } from "./BuilderFieldPicker";
import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "./BuilderSettingsModal";
import type { BuilderField, BuilderFieldsApi } from "./types";

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
  /**
   * `renaming`: opened from a row's Rename…, so its rename is asked for at once. A number for each
   * request, so asking again on the field already open asks again.
   */
  | { kind: "edit"; fieldId: string; renaming?: number };

type Props = {
  active: ActiveOverlay;
  onActiveChange: (next: ActiveOverlay) => void;
  config: BuilderConfig;
  builder: BuilderFieldsApi;
  /** Current settings values; the modal edits a copy of these. */
  settings: BuilderSettingsValues;
  /**
   * The settings the modal hands back. `leaveWithoutWarning` is the leave
   * guard's: a change that moves the editor to a new route (an unsaved
   * entity's new address) states that move deliberate with it.
   */
  onSettingsChange: (
    next: BuilderSettingsValues,
    leaveWithoutWarning?: () => void
  ) => void;
  /** Code-first entities render every editing affordance disabled. */
  readOnly: boolean;
  /** A collection's stored hooks, which the settings modal shows read-only. */
  storedHooks?: readonly StoredHookConfig[];
  /** An unsaved entity's address stays editable, checked against these. */
  unsavedAddress?: { otherAddresses: readonly PendingAddress[] };
  /** How many places use a field group, said beside its fixed address. */
  usedByCount?: number;
  /** The fields as last saved, where a pending delete still holds its name until the save. */
  savedFields?: readonly BuilderField[];
  /** Whether the save judges names with Draft/Published on: as stored, or as the pending settings set it. */
  lifecycleEnabled?: boolean;
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
  unsavedAddress,
  usedByCount,
  savedFields,
  lifecycleEnabled = false,
}: Props): JSX.Element {
  const close = () => onActiveChange({ kind: "none" });
  // Rendered inside the leave guard, so this is the guard's own escape.
  const leaveWithoutWarning = useLeaveWithoutWarning();

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
          unsavedAddress={unsavedAddress}
          usedByCount={usedByCount}
          onCancel={close}
          onSubmit={next => {
            onSettingsChange(next, leaveWithoutWarning);
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
          savedFields={savedFields}
          lifecycleEnabled={lifecycleEnabled}
        />
      )}
    </>
  );
}
