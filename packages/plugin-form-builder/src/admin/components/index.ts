/**
 * Admin Components
 *
 * Exports all admin UI components for the form builder.
 *
 * @module admin/components
 * @since 0.1.0
 */

// ---------------------------------------------------------------------------
// Form Field List
// ---------------------------------------------------------------------------

export { FormFieldList, type FormFieldListProps } from "./FormFieldList";

// ---------------------------------------------------------------------------
// Sortable Field Row
// ---------------------------------------------------------------------------

export {
  SortableFieldRow,
  type SortableFieldRowProps,
} from "./SortableFieldRow";

// ---------------------------------------------------------------------------
// Add Field Button
// ---------------------------------------------------------------------------

export { AddFieldButton, type AddFieldButtonProps } from "./AddFieldButton";

// ---------------------------------------------------------------------------
// Field Editor Panel
// ---------------------------------------------------------------------------

export {
  FieldEditorPanel,
  type FieldEditorPanelProps,
} from "./FieldEditorPanel";

// ---------------------------------------------------------------------------
// Builder Components (Legacy - to be deprecated)
// ---------------------------------------------------------------------------

export {
  FieldLibrary,
  FormCanvas,
  FieldEditor,
  FormPreview,
  ConditionalLogicEditor,
  type FormCanvasProps,
  type FieldEditorProps,
  type FormPreviewProps,
  type ConditionalLogicEditorProps,
} from "./builder";
