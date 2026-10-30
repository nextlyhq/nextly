/**
 * The dashboard header's summary as `GET /api/dashboard/summary` answers it:
 * the parts the reader has something in, how many parts could not be read, and
 * the environment the site names. Types only, published on their own subpath
 * so the admin reads the server's shape rather than restating it.
 *
 * @module api/dashboard-summary-types
 */
import type { AdminEnvironmentTone } from "../shared/types/config";

/** One part of the summary line, before it is worded. */
export type DashboardSummaryPart =
  | {
      readonly kind: "attention";
      readonly count: number;
      /** The count is a floor: more are waiting than the source counts. */
      readonly atLeast?: true;
      /**
       * Where the most urgent item goes, relative to the admin: the line's
       * link when the Needs attention card is not on the reader's dashboard.
       */
      readonly link?: string;
    }
  | {
      readonly kind: "releases";
      readonly count: number;
      readonly atLeast?: true;
      /** When the soonest of them is due, as an ISO instant. */
      readonly nearest: string;
    }
  | {
      readonly kind: "widget";
      /** The widget whose `summary` this is, and the card of it on the dashboard. */
      readonly widget: string;
      readonly card: string;
      readonly label: string;
      readonly count: number;
    };

/** How the site marks its environment: the badge's label and tone. */
export interface DashboardSummaryEnvironment {
  readonly label: string;
  readonly tone: AdminEnvironmentTone;
}

export interface DashboardSummary {
  readonly parts: readonly DashboardSummaryPart[];
  /** How many parts could not be read: none means the line is the whole truth. */
  readonly failed: number;
  readonly environment?: DashboardSummaryEnvironment;
}
