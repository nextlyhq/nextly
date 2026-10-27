/**
 * The `timeseries` archetype: a count per interval, as a line.
 *
 * A line, because 2D position along a shared baseline is read accurately and
 * because the intervals are ORDERED — bars would draw the same numbers while
 * saying nothing about the sequence, which is the whole question a timeline
 * asks. A soft fill under the line gives the shape a body without encoding a
 * second thing in colour.
 *
 * `preserveAspectRatio="none"` with a fixed viewBox, so the chart stretches to
 * whatever width the card has. The stroke is drawn with
 * `vector-effect="non-scaling-stroke"` for that reason: without it a stretched
 * viewBox scales the stroke horizontally too, and the line thins and thickens
 * with the card's width.
 *
 * @module components/features/widgets/archetypes/timeseries
 */

import { formatGlobalDateTime } from "@admin/lib/dates/format";

import { OverTimeChart } from "../charts/over-time-chart";

import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * How each interval's start is written.
 *
 * Pinned to UTC, and this is the correctness point rather than a preference.
 * The server buckets in UTC, so a point IS a UTC calendar hour, day, week,
 * month or year. Rendering that instant in another zone renames the bucket: a
 * UTC day beginning at midnight is 19:00 the PREVIOUS day at UTC-5, so the axis
 * would label March 4th's rows "Mar 3" while the table beside it and the
 * server both call it the 4th.
 *
 * The install's locale and date-format preferences still apply, because this
 * goes through the same formatter every other admin date does — only the zone
 * is fixed.
 */
const LABEL_OPTIONS: Record<string, Intl.DateTimeFormatOptions> = {
  hour: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  day: { day: "numeric", month: "short" },
  week: { day: "numeric", month: "short" },
  month: { month: "short", year: "numeric" },
  year: { year: "numeric" },
};

export function pointLabel(start: string, interval: string): string {
  const options = LABEL_OPTIONS[interval] ?? LABEL_OPTIONS.day;
  // The raw value is the fallback, so an unparseable instant reaches the reader
  // as evidence rather than as an em dash claiming the interval has nothing.
  return formatGlobalDateTime(start, { ...options, timeZone: "UTC" }, start);
}

export const timeseriesAccepts: ArchetypeAccepts = definition => {
  if (definition.query) return undefined;
  const name = definition.title ?? "This timeseries widget";
  return `"${name}" is drawn from a query, and this widget declares none.`;
};

export const timeseriesBody: ArchetypeBody = (result, definition) => {
  if (result.op !== "timeseries") {
    return {
      ok: false,
      message: `"${definition.title}" expected a timeline, but the query returned a ${result.op}.`,
    };
  }

  const rows = result.points.map(point => ({
    // The instant, not the label: two intervals can format identically at a
    // coarse label while being different points.
    key: point.start,
    label: pointLabel(point.start, result.interval),
    count: point.count,
  }));

  if (rows.length === 0) {
    // The frame's one empty state, worded for a chart over time. Source-neutral: the card may read any
    // collection's, system's or plugin's data, so it names no kind of row it cannot know.
    return {
      ok: true,
      empty: {
        title: "Nothing to plot yet",
        detail: "Points appear here once there is activity in this period.",
      },
    };
  }

  return {
    ok: true,
    // The chart draws the line, its axis, its latest point and its words; this adapter only
    // reads the one series out of the answer, its intervals named in UTC.
    node: (
      <OverTimeChart
        title={definition.title ?? "Over time"}
        labelHeading="Interval"
        intervals={rows.map(row => ({ key: row.key, label: row.label }))}
        series={[
          {
            key: "count",
            name: definition.title ?? "Over time",
            points: rows.map(row => ({ key: row.key, value: row.count })),
          },
        ]}
      />
    ),
  };
};
