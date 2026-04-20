/**
 * Form Builder Admin Components
 *
 * Entry point for admin UI components used by the Nextly admin panel.
 * These components are referenced via component paths in collection configs.
 *
 * Component paths use the format: "@revnixhq/plugin-form-builder/admin#ExportName"
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
  registerKnownPlugin,
  type ComponentPath,
} from "@revnixhq/admin/lib/component-registry";

import { SubmissionsFilter } from "./components/SubmissionsFilter";
import { FormBuilderView } from "./FormBuilderView";

export { FormBuilderView, type FormBuilderViewProps } from "./FormBuilderView";
export {
  SubmissionsFilter,
  type SubmissionsFilterProps,
} from "./components/SubmissionsFilter";

// ============================================================================
// Builder Sub-Components
// ============================================================================

export {
  FieldLibrary,
  FormCanvas,
  FieldEditor,
  FormPreview,
  type FormCanvasProps,
  type FieldEditorProps,
  type FormPreviewProps,
} from "./components/builder";

// ============================================================================
// New Task 3.5 Components
// ============================================================================

export {
  FormFieldList,
  type FormFieldListProps,
  SortableFieldRow,
  type SortableFieldRowProps,
  AddFieldButton,
  type AddFieldButtonProps,
  FieldEditorPanel,
  type FieldEditorPanelProps,
} from "./components";

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

// ============================================================================
// Submission Components
// ============================================================================

export {
  SubmissionList,
  SubmissionDetail,
  type SubmissionListProps,
  type SubmissionDetailProps,
} from "../components/submissions";

/** Component path for FormBuilderView */
export const FORM_BUILDER_VIEW_PATH: ComponentPath =
  "@revnixhq/plugin-form-builder/admin#FormBuilderView";

/** Component path for SubmissionsFilter */
export const SUBMISSIONS_FILTER_PATH: ComponentPath =
  "@revnixhq/plugin-form-builder/admin#SubmissionsFilter";

/**
 * Register Form Builder admin components with the Nextly admin panel.
 *
 * @deprecated This function is no longer needed. Components are auto-registered
 * when the admin detects the Form Builder plugin's component paths in collection configs.
 *
 * @example
 * ```typescript
 * // No manual registration needed! Just add the plugin to your config:
 * export default defineConfig({
 *   plugins: [formBuilderPlugin.plugin],
 * });
 * ```
 */
export function registerFormBuilderAdminComponents(): void {
  registerComponents({
    [FORM_BUILDER_VIEW_PATH]: FormBuilderView,
  });
}

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
  [SUBMISSIONS_FILTER_PATH]: SubmissionsFilter,
});

/**
 * Also register with the known plugin system for consistency.
 *
 * This supports the auto-registration flow where the admin detects
 * component paths and triggers registration. Since we eagerly register
 * above, this callback is effectively a no-op but keeps the plugin
 * compatible with both eager and lazy registration patterns.
 */
registerKnownPlugin("@revnixhq/plugin-form-builder", async () => {
  // Components already registered above, but re-register for safety
  registerComponents({
    [FORM_BUILDER_VIEW_PATH]: FormBuilderView,
    [SUBMISSIONS_FILTER_PATH]: SubmissionsFilter,
  });
});
