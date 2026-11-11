"use client";

/**
 * The selected field's settings: the shared settings panel, configured for
 * forms (`forms-field-surface`).
 *
 * Where the window is wide enough it docks at the window's edge as a column
 * of its own beside the whole editor (`FieldInspector`); where it is not, the
 * list opens it under the selected row (`useFieldPanel`). One panel either
 * way, so the two cannot come to differ.
 *
 * @module admin/components/builder/FieldInspector
 */
import { FieldSettingsPanel } from "@nextlyhq/plugin-sdk/admin";
import { type JSX, type ReactNode, useMemo, useSyncExternalStore } from "react";

import {
  useFieldBookkeeping,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { FORMS_FIELD_SURFACE } from "./forms-field-surface";
import { fromPanelField, toPanelField } from "./panel-field";

/** The id of the docked settings column, which a selected row controls. */
export const DOCKED_PANEL_ID = "form-field-settings";

/**
 * The width from which the settings panel docks at the window's edge: the
 * Schema Builder's. The form editor folds the Forms panel away, so from
 * 1024px the outline keeps room to read a field's label beside it.
 */
const DOCKED = "(min-width: 1024px)";

function subscribeDocked(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DOCKED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the window is wide enough to dock the panel. A window without
 * `matchMedia` (a server render, a test) opens it under the row, which works
 * at any width.
 */
export function useDocked(): boolean {
  return useSyncExternalStore(
    subscribeDocked,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(DOCKED).matches,
    () => false
  );
}

/**
 * The selected field's settings panel, or `null` with no field selected.
 * `closable` offers the panel's own Close, for the docked column; under a row,
 * the row itself closes it.
 */
export function useFieldPanel(closable: boolean): ReactNode {
  const { fields, selectedFieldId, selectField } = useFormBuilder();
  // A colleague's claim makes every setting read-only, as the provider holds it.
  const { savedFieldNames, readOnly, fieldKey, editField, restored } =
    useFieldBookkeeping();

  // Every field as the panel sees it, so a condition can name any of them.
  const panelFields = useMemo(
    () => fields.map(field => toPanelField(field, fieldKey(field.name))),
    [fields, fieldKey]
  );

  const index = fields.findIndex(field => field.name === selectedFieldId);
  if (index === -1) return null;
  const selected = fields[index];
  return (
    <FieldSettingsPanel
      // Opened afresh on the restored field after an Undo, so nothing the
      // panel keeps of its own shows what was taken back.
      key={restored}
      surface={FORMS_FIELD_SURFACE}
      field={panelFields[index]}
      ancestors={[]}
      siblings={panelFields}
      saved={savedFieldNames.has(selected.name)}
      readOnly={readOnly}
      onChange={next => editField(selected, fromPanelField(next), fields)}
      onClose={closable ? () => selectField(null) : undefined}
    />
  );
}

/**
 * The docked panel: a column at the window's edge, as tall as the window
 * below the bar, its own body scrolling. Draws nothing below the docking
 * width, where the list opens the panel under the row instead.
 */
export function FieldInspector(): JSX.Element | null {
  const docked = useDocked();
  const panel = useFieldPanel(true);
  if (!docked || panel === null) return null;
  return (
    <aside
      id={DOCKED_PANEL_ID}
      aria-label="Field settings"
      className="sticky top-0 flex h-[var(--editor-scrollport,calc(100vh-var(--admin-bar-height)))] w-[23rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card"
    >
      {panel}
    </aside>
  );
}
