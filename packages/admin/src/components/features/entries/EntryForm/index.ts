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

// Document lock: the banner and the claim behind it, for every editor of a
// document rather than only this form. A custom edit view replaces the FORM,
// not the facts about the document, and it reaches these through the same
// barrel the form does.
export {
  DocumentLockBanner,
  type DocumentLockBannerProps,
} from "./DocumentLockBanner";
export {
  useDocumentLockSurface,
  type DocumentLockSurface,
} from "./useDocumentLockSurface";

// Show JSON dialog
export { ShowJSONDialog, type ShowJSONDialogProps } from "./ShowJSONDialog";

// Entry context (provides entryId and collectionSlug to nested field components)
export {
  EntryFormContextProvider,
  useEntryFormContext,
  useOptionalEntryFormContext,
  type EntryFormContextValue,
  type EntryFormContextProviderProps,
} from "./EntryFormContext";
