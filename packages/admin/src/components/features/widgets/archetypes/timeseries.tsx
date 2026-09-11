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
    return {
      ok: true,
      node: (
        <p className="text-sm text-muted-foreground">
          Nothing to plot yet — this window has no intervals.
        </p>
      ),
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
  const first = rows[0];
  const last = rows[rows.length - 1];

  // Composed ONCE and handed to both the frame and the graphic, so the table's
  // caption and the chart's own description cannot describe different data.
  const description = `${rows.length} ${result.interval} intervals, ${total.toLocaleString()} in total. Busiest: ${busiest.label}, ${busiest.count.toLocaleString()}.`;

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
            {/* Hidden from assistive tech: the `<desc>` above already names the
                span, and these two would otherwise be read as bare dates with
                nothing saying what they bound. */}
            <div
              aria-hidden="true"
              className="flex justify-between text-[10px] leading-none text-muted-foreground"
            >
              <span>{first.label}</span>
              {rows.length > 1 ? <span>{last.label}</span> : null}
            </div>
          </div>
        )}
      </ChartFrame>
    ),
  };
};
