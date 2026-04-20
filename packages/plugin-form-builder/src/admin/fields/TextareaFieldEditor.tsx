/**
 * Textarea Field Editor
 *
 * Editor component for configuring textarea field properties.
 * Includes general settings (label, name, placeholder, rows, required) and
 * validation options (minLength, maxLength).
 *
 * @module admin/fields/TextareaFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { TextareaFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * TextareaFieldEditor - Configure textarea field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when field is empty
 * - Help Text: Additional guidance shown below the field
 * - Rows: Number of visible text rows (height)
 * - Required: Whether the field must be filled
 * - Validation: minLength, maxLength, error message
 *
 * @example
 * ```tsx
 * <TextareaFieldEditor
 *   field={textareaField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function TextareaFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<TextareaFormField>) {
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
    <div className="textarea-field-editor">
      {/* General Settings Section */}
      <div className="textarea-field-editor__section">
        <h4 className="textarea-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="textarea-field-editor__field">
          <label className="textarea-field-editor__label" htmlFor="field-label">
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
        <div className="textarea-field-editor__field">
          <label className="textarea-field-editor__label" htmlFor="field-name">
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
            className="textarea-field-editor__input--mono"
          />
          <p className="textarea-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="textarea-field-editor__field">
          <label
            className="textarea-field-editor__label"
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
        <div className="textarea-field-editor__field">
          <label className="textarea-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="textarea-field-editor__hint">
            Displayed below the field
          </p>
        </div>

        {/* Rows */}
        <div className="textarea-field-editor__field">
          <label className="textarea-field-editor__label" htmlFor="field-rows">
            Rows
          </label>
          <Input
            id="field-rows"
            type="number"
            min={2}
            max={20}
            value={field.rows ?? 4}
            onChange={e =>
              onUpdate({
                rows: e.target.value ? parseInt(e.target.value, 10) : 4,
              })
            }
            placeholder="4"
          />
          <p className="textarea-field-editor__hint">
            Number of visible text rows (2-20)
          </p>
        </div>

        {/* Required */}
        <div className="textarea-field-editor__field textarea-field-editor__field--inline">
          <label className="textarea-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="textarea-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Validation Section */}
      <div className="textarea-field-editor__section">
        <h4 className="textarea-field-editor__section-title">Validation</h4>

        {/* Min/Max Length */}
        <div className="textarea-field-editor__field-row">
          <div className="textarea-field-editor__field textarea-field-editor__field--half">
            <label
              className="textarea-field-editor__label"
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
          <div className="textarea-field-editor__field textarea-field-editor__field--half">
            <label
              className="textarea-field-editor__label"
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

        {/* Error Message */}
        <div className="textarea-field-editor__field">
          <label className="textarea-field-editor__label" htmlFor="field-error">
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
          <p className="textarea-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default TextareaFieldEditor;
