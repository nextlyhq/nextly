/**
 * `@nextlyhq/admin/kit/plugin-parts`: the plugin-page parts.
 *
 * The parts a plugin's own page is laid out with: segmented choices, the
 * stepper, settings rows, checklists, the file drop area, breadcrumbs, target
 * slots and page containers, and the plugin route hooks.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/plugin-parts
 */
// The trail a page draws in the top bar, the segmented control, the checklist
// with progress and the grouped settings row: the admin's own building blocks,
// re-exported by `@nextlyhq/plugin-sdk/admin` for a plugin's pages.
export { Breadcrumbs } from "../components/shared/breadcrumbs";

export type {
  BreadcrumbItem,
  BreadcrumbsProps,
} from "../components/shared/breadcrumbs";

export { SegmentedChoice } from "../components/ui/segmented-choice";

export type {
  SegmentedChoiceProps,
  SegmentedChoiceSize,
  SegmentedOption,
} from "../components/ui/segmented-choice";

export {
  Checklist,
  ChecklistItem,
  ChecklistMark,
  ChecklistProgress,
} from "../components/shared/checklist";

export type {
  ChecklistProps,
  ChecklistItemProps,
  ChecklistMarkProps,
  ChecklistProgressProps,
  ChecklistStatus,
  ChecklistDoneStyle,
} from "../components/shared/checklist";

export { SettingsRowGroup } from "../components/features/settings/SettingsRowGroup";

export type { SettingsRowGroupProps } from "../components/features/settings/SettingsRowGroup";

// Where a flow of a few steps is, the stepper the email provider setup draws:
// re-exported by `@nextlyhq/plugin-sdk/admin` for a plugin's own flow.
export { Stepper } from "../components/ui/stepper";

export type {
  StepperProps,
  StepperStep,
  StepState,
} from "../components/ui/stepper";

// The drop area a file is dragged onto or chosen from, as the Media library
// draws it: re-exported by `@nextlyhq/plugin-sdk/admin` for a plugin screen
// that reads a file itself, such as an import.
export { FileDropArea } from "../components/ui/file-drop-area";

export type { FileDropAreaProps } from "../components/ui/file-drop-area";

// A plugin's own admin UI reading a route that plugin contributed. The two
// halves of a plugin — its HTTP routes and its admin components — had no way to
// reach each other: the SDK exported no route client, so an author's choice was
// to hand-roll auth and error parsing or to read something else instead.
// Through `protectedApi` and TanStack Query, so the session, its refresh and
// the typed error envelope are the ones the rest of the admin uses.
export {
  readPluginRoute,
  usePluginRoute,
} from "@admin/hooks/queries/usePluginRoute";

export type {
  PluginRouteRead,
  PluginRouteRequest,
} from "@admin/hooks/queries/usePluginRoute";

// The WRITE half of the same seam. A plugin could read its own route and not
// write to it, so a feature that saves something had to hand-roll the session
// and the error envelope after all.
export {
  usePluginRouteMutation,
  writePluginRoute,
} from "@admin/hooks/queries/usePluginRouteMutation";

export type {
  PluginRouteMethod,
  PluginRouteWrite,
  PluginRouteWriter,
  PluginRouteInvalidation,
} from "@admin/hooks/queries/usePluginRouteMutation";

/**
 * Immersive surfaces ask for admin chrome to be hidden while they are mounted.
 * Exported for `plugin-sdk/admin`, which is the only admin surface a plugin (and
 * `@nextlyhq/builder`) may import.
 */
export { useSuppressAdminChrome } from "../components/layout/ChromeSuppression";

export { useFoldedPanel } from "../components/layout/PanelFold";

export { PlaceTabs, TargetSlot } from "../components/shared/target-slot";

export type {
  PlaceContributionProps,
  PlaceProps,
  PlaceTabBadge,
  PlaceTabProps,
  PlaceTabsProps,
  TargetSlotProps,
} from "../components/shared/target-slot";

export type { AdminChromeLayer } from "../components/layout/lib/chrome-suppression";

// Layout Components
export { PageContainer } from "../components/layout/page-container";

export type {
  PageContainerProps,
  PageContainerRef,
} from "../types/layout/page-container";
