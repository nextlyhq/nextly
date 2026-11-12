/**
 * Form Builder Admin Components
 *
 * Entry point for admin UI components used by the Nextly admin panel.
 * These components are referenced via component paths in collection configs.
 *
 * Component paths use the format: "@nextlyhq/plugin-form-builder/admin#ExportName"
 *
 * ## Auto-Registration
 *
 * This module automatically registers its components with the admin panel
 * when imported. No manual registration is required - just add the plugin
 * to your Nextly config and the admin will detect and load the components.
 *
 * @module admin
 * @since 0.1.0
 */

// ============================================================================
// Main View Components
// ============================================================================

// ============================================================================
// Component Registration
// ============================================================================

import {
  registerComponents,
  type ComponentPath,
} from "@nextlyhq/plugin-sdk/admin";

import { FORM_EDITOR_VIEW } from "../form-pages";

import { SubmissionsView } from "./components/submissions/SubmissionsView";
import { FormBuilderView } from "./FormBuilderView";

export { FormBuilderView, type FormBuilderViewProps } from "./FormBuilderView";
export { SubmissionsView } from "./components/submissions/SubmissionsView";
export { SubmissionSheet } from "./components/submissions/SubmissionSheet";

// ============================================================================
// Dashboard Widgets
// ============================================================================

// The New form submissions card's body, at the path its widget declares
// ("@nextlyhq/plugin-form-builder/admin#NewSubmissionsCard"). A site's
// generated component map imports it from here.
export { NewSubmissionsCard } from "../dashboard/NewSubmissionsCard";

// ============================================================================
// Builder Sub-Components
// ============================================================================

export {
  FieldCards,
  FormPreview,
  type FieldCardsProps,
  type FormPreviewProps,
} from "./components/builder";

// ============================================================================
// Context & Hooks
// ============================================================================

export {
  FormBuilderProvider,
  useFormBuilder,
  useOptionalFormBuilder,
  createFieldFromType,
  createNotification,
  generateFieldName,
  generateFieldLabel,
  DEFAULT_SETTINGS,
  type FormBuilderState,
  type FormBuilderActions,
  type FormBuilderContextValue,
  type FormBuilderProviderProps,
  type FormSettings,
  type FormNotification,
} from "./context/FormBuilderContext";

// ============================================================================
// Tab Components
// ============================================================================

export { FormSettingsTab } from "./components/builder/FormSettingsTab";
export { FormNotificationsTab } from "./components/builder/FormNotificationsTab";

/** Component path for FormBuilderView */
export const FORM_BUILDER_VIEW_PATH: ComponentPath = FORM_EDITOR_VIEW;

/** Component path for SubmissionsView */
export const SUBMISSIONS_VIEW_PATH: ComponentPath =
  "@nextlyhq/plugin-form-builder/admin#SubmissionsView";

// ============================================================================
// Auto-Registration with Admin
// ============================================================================

/**
 * Eagerly register components at module load time.
 *
 * This ensures components are available immediately when the admin
 * tries to resolve them, without needing to wait for async registration.
 */
registerComponents({
  [FORM_BUILDER_VIEW_PATH]: FormBuilderView,
  [SUBMISSIONS_VIEW_PATH]: SubmissionsView,
});
