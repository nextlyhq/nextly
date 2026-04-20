/**
 * Number Field Editor
 *
 * Editor component for configuring number field properties.
 * Includes general settings (label, name, placeholder, required) and
 * validation options (min, max, step).
 *
 * @module admin/fields/NumberFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { NumberFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * NumberFieldEditor - Configure number field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when field is empty
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Validation: min, max, step, error message
 *
 * @example
 * ```tsx
 * <NumberFieldEditor
 *   field={numberField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function NumberFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<NumberFormField>) {
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
    <div className="number-field-editor">
      {/* General Settings Section */}
      <div className="number-field-editor__section">
        <h4 className="number-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="number-field-editor__field">
          <label className="number-field-editor__label" htmlFor="field-label">
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
        <div className="number-field-editor__field">
          <label className="number-field-editor__label" htmlFor="field-name">
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
            className="number-field-editor__input--mono"
          />
          <p className="number-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="number-field-editor__field">
          <label
            className="number-field-editor__label"
            htmlFor="field-placeholder"
          >
            Placeholder
          </label>
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="0"
          />
        </div>

        {/* Help Text */}
        <div className="number-field-editor__field">
          <label className="number-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="number-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Required */}
        <div className="number-field-editor__field number-field-editor__field--inline">
          <label className="number-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="number-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Validation Section */}
      <div className="number-field-editor__section">
        <h4 className="number-field-editor__section-title">Validation</h4>

        {/* Min/Max Value */}
        <div className="number-field-editor__field-row">
          <div className="number-field-editor__field number-field-editor__field--half">
            <label className="number-field-editor__label" htmlFor="field-min">
              Min Value
            </label>
            <Input
              id="field-min"
              type="number"
              value={field.validation?.min ?? ""}
              onChange={e =>
                updateValidation(
                  "min",
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
              placeholder="No minimum"
            />
          </div>
          <div className="number-field-editor__field number-field-editor__field--half">
            <label className="number-field-editor__label" htmlFor="field-max">
              Max Value
            </label>
            <Input
              id="field-max"
              type="number"
              value={field.validation?.max ?? ""}
              onChange={e =>
                updateValidation(
                  "max",
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
              placeholder="No maximum"
            />
          </div>
        </div>

        {/* Step */}
        <div className="number-field-editor__field">
          <label className="number-field-editor__label" htmlFor="field-step">
            Step
          </label>
          <Input
            id="field-step"
            type="number"
            min={0}
            step="any"
            value={field.validation?.step ?? ""}
            onChange={e =>
              updateValidation(
                "step",
                e.target.value ? parseFloat(e.target.value) : undefined
              )
            }
            placeholder="1"
          />
          <p className="number-field-editor__hint">
            Increment/decrement step (e.g., 0.01 for decimals, 5 for multiples
            of 5)
          </p>
        </div>

        {/* Error Message */}
        <div className="number-field-editor__field">
          <label className="number-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="Please enter a valid number"
          />
          <p className="number-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default NumberFieldEditor;
