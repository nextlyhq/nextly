/**
 * What the widget declaration publishes, gathered for the package root.
 *
 * One list, so the root's export block names a module rather than five, and a
 * reader finds the whole public surface of declared widgets in one place.
 * Everything here is `@experimental`.
 *
 * @module domains/widgets/declaration/public
 */

export {
  defineWidget,
  type AnyWidget,
  type ContentQuery,
  type WidgetAccess,
  type WidgetComponentMap,
  type WidgetData,
  type WidgetDataInput,
  type WidgetEmpty,
  type WidgetPreviewCase,
  type WidgetProps,
  type WidgetReadServices,
  type WidgetRenderSize,
  type WidgetSummary,
} from "./define-widget";
export type {
  AdminDashboardConfig,
  CoreWidgetId,
  DashboardContribution,
  DefaultLayoutCard,
  WidgetOverride,
  WidgetRef,
} from "./dashboard";
export type {
  ComponentDisplay,
  CoreDisplay,
  CoreView,
  WidgetDisplay,
  WidgetView,
} from "./displays";
export {
  settings,
  type ChartStyle,
  type DateRange,
  type WidgetFilter,
} from "./setting-builders";
