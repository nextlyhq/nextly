/**
 * Schema Builder - Builder components and field type editors
 *
 * This module contains:
 * - Collection/Component/Single builder components (FieldEditor, FieldList, etc.)
 * - Field type editors (text, number, select, etc.)
 * - Form builders and utilities
 */

// Builder Components
export { ArrayFieldEditor } from "./ArrayFieldEditor";
export { BuilderHeader } from "./BuilderHeader";
export { BuilderPageTemplate } from "./BuilderPageTemplate";
export type {
  BuilderPageTemplateProps,
  BreadcrumbItem,
} from "./BuilderPageTemplate";
export { FieldPalette } from "./FieldPalette";
export { FieldList } from "./FieldList";
export { FieldEditor } from "./FieldEditor";
export { ComponentFieldEditor } from "./ComponentFieldEditor";
export { GroupFieldEditor } from "./GroupFieldEditor";
export { HooksEditor, getPrebuiltHook } from "./HooksEditor";
export { SelectOptionsEditor } from "./SelectOptionsEditor";
export { RelationshipEditor } from "./RelationshipEditor";
export { UploadEditor } from "./UploadEditor";
export { BuilderSettings } from "./BuilderSettings";
export { BuilderPageHeader } from "./BuilderPageHeader";
export { BuilderSidebar } from "./BuilderSidebar";
export { SchemaChangeDialog } from "./SchemaChangeDialog";
// Task 11: new dialogs and badges for the schema change flow.
export { SafeChangeConfirmDialog } from "./SafeChangeConfirmDialog";
export {
  CollectionSourceBadge,
  type CollectionSource,
} from "./CollectionSourceBadge";

// Builder UI/UX redesign — new shared components (PR 1).
export { BuilderSettingsModal } from "./BuilderSettingsModal";
export type { BuilderSettingsValues } from "./BuilderSettingsModal";
export { FieldPickerModal } from "./FieldPickerModal";
export { FieldEditorSheet } from "./FieldEditorSheet";
export { BuilderToolbar } from "./BuilderToolbar";
export { BuilderFieldList } from "./BuilderFieldList";
export { HooksEditorSheet } from "./HooksEditorSheet";
export type {
  BuilderConfig,
  BuilderKind,
  BasicsField,
  AdvancedField,
} from "./builder-config";

export * from "./types";

// Field Type Editors
export * from "./field-types/BooleanFieldEditor";
export * from "./field-types/DatePickerFieldEditor";
export * from "./field-types/EmailFieldEditor";
export * from "./field-types/NumberFieldEditor";
export * from "./field-types/PasswordFieldEditor";
export * from "./field-types/RadioFieldEditor";
export * from "./field-types/RelationFieldEditor";
export * from "./field-types/SelectFieldEditor";
export * from "./field-types/TextAreaFieldEditor";
export * from "./field-types/TextFieldEditor";
export * from "./field-types/UserFieldEditor";

// Re-export field-types subdirectory
export * from "./field-types/shared/ValidationPatternField";
