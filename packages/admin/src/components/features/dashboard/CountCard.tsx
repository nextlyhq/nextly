"use client";

import type { CountWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { useBranding } from "@admin/context/providers/BrandingProvider";

import { CountValue, countLabel } from "../widgets/archetypes/count-value";
import { pointLabel } from "../widgets/archetypes/timeseries";
import { ChartTableDisclosure } from "../widgets/charts/chart-table-disclosure";
import { useCollectionUnit } from "../widgets/charts/chart-unit";
import { OverTimeChart } from "../widgets/charts/over-time-chart";
import { FrameState } from "../widgets/frame/card-state";
import { CardFigure } from "../widgets/frame/figure";
import { useCardTier } from "../widgets/frame/tier";

import {
  collectionLabelOf,
  countView,
  type CountPart,
} from "./count-card-model";

/** What the Count card is handed: its declaration's props, with the data its `load` answers. */
export type CountCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: CountWidgetData;
};

/**
 * Count: how many entries a collection holds, by the card's own width.
 *
 * Small draws the number alone; medium adds the published and draft split, each part linking to
 * its list under the card's Filter, and what scheduled releases will publish, for a reader with a
 * release to read; large adds the last 30 days, and the change against the 30
 * before, with the days as a table on request ("View as table"). Drawn from the data its `load` answered for the size it was asked at, each part only
 * where it is there: the frame drew loading, no permission and error before this is reached.
 */
export const CountCard: React.FC<CountCardProps> = ({ data, settings }) => {
  const tier = useCardTier() ?? "medium";
  const view = countView(data, settings);
  // Named in the number's accessible name, as the frame's title names it, so
  // two Count cards for different collections can be told apart aloud.
  const collection = collectionLabelOf(settings, useBranding().widgetSources);
  // What its trend counts, for the chart's tooltip ("3 new posts").
  const unit = useCollectionUnit(
    typeof settings.collection === "string" ? settings.collection : undefined,
    "new"
  );

  // A card set to no collection: the frame's one "not available" state.
  if (view.state === "unavailable") {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  // Each day of the trend, keyed by its instant and named by its UTC calendar day.
  const days = (view.trend?.points ?? []).map(point => ({
    key: point.start,
    label: pointLabel(point.start, "day"),
    count: point.count,
  }));

  return (
    <div className="grid gap-3" data-testid="count-card">
      <Link
        href={view.href}
        className="w-fit text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none hover:underline"
        aria-label={`Entries in ${collection}: ${countLabel(view.total)}`}
      >
        <CardFigure value={view.total} tier={tier} />
      </Link>
      {tier !== "small" && view.split && (
        <ul className="grid gap-1" data-testid="count-split">
          <SplitPart label="Published" part={view.split.published} />
          <SplitPart label="Draft" part={view.split.draft} />
          {view.scheduled && (
            <SplitPart label="Scheduled" part={view.scheduled} />
          )}
        </ul>
      )}
      {tier === "large" && view.trend && (
        <div className="grid gap-1" data-testid="count-trend">
          <p className="text-xs text-muted-foreground">
            {trendSentence(view.trend.recent, view.trend.change)}
          </p>
          {/* The same days, as a table, on request: one list of days for both, so the
              chart and the table name each day alike. */}
          <ChartTableDisclosure
            labelHeading="Day"
            rows={days}
            chart={
              <OverTimeChart
                title="Entries created, last 30 days"
                labelHeading="Day"
                unit={unit}
                intervals={days.map(({ key, label }) => ({ key, label }))}
                series={[
                  {
                    key: "created",
                    name: "Entries created",
                    points: days.map(({ key, count }) => ({
                      key,
                      value: count,
                    })),
                  },
                ]}
              />
            }
          />
        </div>
      )}
    </div>
  );
};

/** One part of the split, linking to the list that holds exactly it. */
function SplitPart({ label, part }: { label: string; part: CountPart }) {
  return (
    <li>
      <Link
        href={part.href}
        className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm text-muted-foreground hover-subtle-row hover:text-foreground"
        aria-label={`${label}: ${countLabel(part.count)}`}
      >
        <span>{label}</span>
        <span className="tabular-nums text-foreground">
          <CountValue total={part.count} />
        </span>
      </Link>
    </li>
  );
}

/** "12 created in the last 30 days, 3 more than the 30 before." */
function trendSentence(recent: number, change: number): string {
  const created = `${recent.toLocaleString()} created in the last 30 days`;
  if (change === 0) return `${created}, as many as the 30 before.`;
  const more = change > 0 ? "more" : "fewer";
  return `${created}, ${Math.abs(change).toLocaleString()} ${more} than the 30 before.`;
}
