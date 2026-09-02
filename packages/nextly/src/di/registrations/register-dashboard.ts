/**
 * Dashboard / admin surface DI registrations.
 *
 * Registers three cross-cutting admin services that aren't tied to a
 * single content domain:
 * - GeneralSettingsService — CRUD for the `site_settings` singleton row.
 * - ActivityLogService — records and queries content mutation events.
 *   Used by the global activity-log hooks (fire-and-forget writes) and
 *   the dashboard API.
 * - DashboardService — aggregates content stats, recent entries, and
 *   project metrics via read-only adapter queries.
 * - WidgetLayoutService — reads and writes one reader's dashboard
 *   arrangement. Registered here rather than beside the widget REGISTRY,
 *   which is a `globalThis`-pinned store with no container entry at all
 *   (`registrations/register-widgets.ts` explains why): this one is an
 *   ordinary adapter-backed service and belongs with the other admin-surface
 *   services its endpoint sits beside.
 */

import { ActivityLogService } from "../../services/dashboard/activity-log-service";
import { DashboardService } from "../../services/dashboard/dashboard-service";
import { GeneralSettingsService } from "../../services/general-settings/general-settings-service";
import { WidgetLayoutService } from "../../services/widgets/widget-layout-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerDashboardServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  container.registerSingleton<GeneralSettingsService>(
    "generalSettingsService",
    () => new GeneralSettingsService(adapter, logger)
  );

  container.registerSingleton<ActivityLogService>(
    "activityLogService",
    () => new ActivityLogService(adapter, logger)
  );

  container.registerSingleton<DashboardService>(
    "dashboardService",
    () => new DashboardService(adapter, logger)
  );

  container.registerSingleton<WidgetLayoutService>(
    "widgetLayoutService",
    () => new WidgetLayoutService(adapter, logger)
  );
}
