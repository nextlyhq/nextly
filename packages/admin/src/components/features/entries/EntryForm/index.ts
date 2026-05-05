/**
 * Entry Form Components
 *
 * Complete entry form system for creating and editing collection entries.
 * Provides both high-level EntryForm component and individual building blocks
 * for custom implementations.
 *
 * @module components/entries/EntryForm
 * @since 1.0.0
 */

// Main component
export { EntryForm, type EntryFormProps } from "./EntryForm";

// Sub-components
export {
  EntryFormProvider,
  type EntryFormProviderProps,
} from "./EntryFormProvider";
export {
  EntrySystemHeader,
  type EntrySystemHeaderProps,
} from "./EntrySystemHeader";
export { EntryMetaStrip, type EntryMetaStripProps } from "./EntryMetaStrip";
export {
  EntryFormContent,
  type EntryFormContentProps,
} from "./EntryFormContent";
export {
  EntryFormSidebar,
  type EntryFormSidebarProps,
} from "./EntryFormSidebar";
export {
  EntryFormActions,
  type EntryFormActionsProps,
} from "./EntryFormActions";

// Hook
export {
  useEntryForm,
  getCollectionFields,
  type UseEntryFormOptions,
  type UseEntryFormReturn,
  type EntryFormMode,
  type EntryFormCollection,
  type EntryFormPreviewConfig,
  type EntryData,
} from "./useEntryForm";

// Guard component
export {
  UnsavedChangesGuard,
  type UnsavedChangesGuardProps,
} from "./UnsavedChangesGuard";

// Error summary component
export {
  FormErrorSummary,
  type FormErrorSummaryProps,
} from "./FormErrorSummary";

// Auto-save & Draft Recovery components
export {
  DraftRecoveryDialog,
  type DraftRecoveryDialogProps,
} from "./DraftRecoveryDialog";

export {
  AutoSaveIndicator,
  type AutoSaveIndicatorProps,
} from "./AutoSaveIndicator";

// Show JSON dialog
export { ShowJSONDialog, type ShowJSONDialogProps } from "./ShowJSONDialog";

// Entry context (for virtual fields like JoinField)
export {
  EntryFormContextProvider,
  useEntryFormContext,
  useOptionalEntryFormContext,
  type EntryFormContextValue,
  type EntryFormContextProviderProps,
} from "./EntryFormContext";
