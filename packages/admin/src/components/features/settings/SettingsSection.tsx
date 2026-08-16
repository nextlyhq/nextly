/**
 * Retained as a re-export so the existing call sites, several of which are
 * form pages, keep importing the path they already use while the
 * implementation moves to the shared package. New code imports FormSection
 * from "@nextlyhq/ui" directly.
 */
export { FormSection as SettingsSection } from "@nextlyhq/ui";
export type { FormSectionProps as SettingsSectionProps } from "@nextlyhq/ui";
