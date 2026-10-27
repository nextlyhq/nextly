"use client";

/**
 * Over time: how many entries a collection gained in each day, week or month of the card's range.
 *
 * Drawn from the card's own slot, a timeseries over its range: every interval the range overlaps,
 * the first one counting only what falls inside it. Above the chart, the latest interval's value
 * and the range's total; below it, the dates. By the card's own width: small draws the two
 * figures over a bare line, medium adds its axis and first and last dates, large the dates in
 * between. A line, or one bar per interval when its Chart style asks for bars.
 *
 * @module components/features/dashboard/OverTimeCard
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { pointLabel } from "../widgets/archetypes/timeseries";
import { OverTimeChart } from "../widgets/charts/over-time-chart";
import { FrameState, readSlot } from "../widgets/frame/card-state";

export const OverTimeCard: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  settings,
  onRetry,
}) => {
  const read = readSlot(slot, {
    isFetching,
    skeleton: { shape: "chart" },
    onRetry,
  });
  if ("state" in read) return <FrameState state={read.state} />;
  if (read.result.op !== "timeseries") {
    return (
      <FrameState
        state={{
          kind: "error",
          message:
            "This card was answered with something other than a chart over time.",
        }}
      />
    );
  }
  const { points, interval } = read.result;
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
  return (
    <OverTimeChart
      title="Entries created"
      labelHeading="Interval"
      chartStyle={settings.chartStyle === "bars" ? "bars" : "line"}
      // The instant keys each interval; its label is its UTC calendar start, as the server
      // buckets it, in the admin's date format.
      intervals={points.map(point => ({
        key: point.start,
        label: pointLabel(point.start, interval),
      }))}
      series={[
        {
          key: "created",
          name: "Entries created",
          points: points.map(point => ({
            key: point.start,
            value: point.count,
          })),
        },
      ]}
    />
  );
};

OverTimeCard.displayName = "OverTimeCard";
