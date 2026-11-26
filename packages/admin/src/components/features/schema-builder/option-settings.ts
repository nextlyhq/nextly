/**
 * What a list of options shows beside the options themselves, by the kind of picker it draws: a
 * dropdown can take several picks, be cleared and show a placeholder; radio buttons are laid out
 * across or down. One table for the options editor, which draws from it, and for a type change,
 * which keeps a setting only where the new type shows it.
 *
 * @module components/features/schema-builder/option-settings
 */

/** The pickers a list of options is drawn as. */
export type OptionsPicker = "select" | "radio";

/** What one picker shows beside its options. */
export interface OptionsPickerSettings {
  hasMany: boolean;
  clearable: boolean;
  placeholder: boolean;
  layout: boolean;
}

export const OPTIONS_PICKER_SETTINGS: Readonly<
  Record<OptionsPicker, OptionsPickerSettings>
> = {
  select: { hasMany: true, clearable: true, placeholder: true, layout: false },
  radio: { hasMany: false, clearable: false, placeholder: false, layout: true },
};

/**
 * The picker a type's options are drawn as: radio buttons for a radio field, a dropdown for every
 * other type that has options (a dropdown, and the entry form's checkbox, a set of choices).
 */
export function optionsPickerOf(type: string): OptionsPicker {
  return type === "radio" ? "radio" : "select";
}
