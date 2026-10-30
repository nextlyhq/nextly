"use client";

/**
 * Over time: how many entries a collection gained in each day, week or month of the card's range,
 * and the same values as a table on request ("View as table").
 *
 * Drawn from the data its `load` answers, a series over its range: every interval the range
 * overlaps, the first one counting only what falls inside it. Above the chart, the latest
 * interval's value and the range's total; below it, the dates. By the card's own width: small
 * draws the two figures over a bare line, medium adds its axis and first and last dates, large the
 * dates in between. A line, or one bar per interval when its Chart style asks for bars. The frame
 * drew loading, no permission and error before this is reached.
 *
 * @module components/features/dashboard/OverTimeCard
 */

import type { OverTimeWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { pointLabel } from "../widgets/archetypes/timeseries";
import { ChartTableDisclosure } from "../widgets/charts/chart-table-disclosure";
import { useCollectionUnit } from "../widgets/charts/chart-unit";
import { OverTimeChart } from "../widgets/charts/over-time-chart";
import { FrameState } from "../widgets/frame/card-state";

/** What the Over time card is handed: its declaration's props, with the data its `load` answers. */
export type OverTimeCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: OverTimeWidgetData;
};

export const OverTimeCard: React.FC<OverTimeCardProps> = ({
  data,
  settings,
}) => {
  // What it counts, for the chart's tooltip ("12 new posts"), asked before any early answer as
  // a hook must be.
  const unit = useCollectionUnit(
    typeof settings.collection === "string" ? settings.collection : undefined,
    "new"
  );
  const { points, interval } = data;
  // A range with no entries still draws its intervals, each at zero: an empty interval counts
  // as zero. Only an answer with no intervals at all has nothing to plot.
  if (points.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: "Nothing to plot yet",
            detail: "Entries created in this collection show here.",
          },
        }}
      />
    );
  }
  // The instant keys each interval; its label is its UTC calendar start, as the server buckets
  // it, in the admin's date format. One list for the chart and the table, so both name the same
  // intervals in the same words.
  const intervals = points.map(point => ({
    key: point.start,
    label: pointLabel(point.start, interval),
    count: point.count,
  }));
  return (
    <ChartTableDisclosure
      labelHeading="Interval"
      rows={intervals}
      chart={
        <OverTimeChart
          title="Entries created"
          labelHeading="Interval"
          chartStyle={settings.chartStyle === "bars" ? "bars" : "line"}
          {...(unit === undefined ? {} : { unit })}
          intervals={intervals.map(({ key, label }) => ({ key, label }))}
          series={[
            {
              key: "created",
              name: "Entries created",
              points: intervals.map(({ key, count }) => ({
                key,
                value: count,
              })),
            },
          ]}
        />
      }
    />
  );
};

OverTimeCard.displayName = "OverTimeCard";
