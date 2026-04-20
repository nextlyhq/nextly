/**
 * Admin Components
 *
 * Exports all admin UI components for the form builder.
 * These are the new Task 3.5 components that will replace
 * the original builder/ components.
 *
 * @module admin/components
 * @since 0.1.0
 */

// ---------------------------------------------------------------------------
// Form Field List (Task 3.5.2)
// ---------------------------------------------------------------------------

export { FormFieldList, type FormFieldListProps } from "./FormFieldList";

// ---------------------------------------------------------------------------
// Sortable Field Row (Task 3.5.3)
// ---------------------------------------------------------------------------

export {
  SortableFieldRow,
  type SortableFieldRowProps,
} from "./SortableFieldRow";

// ---------------------------------------------------------------------------
// Add Field Button (Task 3.5.4)
// ---------------------------------------------------------------------------

export { AddFieldButton, type AddFieldButtonProps } from "./AddFieldButton";

// ---------------------------------------------------------------------------
// Field Editor Panel (Task 3.5.5)
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
