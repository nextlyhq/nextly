/**
 * Select Field Editor
 *
 * Editor component for configuring select (dropdown) field properties.
 * Includes general settings, options management with drag-and-drop,
 * allow multiple toggle, default value selection, and validation.
 *
 * @module admin/fields/SelectFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { SelectFormField } from "../../types";

import { OptionsEditor } from "./OptionsEditor";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * SelectFieldEditor - Configure select (dropdown) field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when no option selected
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Options: List of label/value pairs with drag-and-drop reordering
 * - Allow Multiple: Enable multi-select functionality
 * - Default Value: Pre-selected option(s)
 * - Validation: Custom error message
 *
 * @example
 * ```tsx
 * <SelectFieldEditor
 *   field={selectField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function SelectFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<SelectFormField>) {
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
    <div className="select-field-editor">
      {/* General Settings Section */}
      <div className="select-field-editor__section">
        <h4 className="select-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="select-field-editor__field">
          <label className="select-field-editor__label" htmlFor="field-label">
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
        <div className="select-field-editor__field">
          <label className="select-field-editor__label" htmlFor="field-name">
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
            className="select-field-editor__input--mono"
          />
          <p className="select-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="select-field-editor__field">
          <label
            className="select-field-editor__label"
            htmlFor="field-placeholder"
          >
            Placeholder
          </label>
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="Choose an option..."
          />
        </div>

        {/* Help Text */}
        <div className="select-field-editor__field">
          <label className="select-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="select-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Required */}
        <div className="select-field-editor__field select-field-editor__field--inline">
          <label className="select-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="select-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Options Section */}
      <div className="select-field-editor__section">
        <h4 className="select-field-editor__section-title">Options</h4>

        <OptionsEditor
          options={field.options || []}
          onOptionsChange={options => onUpdate({ options })}
        />
      </div>

      {/* Settings Section */}
      <div className="select-field-editor__section">
        <h4 className="select-field-editor__section-title">Settings</h4>

        {/* Allow Multiple */}
        <div className="select-field-editor__field select-field-editor__field--inline">
          <label className="select-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.allowMultiple || false}
              onChange={e => onUpdate({ allowMultiple: e.target.checked })}
              className="select-field-editor__checkbox"
            />
            <span>Allow multiple selections</span>
          </label>
          <p className="select-field-editor__hint">
            Users can select more than one option
          </p>
        </div>

        {/* Default Value */}
        <div className="select-field-editor__field">
          <label
            className="select-field-editor__label"
            htmlFor="field-default-value"
          >
            Default Value
          </label>
          {field.allowMultiple ? (
            /* Multi-select: Checkboxes for default values */
            <div className="select-field-editor__default-multi">
              {availableOptions.length > 0 ? (
                availableOptions.map(opt => {
                  const currentDefaults = Array.isArray(field.defaultValue)
                    ? field.defaultValue
                    : [];
                  const isSelected = currentDefaults.includes(opt.value);

                  return (
                    <label
                      key={opt.value}
                      className="select-field-editor__default-option"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => {
                          const newDefaults = e.target.checked
                            ? [...currentDefaults, opt.value]
                            : currentDefaults.filter(v => v !== opt.value);
                          onUpdate({
                            defaultValue:
                              newDefaults.length > 0 ? newDefaults : undefined,
                          });
                        }}
                        className="select-field-editor__checkbox"
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })
              ) : (
                <p className="select-field-editor__hint">
                  Add options above to set default values
                </p>
              )}
            </div>
          ) : (
            /* Single-select: Dropdown for default value */
            <select
              id="field-default-value"
              value={field.defaultValue || ""}
              onChange={e =>
                onUpdate({
                  defaultValue: e.target.value || undefined,
                })
              }
              className="select-field-editor__select"
            >
              <option value="">No default</option>
              {availableOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          <p className="select-field-editor__hint">
            Pre-selected when the form loads
          </p>
        </div>
      </div>

      {/* Validation Section */}
      <div className="select-field-editor__section">
        <h4 className="select-field-editor__section-title">Validation</h4>

        {/* Error Message */}
        <div className="select-field-editor__field">
          <label className="select-field-editor__label" htmlFor="field-error">
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
          <p className="select-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default SelectFieldEditor;
