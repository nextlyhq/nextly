/**
 * Schema Builder - Builder components and field type editors
 *
 * This module contains:
 * - Collection/Component/Single builder components (FieldEditor, FieldList, etc.)
 * - Field type editors (text, number, select, etc.)
 * - Form builders and utilities
 */

// Builder Components
export { RepeaterFieldEditor } from "./RepeaterFieldEditor";
export type { BreadcrumbItem } from "@admin/components/shared";
export { ComponentFieldEditor } from "./ComponentFieldEditor";
export { GroupFieldEditor } from "./GroupFieldEditor";
export { HooksEditor, getPrebuiltHook } from "./HooksEditor";
export { SelectOptionsEditor } from "./SelectOptionsEditor";
export { RelationshipEditor } from "./RelationshipEditor";
export { UploadEditor } from "./UploadEditor";
export { SchemaChangeDialog } from "./SchemaChangeDialog";
export { SafeChangeConfirmDialog } from "./SafeChangeConfirmDialog";

// Builder UI/UX redesign — new shared components (PR 1).
export { BuilderSettingsModal } from "./BuilderSettingsModal";
export type { BuilderSettingsValues } from "./BuilderSettingsModal";
export { FieldPickerModal } from "./FieldPickerModal";
export { FieldEditorSheet } from "./FieldEditorSheet";
export { BuilderToolbar } from "./BuilderToolbar";
export { BuilderFieldList } from "./BuilderFieldList";
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
