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

import { cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";

import { ChartFrame } from "./chart-frame";
import { areaPath, linePath, linePoints, type ChartBox } from "./chart-scale";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * The user units the line is drawn in.
 *
 * Arbitrary, and deliberately so: the SVG scales to the card, so these decide
 * the shape's proportions rather than its size. The padding keeps a 2px stroke
 * off the edges of the viewBox, which would otherwise clip it in half.
 */
const BOX: ChartBox = { width: 240, height: 64, padding: 3 };

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

function pointLabel(start: string, interval: string): string {
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

  const counts = result.points.map(point => point.count);
  const points = linePoints(counts, BOX);
  const line = linePath(points);
  const area = areaPath(points, BOX.height - BOX.padding);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const busiest = rows.reduce((best, row) =>
    row.count > best.count ? row : best
  );

  // Only the ends are labelled on the axis. Thirty labels do not fit under a
  // card-width chart, and thinning them to every nth point makes which dates
  // appear depend on the window length. The table carries every one.
  const last = rows[rows.length - 1];

  // Composed ONCE and handed to both the frame and the graphic, so the table's
  // caption and the chart's own description cannot describe different data.
  const description = `${rows.length} ${result.interval} intervals, ${cardNumber(total).label} in total. Busiest: ${busiest.label}, ${cardNumber(busiest.count).label}.`;

  return {
    ok: true,
    node: (
      <ChartFrame
        title={definition.title ?? "Over time"}
        description={description}
        labelHeading="Interval"
        rows={rows}
      >
        {({ titleId, descId, title, description: text }) => (
          <div className="flex flex-col gap-1">
            <OverTimeSummary latest={last.count} total={total} />
            <svg
              role="img"
              aria-labelledby={titleId}
              aria-describedby={descId}
              viewBox={`0 0 ${BOX.width} ${BOX.height}`}
              preserveAspectRatio="none"
              className="h-16 w-full text-primary"
            >
              <title id={titleId}>{title}</title>
              <desc id={descId}>{text}</desc>
              {area ? (
                <path d={area} fill="currentColor" className="opacity-10" />
              ) : null}
              {line ? (
                <path
                  d={line}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* A single interval draws no line, so it is marked instead --
                  otherwise a one-point window renders as an empty box. */}
              {points.length === 1 ? (
                <circle
                  cx={points[0].x}
                  cy={points[0].y}
                  r="2.5"
                  fill="currentColor"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            <OverTimeDates labels={rows.map(row => row.label)} />
          </div>
        )}
      </ChartFrame>
    ),
  };
};

/** How many dates a large card writes under its line, ends included. */
const LARGE_TIER_DATES = 5;

/**
 * A small card's figures: the latest interval's value and the range's total, the two numbers
 * that still fit when the line has no room for dates. Wider cards date the line instead.
 */
function OverTimeSummary({ latest, total }: { latest: number; total: number }) {
  if (useCardTier() !== "small") return null;
  return (
    <p
      data-testid="timeseries-summary"
      className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"
    >
      <span>
        <span className="font-medium text-foreground">
          {cardNumber(latest).label}
        </span>{" "}
        latest
      </span>
      <span>
        <span className="font-medium text-foreground">
          {cardNumber(total).label}
        </span>{" "}
        in total
      </span>
    </p>
  );
}

/**
 * The dates under the line at the card's tier: none when small, the two ends when medium, and
 * evenly spaced dates between them when large, never so many that they crowd.
 *
 * Hidden from assistive tech: the chart's `<desc>` already names the span, and these would
 * otherwise be read as bare dates with nothing saying what they bound.
 */
function OverTimeDates({ labels }: { labels: readonly string[] }) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  if (tier === "small") return null;
  const shown = datesShown(labels, tier === "large" ? LARGE_TIER_DATES : 2);
  return (
    <div
      aria-hidden="true"
      data-testid="timeseries-dates"
      className="flex justify-between gap-2 text-[10px] leading-none text-muted-foreground"
    >
      {shown.map(index => (
        <span key={index}>{labels[index]}</span>
      ))}
    </div>
  );
}

/** The indexes of `count` dates spread evenly from the first label to the last. */
function datesShown(labels: readonly string[], count: number): number[] {
  if (labels.length <= 1) return labels.length === 1 ? [0] : [];
  const steps = Math.min(count, labels.length) - 1;
  const indexes = Array.from({ length: steps + 1 }, (_, step) =>
    Math.round((step * (labels.length - 1)) / steps)
  );
  return [...new Set(indexes)];
}
