/**
 * Date Field Editor
 *
 * Editor component for configuring date picker field properties.
 * Includes general settings (label, name, placeholder, required, default value)
 * and validation options (min date, max date).
 *
 * @module admin/fields/DateFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { DateFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * DateFieldEditor - Configure date field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when field is empty
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Default Value: Pre-selected date when form loads
 * - Validation: min date, max date, error message
 *
 * @example
 * ```tsx
 * <DateFieldEditor
 *   field={dateField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function DateFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<DateFormField>) {
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
    <div className="date-field-editor">
      {/* General Settings Section */}
      <div className="date-field-editor__section">
        <h4 className="date-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="date-field-editor__field">
          <label className="date-field-editor__label" htmlFor="field-label">
            Label
          </label>
          <Input
            id="field-label"
            type="text"
            value={field.label || ""}
            onChange={e => onUpdate({ label: e.target.value })}
            placeholder="Enter field label"
          />
        </div>

        {/* Field Name */}
        <div className="date-field-editor__field">
          <label className="date-field-editor__label" htmlFor="field-name">
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
            className="date-field-editor__input--mono"
          />
          <p className="date-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="date-field-editor__field">
          <label
            className="date-field-editor__label"
            htmlFor="field-placeholder"
          >
            Placeholder
          </label>
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="Select a date..."
          />
        </div>

        {/* Help Text */}
        <div className="date-field-editor__field">
          <label className="date-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="date-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Default Value */}
        <div className="date-field-editor__field">
          <label
            className="date-field-editor__label"
            htmlFor="field-default-value"
          >
            Default Value
          </label>
          <input
            id="field-default-value"
            type="date"
            value={field.defaultValue || ""}
            onChange={e =>
              onUpdate({ defaultValue: e.target.value || undefined })
            }
            className="date-field-editor__date-input"
          />
          <p className="date-field-editor__hint">
            Pre-selected date when the form loads
          </p>
        </div>

        {/* Required */}
        <div className="date-field-editor__field date-field-editor__field--inline">
          <label className="date-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="date-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Validation Section */}
      <div className="date-field-editor__section">
        <h4 className="date-field-editor__section-title">Validation</h4>

        {/* Min/Max Date */}
        <div className="date-field-editor__field-row">
          <div className="date-field-editor__field date-field-editor__field--half">
            <label
              className="date-field-editor__label"
              htmlFor="field-min-date"
            >
              Min Date
            </label>
            <input
              id="field-min-date"
              type="date"
              value={field.min || ""}
              onChange={e => onUpdate({ min: e.target.value || undefined })}
              className="date-field-editor__date-input"
            />
            <p className="date-field-editor__hint">Earliest allowed date</p>
          </div>
          <div className="date-field-editor__field date-field-editor__field--half">
            <label
              className="date-field-editor__label"
              htmlFor="field-max-date"
            >
              Max Date
            </label>
            <input
              id="field-max-date"
              type="date"
              value={field.max || ""}
              onChange={e => onUpdate({ max: e.target.value || undefined })}
              className="date-field-editor__date-input"
            />
            <p className="date-field-editor__hint">Latest allowed date</p>
          </div>
        </div>

        {/* Error Message */}
        <div className="date-field-editor__field">
          <label className="date-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="Please select a valid date"
          />
          <p className="date-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default DateFieldEditor;
