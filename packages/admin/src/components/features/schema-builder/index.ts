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
export { BuilderReadOnlyNotice } from "./BuilderReadOnlyNotice";
export { BuilderFieldList } from "./BuilderFieldList";
export { SchemaBuilderSlots } from "./SchemaBuilderSlots";

// The builder pages themselves: the frame the three kinds share, the overlays
// it mounts, the schema-change confirmation, and the screens shown instead of
// the builder while the entity is missing, loading or unreachable.
export { BuilderPageLayout } from "./BuilderPageLayout";
export { BuilderOverlays } from "./BuilderOverlays";
export type { ActiveOverlay } from "./BuilderOverlays";
export { BuilderSchemaChangeDialogs } from "./BuilderSchemaChangeDialogs";
export {
  BuilderNotFoundScreen,
  BuilderLoadingScreen,
  BuilderErrorScreen,
} from "./BuilderPageStates";
export type {
  BuilderConfig,
  BuilderKind,
  BasicsField,
  AdvancedField,
} from "./builder-config";

export * from "./types";
