"use client";

/**
 * Field Editor Panel Component
 *
 * Right-side panel for editing field properties. Dynamically loads the
 * appropriate field editor component based on field type using React.lazy().
 *
 * Features:
 * - Lazy-loaded field editors for code splitting
 * - Loading skeleton during editor load
 * - Graceful handling of unknown field types
 * - Header with field type icon and label
 * - Close button to dismiss the panel
 *
 * @module admin/components/FieldEditorPanel
 * @since 0.1.0
 */

"use client";

import { X } from "lucide-react";
import React, { Suspense, useMemo } from "react";

import type { FormField } from "../../types";
import {
  getFieldTypeConfig,
  getFieldTypeLabel,
  resolveFieldIcon,
} from "../fields";

// ============================================================================
// Types
// ============================================================================

export interface FieldEditorPanelProps {
  /**
   * The field being edited.
   */
  field: FormField;

  /**
   * All fields in the form (for references, e.g., conditional logic).
   */
  allFields: FormField[];

  /**
   * Callback when field properties are updated.
   * Receives partial updates to merge with current field.
   */
  onUpdate: (updates: Partial<FormField>) => void;

  /**
   * Callback when the panel should be closed.
   */
  onClose: () => void;
}

// ============================================================================
// Loading Skeleton
// ============================================================================

/**
 * Loading skeleton displayed while field editor is being lazy-loaded.
 * Provides visual feedback during the brief loading period.
 */
function EditorSkeleton() {
  return (
    <div className="field-editor-panel__skeleton">
      {/* Label skeleton */}
      <div className="field-editor-panel__skeleton-row">
        <div className="field-editor-panel__skeleton-label" />
        <div className="field-editor-panel__skeleton-input" />
      </div>
      {/* Field name skeleton */}
      <div className="field-editor-panel__skeleton-row">
        <div className="field-editor-panel__skeleton-label" />
        <div className="field-editor-panel__skeleton-input" />
      </div>
      {/* Placeholder skeleton */}
      <div className="field-editor-panel__skeleton-row">
        <div className="field-editor-panel__skeleton-label" />
        <div className="field-editor-panel__skeleton-input" />
      </div>
      {/* Checkbox skeleton */}
      <div className="field-editor-panel__skeleton-row">
        <div className="field-editor-panel__skeleton-checkbox" />
        <div className="field-editor-panel__skeleton-label--short" />
      </div>
    </div>
  );
}

// ============================================================================
// Unknown Field Type Fallback
// ============================================================================

/**
 * Fallback displayed when field type is not recognized.
 * This should rarely happen in practice, but provides a graceful degradation.
 */
function UnknownFieldType({ type }: { type: string }) {
  return (
    <div className="field-editor-panel__unknown">
      <p className="field-editor-panel__unknown-title">Unknown Field Type</p>
      <p className="field-editor-panel__unknown-message">
        The field type <code>{type}</code> is not supported by this version of
        the form builder.
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FieldEditorPanel - Right-side panel for editing field properties
 *
 * This component dynamically loads the appropriate field editor based on
 * the field type. Each field type has its own editor component that handles
 * the specific configuration options for that type.
 *
 * The panel displays:
 * - Header with field type icon, type label, and field label
 * - Close button to dismiss the panel
 * - Lazy-loaded editor content with loading skeleton
 *
 * @example
 * ```tsx
 * <FieldEditorPanel
 *   field={selectedField}
 *   allFields={allFields}
 *   onUpdate={(updates) => updateField(selectedField.name, updates)}
 *   onClose={() => setSelectedField(null)}
 * />
 * ```
 */
export function FieldEditorPanel({
  field,
  allFields,
  onUpdate,
  onClose,
}: FieldEditorPanelProps) {
  // Get field type configuration from registry
  const fieldConfig = getFieldTypeConfig(field.type);

  // Lazily load the editor component based on field type
  // useMemo ensures we don't recreate the lazy component on every render
  const EditorComponent = useMemo(() => {
    if (!fieldConfig) return null;
    return React.lazy(fieldConfig.EditorComponent);
  }, [fieldConfig]);

  // Handle unknown field type
  if (!fieldConfig || !EditorComponent) {
    return (
      <div className="field-editor-panel">
        <div className="field-editor-panel__header">
          <div className="field-editor-panel__title">
            <span className="field-editor-panel__title-text">Edit Field</span>
          </div>
          <button
            type="button"
            className="field-editor-panel__close"
            onClick={onClose}
            aria-label="Close editor panel"
          >
            <X className="field-editor-panel__close-icon" />
          </button>
        </div>
        <div className="field-editor-panel__content">
          <UnknownFieldType type={field.type} />
        </div>
      </div>
    );
  }

  // Resolve the icon component for this field type
  const IconComponent = resolveFieldIcon(fieldConfig.icon);

  // Get display label for field type
  const typeLabel = getFieldTypeLabel(field.type);

  return (
    <div className="field-editor-panel">
      {/* Header */}
      <div className="field-editor-panel__header">
        <div className="field-editor-panel__title">
          <IconComponent
            className="field-editor-panel__title-icon"
            aria-hidden="true"
          />
          <span className="field-editor-panel__title-text">
            Edit {typeLabel} Field
            {field.label && (
              <span className="field-editor-panel__title-label">
                {" "}
                — {field.label}
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          className="field-editor-panel__close"
          onClick={onClose}
          aria-label="Close editor panel"
        >
          <X className="field-editor-panel__close-icon" />
        </button>
      </div>

      {/* Editor Content */}
      <div className="field-editor-panel__content">
        <Suspense fallback={<EditorSkeleton />}>
          <EditorComponent
            field={field}
            allFields={allFields}
            onUpdate={onUpdate}
          />
        </Suspense>
      </div>
    </div>
  );
}

export default FieldEditorPanel;
