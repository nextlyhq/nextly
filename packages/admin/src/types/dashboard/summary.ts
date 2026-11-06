/**
 * The dashboard header's summary, as `GET /api/dashboard/summary` answers it:
 * the server's own wire types, read rather than restated, so the two cannot
 * drift.
 *
 * @module types/dashboard/summary
 */
export type {
  DashboardSummary,
  DashboardSummaryEnvironment as DashboardEnvironment,
  DashboardSummaryPart,
} from "nextly/api/dashboard-summary-types";
