/**
 * Hooks Module
 *
 * Exports all custom React hooks for Nextly admin application
 */

// Selection hooks
export { useRowSelection } from "./useRowSelection";
export type {
  UseRowSelectionOptions,
  UseRowSelectionReturn,
} from "../types/hooks/row-selection";

// Bulk mutation hooks
export { useBulkMutation } from "./useBulkMutation";
export type {
  BulkMutationResult,
  BulkMutationOptions,
  BulkMutationItemResult,
  UseBulkMutationReturn,
  UseBulkMutationConfig,
} from "../types/hooks/bulk-mutation";

// Server table hook
export { useServerTable } from "./useServerTable";
export type {
  UseServerTableParams,
  UseServerTableReturn,
} from "./useServerTable";

// Utility hooks - Debouncing
export { useDebounce } from "./useDebounce";
export { useDebouncedValue, useDebouncedState } from "./useDebouncedValue";

// Utility hooks - Form Protection
export { useUnsavedChanges } from "./useUnsavedChanges";
export type {
  UseUnsavedChangesOptions,
  UseUnsavedChangesReturn,
} from "./useUnsavedChanges";

// Utility hooks - Entry Preview
export { useEntryPreview } from "./useEntryPreview";
export type {
  PreviewConfig,
  PreviewCollection,
  UseEntryPreviewOptions,
  UseEntryPreviewResult,
} from "./useEntryPreview";

// Utility hooks - Relationship Inline Create
export { useRelationshipCreate } from "./useRelationshipCreate";
export type {
  CreatedEntry,
  UseRelationshipCreateOptions,
  UseRelationshipCreateReturn,
} from "./useRelationshipCreate";

// Utility hooks - Column Visibility
export { useColumnVisibility } from "./useColumnVisibility";
export type {
  UseColumnVisibilityOptions,
  UseColumnVisibilityReturn,
} from "./useColumnVisibility";

// Utility hooks - Keyboard Shortcuts
export {
  useKeyboardShortcuts,
  useEntryListShortcuts,
  useEntryFormShortcuts,
} from "./useKeyboardShortcuts";
export type {
  Shortcut,
  UseKeyboardShortcutsOptions,
  EntryListShortcutsOptions,
  EntryFormShortcutsOptions,
} from "./useKeyboardShortcuts";

// Utility hooks - Auto-Save & Draft Recovery
export {
  useAutoSave,
  getDraft,
  clearDraftByKey,
  cleanupExpiredDrafts,
} from "./useAutoSave";
export type {
  UseAutoSaveOptions,
  AutoSaveState,
  UseAutoSaveReturn,
} from "./useAutoSave";

export { useDraftRecovery } from "./useDraftRecovery";
export type {
  Draft,
  UseDraftRecoveryOptions,
  UseDraftRecoveryReturn,
} from "./useDraftRecovery";

// Utility hooks - Entry JSON Viewer
export { useEntryJSON, MAX_DEPTH, MIN_DEPTH } from "./useEntryJSON";
export type { UseEntryJSONOptions, UseEntryJSONReturn } from "./useEntryJSON";

// Utility hooks - Sidebar Pins
export { useSidebarPins } from "./useSidebarPins";

// Builder state management
export { useFieldBuilder } from "./useFieldBuilder";
export type {
  UseFieldBuilderOptions,
  UseFieldBuilderReturn,
  FieldBuilderValidationResult,
} from "./useFieldBuilder";
