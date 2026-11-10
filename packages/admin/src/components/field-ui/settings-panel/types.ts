/**
 * The shapes the shared field settings panel takes: what a surface configures,
 * what a field type says about its own settings, and the panel's props.
 *
 * The panel edits one field definition and reports every change to its host,
 * which decides where the change goes (the Builder's draft, a form's
 * definition, a user field). It writes nothing itself, so a surface's storage
 * and save stay that surface's.
 */
import type { FieldSurface, FieldValidationRule } from "nextly/field-catalog";
import type { ComponentType, ReactNode } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

/**
 * The field the panel edits: a field definition as the admin holds it, with
 * the id that tells it apart from its siblings while it is edited.
 */
export type FieldSettingsField = BuilderField;

/** The panel's tabs, in the order they are shown. */
export type FieldSettingsTab =
  | "general"
  | "validation"
  | "display"
  | "conditions"
  | "advanced";

/** What a settings control is given: the field, and where its changes go. */
export interface FieldSettingsControlProps {
  field: FieldSettingsField;
  /** True when nothing may be changed; the control still shows its values. */
  readOnly: boolean;
  onChange: (next: FieldSettingsField) => void;
}

/**
 * What a surface's own settings are given: a settings control's props, and the
 * containers the field sits in, outermost first, for settings that depend on
 * where the field is (a unique column means nothing inside repeating rows).
 */
export interface FieldSettingsSurfaceControlProps
  extends FieldSettingsControlProps {
  ancestors: readonly FieldSettingsField[];
  /** The other fields beside it, for a setting that names one of them. */
  siblings: readonly FieldSettingsField[];
}

/**
 * What a surface's own Conditions tab is given: the field, where its changes
 * go, and the fields beside it that a condition may read.
 */
export type FieldSettingsConditionsProps = FieldSettingsSurfaceControlProps;

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
   * entry form evaluates it; `none`, where fields carry no conditions; or the
   * surface's own editor, drawn as the whole Conditions tab, for a surface
   * whose conditions take a shape the shared one does not (a form's show or
   * hide on several conditions, say).
   */
  conditions: "sibling" | "none" | ComponentType<FieldSettingsConditionsProps>;
  /**
   * @experimental Narrows the validation rules the Validation tab offers for a
   * type to those this surface enforces. Given the rules core allows for the
   * type; absent, all of them are offered. A rule the surface's runtime ignores
   * would let an author set a limit that is never applied.
   */
  validationRules?: (
    type: string,
    allowed: readonly FieldValidationRule[]
  ) => readonly FieldValidationRule[];
  /**
   * @experimental Whether Display offers "Read only" and "Hidden", which mean
   * something in the record editor; false on a surface they mean nothing on.
   * Shown when absent.
   */
  displaySwitches?: boolean;
  /**
   * @experimental A type's own settings on this surface, by type id, used in
   * place of the core table's: a form's checkbox is one yes/no, where the
   * entry form's is a set of choices. A type named here is known at once,
   * without waiting for the plugin list.
   */
  typeSettings?: Readonly<Partial<Record<string, FieldTypeSettings>>>;
}

export interface FieldSettingsPanelProps {
  surface: FieldSettingsSurface;
  field: FieldSettingsField;
  /** The containers the field sits in, outermost first; empty at the top. */
  ancestors: readonly FieldSettingsField[];
  /** The other fields beside it, which its conditions may name. */
  siblings: readonly FieldSettingsField[];
  /**
   * Whether the field has been saved on this surface. A saved field's name no
   * longer follows its label, and what the surface fixes once saved is fixed.
   */
  saved: boolean;
  /** Show every setting without letting any change. */
  readOnly?: boolean;
  /** Called with the whole field after each change, at once. */
  onChange: (next: FieldSettingsField) => void;
  /** Closes the panel; a close button is shown only when it is given. */
  onClose?: () => void;
  /** The host's own actions, drawn in the header (Delete, say). */
  actions?: ReactNode;
}
