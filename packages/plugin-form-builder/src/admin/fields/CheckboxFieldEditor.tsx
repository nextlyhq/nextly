/**
 * Checkbox Field Editor
 *
 * Editor component for configuring checkbox field properties.
 * Includes general settings (label, name, help text, required) and
 * default value configuration.
 *
 * Checkbox fields are typically used for:
 * - Terms and conditions acceptance
 * - Newsletter opt-in
 * - Boolean yes/no questions
 *
 * @module admin/fields/CheckboxFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { CheckboxFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * CheckboxFieldEditor - Configure checkbox field properties
 *
 * Provides configuration options for:
 * - Label: Text shown next to the checkbox (e.g., "I agree to the terms")
 * - Field Name: Key used in submission data (auto-formatted)
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the checkbox must be checked (for consent forms)
 * - Default Value: Whether the checkbox is checked by default
 * - Validation: error message
 *
 * @example
 * ```tsx
 * <CheckboxFieldEditor
 *   field={checkboxField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function CheckboxFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<CheckboxFormField>) {
  // Helper to update validation properties
  const updateValidation = (key: string, value: unknown) => {
    onUpdate({
      validation: {
        ...field.validation,
        [key]: value,
      },
    });
  };

  return (
    <div className="checkbox-field-editor">
      {/* General Settings Section */}
      <div className="checkbox-field-editor__section">
        <h4 className="checkbox-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="checkbox-field-editor__field">
          <label className="checkbox-field-editor__label" htmlFor="field-label">
            Label
          </label>
          <Input
            id="field-label"
            type="text"
            value={field.label || ""}
            onChange={e => onUpdate({ label: e.target.value })}
            placeholder="I agree to the terms and conditions"
          />
          <p className="checkbox-field-editor__hint">
            Text displayed next to the checkbox
          </p>
        </div>

        {/* Field Name */}
        <div className="checkbox-field-editor__field">
          <label className="checkbox-field-editor__label" htmlFor="field-name">
            Field Name
          </label>
          <Input
            id="field-name"
            type="text"
            value={field.name || ""}
            onChange={e =>
              onUpdate({
                name: e.target.value
                  .replace(/\s+/g, "_")
                  .replace(/[^a-zA-Z0-9_]/g, "")
                  .toLowerCase(),
              })
            }
            placeholder="field_name"
            className="checkbox-field-editor__input--mono"
          />
          <p className="checkbox-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Help Text */}
        <div className="checkbox-field-editor__field">
          <label className="checkbox-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="checkbox-field-editor__hint">
            Displayed below the field
          </p>
        </div>

        {/* Default Value */}
        <div className="checkbox-field-editor__field checkbox-field-editor__field--inline">
          <label className="checkbox-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.defaultValue || false}
              onChange={e => onUpdate({ defaultValue: e.target.checked })}
              className="checkbox-field-editor__checkbox"
            />
            <span>Checked by default</span>
          </label>
          <p className="checkbox-field-editor__hint">
            Whether the checkbox is pre-checked when the form loads
          </p>
        </div>

        {/* Required */}
        <div className="checkbox-field-editor__field checkbox-field-editor__field--inline">
          <label className="checkbox-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="checkbox-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
          <p className="checkbox-field-editor__hint">
            User must check this box to submit the form (useful for terms
            acceptance)
          </p>
        </div>
      </div>

      {/* Validation Section */}
      <div className="checkbox-field-editor__section">
        <h4 className="checkbox-field-editor__section-title">Validation</h4>

        {/* Error Message */}
        <div className="checkbox-field-editor__field">
          <label className="checkbox-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="You must accept the terms to continue"
          />
          <p className="checkbox-field-editor__hint">
            Custom message shown when required checkbox is not checked
          </p>
        </div>
      </div>
    </div>
  );
}

export default CheckboxFieldEditor;
