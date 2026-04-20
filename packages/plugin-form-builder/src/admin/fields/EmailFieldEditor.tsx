/**
 * Email Field Editor
 *
 * Editor component for configuring email field properties.
 * Includes general settings (label, name, placeholder, required) and
 * validation options (pattern, error message).
 *
 * Email validation is automatic - the browser enforces email format.
 * Custom pattern allows additional restrictions (e.g., corporate domains only).
 *
 * @module admin/fields/EmailFieldEditor
 * @since 0.1.0
 */

"use client";

import { Input } from "@revnixhq/ui";

import type { EmailFormField } from "../../types";

import type { FieldEditorProps } from "./index";

// ============================================================================
// Main Component
// ============================================================================

/**
 * EmailFieldEditor - Configure email field properties
 *
 * Provides configuration options for:
 * - Label: Display text shown above the field
 * - Field Name: Key used in submission data (auto-formatted)
 * - Placeholder: Hint text shown when field is empty
 * - Help Text: Additional guidance shown below the field
 * - Required: Whether the field must be filled
 * - Validation: pattern (optional extra regex), error message
 *
 * Note: Basic email format validation is automatic via HTML5 email input type.
 *
 * @example
 * ```tsx
 * <EmailFieldEditor
 *   field={emailField}
 *   allFields={formFields}
 *   onUpdate={(updates) => handleUpdate(updates)}
 * />
 * ```
 */
export function EmailFieldEditor({
  field,
  onUpdate,
}: FieldEditorProps<EmailFormField>) {
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
    <div className="email-field-editor">
      {/* General Settings Section */}
      <div className="email-field-editor__section">
        <h4 className="email-field-editor__section-title">General</h4>

        {/* Label */}
        <div className="email-field-editor__field">
          <label className="email-field-editor__label" htmlFor="field-label">
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
        <div className="email-field-editor__field">
          <label className="email-field-editor__label" htmlFor="field-name">
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
            className="email-field-editor__input--mono"
          />
          <p className="email-field-editor__hint">
            Used as the key in submission data. Only letters, numbers, and
            underscores.
          </p>
        </div>

        {/* Placeholder */}
        <div className="email-field-editor__field">
          <label
            className="email-field-editor__label"
            htmlFor="field-placeholder"
          >
            Placeholder
          </label>
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="email@example.com"
          />
        </div>

        {/* Help Text */}
        <div className="email-field-editor__field">
          <label className="email-field-editor__label" htmlFor="field-help">
            Help Text
          </label>
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            placeholder="Additional guidance for users"
          />
          <p className="email-field-editor__hint">Displayed below the field</p>
        </div>

        {/* Required */}
        <div className="email-field-editor__field email-field-editor__field--inline">
          <label className="email-field-editor__checkbox-label">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="email-field-editor__checkbox"
            />
            <span>Required field</span>
          </label>
        </div>
      </div>

      {/* Validation Section */}
      <div className="email-field-editor__section">
        <h4 className="email-field-editor__section-title">Validation</h4>

        {/* Info about automatic validation */}
        <div className="email-field-editor__info">
          <p className="email-field-editor__info-text">
            Email format validation is automatic. Use the pattern field below
            for additional restrictions (e.g., corporate domains only).
          </p>
        </div>

        {/* Pattern */}
        <div className="email-field-editor__field">
          <label className="email-field-editor__label" htmlFor="field-pattern">
            Pattern (Regex)
          </label>
          <Input
            id="field-pattern"
            type="text"
            value={field.validation?.pattern || ""}
            onChange={e =>
              updateValidation("pattern", e.target.value || undefined)
            }
            placeholder=".*@company\.com$"
            className="email-field-editor__input--mono"
          />
          <p className="email-field-editor__hint">
            Optional: Additional regex pattern (e.g., restrict to specific
            domains)
          </p>
        </div>

        {/* Error Message */}
        <div className="email-field-editor__field">
          <label className="email-field-editor__label" htmlFor="field-error">
            Error Message
          </label>
          <Input
            id="field-error"
            type="text"
            value={field.validation?.errorMessage || ""}
            onChange={e =>
              updateValidation("errorMessage", e.target.value || undefined)
            }
            placeholder="Please enter a valid email address"
          />
          <p className="email-field-editor__hint">
            Custom message shown when validation fails
          </p>
        </div>
      </div>
    </div>
  );
}

export default EmailFieldEditor;
