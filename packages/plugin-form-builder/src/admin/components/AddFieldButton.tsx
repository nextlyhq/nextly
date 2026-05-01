"use client";

/**
 * Add Field Button Component
 *
 * A button that opens a modal dialog for selecting field types to add to a form.
 * Displays fields grouped by category (Core, Location) with icons and descriptions.
 *
 * Features:
 * - Modal dialog with field type selection
 * - Fields grouped by category
 * - Icon, label, and description for each field type
 * - Keyboard accessible
 * - Auto-closes on selection
 *
 * @module admin/components/AddFieldButton
 * @since 0.1.0
 */

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@revnixhq/ui";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

import type { FormField, FormFieldType } from "../../types";
import {
  createFieldFromType,
  FIELD_CATEGORIES,
  getFieldTypesByCategory,
  resolveFieldIcon,
  type FieldTypeConfig,
} from "../fields";

// ============================================================================
// Types
// ============================================================================

export interface AddFieldButtonProps {
  /**
   * Callback when a new field is created.
   * Receives the newly created FormField instance.
   */
  onAddField: (field: FormField) => void;

  /**
   * Whether the button is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Additional CSS class names for the button.
   */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * AddFieldButton renders a button that opens a modal for selecting field types.
 *
 * When a field type is selected, a new field instance is created with default
 * configuration and passed to the onAddField callback. The modal automatically
 * closes after selection.
 *
 * @example
 * ```tsx
 * <AddFieldButton
 *   onAddField={(field) => {
 *     setFields([...fields, field]);
 *   }}
 * />
 * ```
 */
export function AddFieldButton({
  onAddField,
  disabled = false,
  className,
}: AddFieldButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get fields grouped by category
  const fieldsByCategory = getFieldTypesByCategory();

  /**
   * Handle field type selection.
   * Creates a new field and calls the callback.
   */
  const handleSelectField = useCallback(
    (type: FormFieldType) => {
      const newField = createFieldFromType(type);
      onAddField(newField);
      setIsOpen(false);
    },
    [onAddField]
  );

  // Build button class names
  const buttonClassName = [
    "add-field-button",
    disabled && "add-field-button--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        aria-label="Add a new field to the form"
      >
        <Plus className="add-field-button__icon" aria-hidden="true" />
        <span className="add-field-button__label">Add Field</span>
      </button>

      {/* Field Selection Modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent size="md" className="add-field-modal">
          <DialogHeader>
            <DialogTitle>Add Field</DialogTitle>
            <DialogDescription>
              Select a field type to add to your form.
            </DialogDescription>
          </DialogHeader>

          <div className="add-field-modal__content">
            {FIELD_CATEGORIES.map(category => {
              const fields = fieldsByCategory[category.key] || [];
              if (fields.length === 0) return null;

              return (
                <div key={category.key} className="add-field-modal__category">
                  <h4 className="add-field-modal__category-title">
                    {category.label}
                  </h4>
                  <p className="add-field-modal__category-description">
                    {category.description}
                  </p>

                  <div className="add-field-modal__field-grid">
                    {fields.map(fieldConfig => (
                      <FieldTypeButton
                        key={fieldConfig.type}
                        config={fieldConfig}
                        onClick={() => handleSelectField(fieldConfig.type)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// Field Type Button (Internal)
// ============================================================================

interface FieldTypeButtonProps {
  config: FieldTypeConfig;
  onClick: () => void;
}

/**
 * Individual field type button displayed in the modal.
 * Shows icon, label, and description.
 */
function FieldTypeButton({ config, onClick }: FieldTypeButtonProps) {
  const IconComponent = resolveFieldIcon(config.icon);

  return (
    <button
      type="button"
      className="add-field-modal__field-button"
      onClick={onClick}
      aria-label={`Add ${config.label} field`}
    >
      <span className="add-field-modal__field-icon" aria-hidden="true">
        <IconComponent className="add-field-modal__icon" />
      </span>
      <span className="add-field-modal__field-info">
        <span className="add-field-modal__field-label">{config.label}</span>
        <span className="add-field-modal__field-description">
          {config.description}
        </span>
      </span>
    </button>
  );
}

export default AddFieldButton;
