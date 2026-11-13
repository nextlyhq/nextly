/**
 * `@nextlyhq/admin/kit/widgets`: the dashboard and widget kit.
 *
 * The parts core's own dashboard cards are drawn from, the dashboard's stat
 * parts, and the widget clock.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/widgets
 */
// Dashboard Components
export { StatsCard } from "../components/features/dashboard/StatsCard";

export { WelcomeHeader } from "../components/features/dashboard/WelcomeHeader";

export { ContentStatsGrid } from "../components/features/dashboard/ContentStatsGrid";

export { ContentStatusWidget } from "../components/features/dashboard/ContentStatusWidget";

export { ProjectStatsGrid } from "../components/features/dashboard/ProjectStatsGrid";

export {
  StatsGridSkeleton,
  ActivitySkeleton,
  RecentEntriesSkeleton,
  ContentStatusSkeleton,
  CollectionQuickLinksSkeleton,
  ProjectStatsSkeleton,
  DashboardPageSkeleton,
} from "../components/features/dashboard/DashboardSkeleton";

// Dashboard Types
export type {
  ContentStats,
  ContentStatus,
  CollectionCount,
  DashboardStats,
  StatsCardProps,
} from "../types/dashboard/stats";

export type {
  Activity,
  ActivityType,
  ActivityCategory,
  ActivityUser,
  RecentActivityResponse,
} from "../types/dashboard/activity";

export type {
  RecentEntry,
  RecentEntriesResponse,
} from "../types/dashboard/recent-entries";

export type { ProjectStatItem } from "../types/dashboard/project-stats";

// The widget kit: the parts core's own dashboard cards are drawn from, for a
// widget's own component. Plugins reach them only through
// `@nextlyhq/plugin-sdk/admin`, so the admin stays the host's single copy and
// a card part reads the tier of the card it is drawn in.
// @experimental while the dashboard widget SDK settles.
export {
  type CardEmptyContent,
  type SkeletonShape,
} from "../components/features/widgets/frame/states";

export {
  FrameState,
  type CardState,
  type SkeletonHint,
} from "../components/features/widgets/frame/card-state";

// The parts of a card's body, under the names a plugin uses: `Widget.*`. The formatters and the
// colour accessor are the SDK root's, from `@nextlyhq/ui`'s server-safe entries.
export {
  Widget,
  type WidgetBarChartGroup,
  type WidgetBarChartProps,
  type WidgetChartUnit,
  type WidgetFigureProps,
  type WidgetKit,
  type WidgetListProps,
  type WidgetListTotal,
  type WidgetRowAction,
  type WidgetSeries,
  type WidgetSeriesChartProps,
  type WidgetSeriesInterval,
  type WidgetSeriesPoint,
  type WidgetTableColumn,
  type WidgetTableProps,
} from "../components/features/widgets/kit";

export type { WidgetRenderSize } from "nextly/widget-result";

// A row's time as core's list cards word it ("5m ago", then the date in the
// admin's timezone and date format), and the clock those cards re-render on,
// so a widget's own list words and moves its times as theirs do.
export { formatRelativeTime as formatWidgetTime } from "../lib/dashboard";

export { useNowTick as useWidgetClock } from "../hooks/useNowTick";

// Asks the dashboard's cards and header summary again, for a widget whose own
// write changes what they answer.
export { useRefreshDashboard } from "../hooks/queries/useRefreshDashboard";
