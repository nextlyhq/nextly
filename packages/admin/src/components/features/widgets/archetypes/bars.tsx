/**
 * The `bars` archetype: how many rows fall in each bucket, as lengths.
 *
 * HORIZONTAL, and that is the load-bearing choice. The labels are whatever the
 * grouped column holds — author names, tag names, statuses — so they are text of
 * arbitrary length. A vertical column chart has only the column's own width to
 * put those in, which forces rotation or truncation; rotated text is measurably
 * slower to read, and truncation removes the very thing that identifies the bar.
 * Running the bars left-to-right gives every label a full line of its own.
 *
 * Length encodes the count, because length is judged accurately at a glance.
 * Nothing is encoded by colour: this is one series, so a second hue would carry
 * no information while excluding the readers who cannot separate it.
 *
 * Drawn with layout rather than SVG. A bar here is a `<div>` whose width is a
 * percentage, which wraps, reflows and respects the reader's font size for
 * free — none of which an SVG of the same picture does without being told.
 *
 * @module components/features/widgets/archetypes/bars
 */

import { ChartFrame } from "./chart-frame";
import { barFractions } from "./chart-scale";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * What a bucket that stores no readable value is called, and how it is keyed.
 *
 * A null bucket is a real answer — "how many entries have no author" — and the
 * result carries it as a bucket in its own right rather than dropping it. So is
 * an EMPTY STRING, which is a different answer: the column holds a value and
 * that value is blank. They are named apart, because folding them together
 * would report two groups as one.
 *
 * The identity is derived from the bucket rather than from what it is called.
 * A grouped column holds arbitrary text, so a row whose stored value reads
 * `(none)` would otherwise share both its label and its React key with the null
 * bucket. The prefixes make that impossible: `null` and `empty` carry no
 * payload, and every stored value is prefixed `v`, so no two distinct buckets
 * can collide however they are spelled.
 *
 * Their LABELS can still coincide — no string can be reserved from a column of
 * arbitrary text — so the placeholder rows are marked and drawn differently
 * instead of relying on their wording to separate them.
 */
function bucketRow(
  value: string | null,
  count: number
): { key: string; label: string; count: number; placeholder?: boolean } {
  if (value === null) {
    return { key: "null", label: "(none)", count, placeholder: true };
  }
  if (value === "") {
    return { key: "empty", label: "(empty)", count, placeholder: true };
  }

  return { key: `v${value}`, label: value, count };
}

export const barsAccepts: ArchetypeAccepts = definition => {
  if (definition.query) return undefined;
  const name = definition.title ?? "This bars widget";
  return `"${name}" is drawn from a query, and this widget declares none.`;
};

export const barsBody: ArchetypeBody = (result, definition) => {
  if (result.op !== "groupBy") {
    return {
      ok: false,
      message: `"${definition.title}" expected grouped buckets, but the query returned a ${result.op}.`,
    };
  }

  const rows = result.buckets.map(bucket =>
    bucketRow(bucket.value, bucket.count)
  );

  if (rows.length === 0) {
    return {
      ok: true,
      node: (
        <p className="text-sm text-muted-foreground">
          Nothing to compare yet — no rows matched this query.
        </p>
      ),
    };
  }

  const fractions = barFractions(rows.map(row => row.count));
  const largest = rows[0];
  // Composed ONCE and handed to both the frame and the graphic. Written twice,
  // the two drifted immediately: one pluralised "category" for a single bucket
  // and the other did not, so the table's caption and the chart's own
  // description disagreed about the same data.
  const description = `${rows.length} ${rows.length === 1 ? "category" : "categories"}. Largest: ${largest.label}, ${largest.count.toLocaleString()}.`;

  return {
    ok: true,
    node: (
      <ChartFrame
        title={definition.title ?? "Comparison"}
        // The shape in words, for a reader who cannot see the lengths. Naming
        // the biggest bucket is what the picture communicates first.
        description={description}
        labelHeading="Value"
        rows={rows}
        note={
          result.truncated
            ? "Showing the largest groups only; some are not listed."
            : undefined
        }
      >
        {({ titleId, descId, title, description: text }) => (
          // A list rather than a bare stack of divs: the bars ARE a list of
          // labelled values, and `role="img"` on the wrapper prunes the
          // children anyway, so the semantics cost nothing and survive if the
          // role is ever removed.
          <div
            role="img"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="flex flex-col gap-1.5"
          >
            <span id={titleId} className="sr-only">
              {title}
            </span>
            <span id={descId} className="sr-only">
              {text}
            </span>
            {rows.map((row, index) => (
              <div key={row.key} className="flex flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  {/* Truncated with an accessible full value: a long author
                      name must not push the count off the card, and the title
                      attribute keeps the whole string reachable on hover. */}
                  <span
                    className={
                      row.placeholder
                        ? "truncate text-xs italic text-muted-foreground"
                        : "truncate text-xs text-foreground"
                    }
                    title={row.label}
                  >
                    {row.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {row.count.toLocaleString()}
                  </span>
                </div>
                {/* The track is always full width, so the bars share one
                    baseline and their lengths are comparable by eye. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    // design-lint-ok: the width IS the datum, so it cannot come
                    // from a utility class -- there is no Tailwind scale for
                    // "this bucket's share of the largest one".
                    style={{ width: `${fractions[index] * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartFrame>
    ),
  };
};
