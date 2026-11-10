/**
 * The shapes the shared field settings panel takes: what a surface configures,
 * what a field type says about its own settings, and the panel's props.
 *
 * The panel edits one field definition and reports every change to its host,
 * which decides where the change goes (the Builder's draft, a form's
 * definition, a user field). It writes nothing itself, so a surface's storage
 * and save stay that surface's.
 */
import type { FieldSurface } from "nextly/field-catalog";
import type { ComponentType, ReactNode } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

/** The panel's tabs, in the order they are shown. */
export type FieldSettingsTab =
  | "general"
  | "validation"
  | "display"
  | "conditions"
  | "advanced";

/** What a settings control is given: the field, and where its changes go. */
export interface FieldSettingsControlProps {
  field: BuilderField;
  /** True when nothing may be changed; the control still shows its values. */
  readOnly: boolean;
  onChange: (next: BuilderField) => void;
}

/**
 * What a surface's own settings are given: a settings control's props, and the
 * containers the field sits in, outermost first, for settings that depend on
 * where the field is (a unique column means nothing inside repeating rows).
 */
export interface FieldSettingsSurfaceControlProps
  extends FieldSettingsControlProps {
  ancestors: readonly BuilderField[];
}

/**
 * A field type's own settings, as the panel shows them.
 *
 * `defining` holds the settings that make a field this type (a link's
 * collection, a dropdown's options), drawn first in General, before the
 * settings every field has. `tabs` holds its other settings, drawn after the
 * panel's own in the tab named. A type with neither has no settings of its own.
 */
export interface FieldTypeSettings {
  defining?: ComponentType<FieldSettingsControlProps>;
  tabs?: Partial<
    Record<FieldSettingsTab, ComponentType<FieldSettingsControlProps>>
  >;
}

/** A setting a surface fixes, when it fixes it, and why. */
export interface FixedFieldSetting {
  setting: "name" | "type";
  /** Always, or once the field has been saved on this surface. */
  when: "always" | "saved";
  /** Shown beside the fixed setting, so a person knows why it cannot change. */
  reason: string;
}

/**
 * How one surface configures the panel. A surface adds behaviour only through
 * this object; the panel never asks which surface it is on.
 */
export interface FieldSettingsSurface {
  /** The surface whose plugin field types the panel names. */
  surface: FieldSurface;
  /** The name a label gives a field, followed while the field is unsaved. */
  deriveName: (label: string) => string;
  /** Settings the surface fixes. */
  fixed?: readonly FixedFieldSetting[];
  /** The surface's own settings, drawn after the panel's in the tab named. */
  extraSettings?: Partial<
    Record<FieldSettingsTab, ComponentType<FieldSettingsSurfaceControlProps>>
  >;
  /**
   * Its conditions: `sibling`, a condition on a field beside this one, as the
   * entry form evaluates it; `none`, where fields carry no conditions.
   */
  conditions: "sibling" | "none";
}

export interface FieldSettingsPanelProps {
  surface: FieldSettingsSurface;
  field: BuilderField;
  /** The containers the field sits in, outermost first; empty at the top. */
  ancestors: readonly BuilderField[];
  /** The other fields beside it, which its conditions may name. */
  siblings: readonly BuilderField[];
  /**
   * Whether the field has been saved on this surface. A saved field's name no
   * longer follows its label, and what the surface fixes once saved is fixed.
   */
  saved: boolean;
  /** Show every setting without letting any change. */
  readOnly?: boolean;
  /** Called with the whole field after each change, at once. */
  onChange: (next: BuilderField) => void;
  /** Closes the panel; a close button is shown only when it is given. */
  onClose?: () => void;
  /** The host's own actions, drawn in the header (Delete, say). */
  actions?: ReactNode;
}
