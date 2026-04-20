/**
 * Radio Field Editor
 *
 * Editor component for configuring radio button group field properties.
 * Includes general settings, options management with drag-and-drop,
 * default value selection, and validation.
 *
 * @module admin/fields/RadioFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { RadioFormField } from "../../types";

import { OptionsEditor } from "./OptionsEditor";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * RadioFieldEditor - Configure radio button group field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Options: List of label/value pairs with drag-and-drop reordering
 * - Default Value: Pre-selected option
 * - Validation: Custom error message
 *
 * Note: Radio buttons only allow single selection (unlike Select with allowMultiple).
 *
 * @example
 * ```tsx
 * <RadioFieldEditor
 *   field={radioField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function RadioFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<RadioFormField>) {
  // Helper to update validation properties
  const updateValidation = (key: string, value: unknown) => {
    onUpdate({
      validation: {
        ...field.validation,
        [key]: value,
      },
    });
  };

  // Get available options for default value dropdown
  const availableOptions = field.options || [];

  return (
    <div className="radio-field-editor">
      {/* General Settings Section */}
      <div className="radio-field-editor__section">
        <h4 className="radio-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="radio-field-editor__field">
          <label className="radio-field-editor__label" htmlFor="field-label">
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
        <div className="radio-field-editor__field">
          <label className="radio-field-editor__label" htmlFor="field-name">
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
            className="radio-field-editor__input--mono"
          />
          <p className="radio-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Help Text */}
        <div className="radio-field-editor__field">
          <label className="radio-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="radio-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Required */}
        <div className="radio-field-editor__field radio-field-editor__field--inline">
          <label className="radio-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="radio-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Options Section */}
      <div className="radio-field-editor__section">
        <h4 className="radio-field-editor__section-title">Options</h4>

        <OptionsEditor
          options={field.options || []}
          onOptionsChange={options => onUpdate({ options })}
        />
      </div>

      {/* Settings Section */}
      <div className="radio-field-editor__section">
        <h4 className="radio-field-editor__section-title">Settings</h4>

        {/* Default Value */}
        <div className="radio-field-editor__field">
          <label
            className="radio-field-editor__label"
            htmlFor="field-default-value"
          >
            Default Value
          </label>
          {availableOptions.length > 0 ? (
            <div className="radio-field-editor__default-options">
              {/* No default option */}
              <label className="radio-field-editor__default-option">
                <input
                  type="radio"
                  name="default-value"
                  checked={!field.defaultValue}
                  onChange={() => onUpdate({ defaultValue: undefined })}
                  className="radio-field-editor__radio"
                />
                <span className="radio-field-editor__default-option-label">
                  No default
                </span>
              </label>

              {/* Options as radio buttons */}
              {availableOptions.map(opt => (
                <label
                  key={opt.value}
                  className="radio-field-editor__default-option"
                >
                  <input
                    type="radio"
                    name="default-value"
                    checked={field.defaultValue === opt.value}
                    onChange={() => onUpdate({ defaultValue: opt.value })}
                    className="radio-field-editor__radio"
                  />
                  <span className="radio-field-editor__default-option-label">
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="radio-field-editor__hint">
              Add options above to set a default value
            </p>
          )}
          <p className="radio-field-editor__hint">
            Pre-selected when the form loads
          </p>
        </div>
      </div>

      {/* Validation Section */}
      <div className="radio-field-editor__section">
        <h4 className="radio-field-editor__section-title">Validation</h4>

        {/* Error Message */}
        <div className="radio-field-editor__field">
          <label className="radio-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="Please select an option"
          />
          <p className="radio-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default RadioFieldEditor;
