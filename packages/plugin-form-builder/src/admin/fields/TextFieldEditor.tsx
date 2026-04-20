/**
 * Text Field Editor
 *
 * Editor component for configuring text field properties.
 * Includes general settings (label, name, placeholder, required) and
 * validation options (minLength, maxLength, pattern).
 *
 * @module admin/fields/TextFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { TextFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * TextFieldEditor - Configure text field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when field is empty
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Validation: minLength, maxLength, pattern (regex), error message
 *
 * @example
 * ```tsx
 * <TextFieldEditor
 *   field={textField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function TextFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<TextFormField>) {
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
    <div className="text-field-editor">
      {/* General Settings Section */}
      <div className="text-field-editor__section">
        <h4 className="text-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="text-field-editor__field">
          <label className="text-field-editor__label" htmlFor="field-label">
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
        <div className="text-field-editor__field">
          <label className="text-field-editor__label" htmlFor="field-name">
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
            className="text-field-editor__input--mono"
          />
          <p className="text-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="text-field-editor__field">
          <label
            className="text-field-editor__label"
            htmlFor="field-placeholder"
          >
            Placeholder
          </label>
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="Enter placeholder text"
          />
        </div>

        {/* Help Text */}
        <div className="text-field-editor__field">
          <label className="text-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="text-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Required */}
        <div className="text-field-editor__field text-field-editor__field--inline">
          <label className="text-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="text-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Validation Section */}
      <div className="text-field-editor__section">
        <h4 className="text-field-editor__section-title">Validation</h4>

        {/* Min/Max Length */}
        <div className="text-field-editor__field-row">
          <div className="text-field-editor__field text-field-editor__field--half">
            <label
              className="text-field-editor__label"
              htmlFor="field-minlength"
            >
              Min Length
            </label>
            <Input
              id="field-minlength"
              type="number"
              min={0}
              value={field.validation?.minLength ?? ""}
              onChange={e =>
                updateValidation(
                  "minLength",
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              placeholder="0"
            />
          </div>
          <div className="text-field-editor__field text-field-editor__field--half">
            <label
              className="text-field-editor__label"
              htmlFor="field-maxlength"
            >
              Max Length
            </label>
            <Input
              id="field-maxlength"
              type="number"
              min={0}
              value={field.validation?.maxLength ?? ""}
              onChange={e =>
                updateValidation(
                  "maxLength",
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              placeholder="No limit"
            />
          </div>
        </div>

        {/* Pattern */}
        <div className="text-field-editor__field">
          <label className="text-field-editor__label" htmlFor="field-pattern">
            Pattern (Regex)
          </label>
          <Input
            id="field-pattern"
            type="text"
            value={field.validation?.pattern || ""}
            onChange={e =>
              updateValidation("pattern", e.target.value || undefined)
            }
            placeholder="^[A-Za-z]+$"
            className="text-field-editor__input--mono"
          />
          <p className="text-field-editor__hint">
            Regular expression for custom validation
          </p>
        </div>

        {/* Error Message */}
        <div className="text-field-editor__field">
          <label className="text-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="Please enter a valid value"
          />
          <p className="text-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default TextFieldEditor;
