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

import { CardFigure } from "../frame/figure";
import { cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";
import { GROUPS_DRAWN } from "../tier-query";

import { choiceLabel, type CellColumn } from "./cell-text";
import { ChartFrame, type ChartRow } from "./chart-frame";
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
  count: number,
  choices: CellColumn["choices"]
): ChartRow {
  if (value === null) {
    return { key: "null", label: "(none)", count, announce: "no value stored" };
  }
  // Named by the grouped field's own value label ("Needs review", not `needs_review`), keyed by
  // the stored value, so two values that share a label still draw as two bars. Asked before the
  // empty-value placeholder: an option that stores "" on purpose ("None") is a choice, and it
  // reads here as it reads in a list or a table.
  const named = choiceLabel(value, choices);
  if (named !== undefined) return { key: `v${value}`, label: named, count };
  if (value === "") {
    return {
      key: "empty",
      label: "(empty)",
      count,
      announce: "an empty value",
    };
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
    bucketRow(bucket.value, bucket.count, result.field?.choices)
  );

  if (rows.length === 0) {
    // The frame's one empty state, worded for groups. Source-neutral: the card may read any
    // collection's, system's or plugin's data, so it names no kind of row it cannot know.
    return {
      ok: true,
      empty: {
        title: "Nothing to compare yet",
        detail: "Groups appear here once something matches this card.",
      },
    };
  }

  return {
    ok: true,
    node: (
      <BarsAtTier
        rows={rows}
        truncated={result.truncated === true}
        title={definition.title ?? "Comparison"}
        labelHeading={result.field?.label ?? "Value"}
      />
    ),
  };
};

interface BarsAtTierProps {
  /** Every group the answer holds, largest first, as the server orders them. */
  rows: ChartRow[];
  /** Whether the server left groups out of the answer. */
  truncated: boolean;
  title: string;
  labelHeading: string;
}

/**
 * The groups a breakdown card draws at its tier: the three, five or eight with the most entries.
 *
 * A component rather than markup built in the body, because the tier is the card's and is read
 * from the frame's context. Groups are left out two ways -- the server truncated the answer, or
 * the answer was fetched for a wider card and holds more than this tier draws -- and either way
 * the card says more groups exist rather than dropping them in silence.
 */
function BarsAtTier({ rows, truncated, title, labelHeading }: BarsAtTierProps) {
  // Medium until the card has measured itself, which it does before its first paint.
  const drawn = rows.slice(0, GROUPS_DRAWN[useCardTier() ?? "medium"]);
  const fractions = barFractions(drawn.map(row => row.count));
  const largest = drawn[0];
  // Composed ONCE and handed to both the frame and the graphic. Written twice,
  // the two drifted immediately: one pluralised "category" for a single bucket
  // and the other did not, so the table's caption and the chart's own
  // description disagreed about the same data. It describes the groups DRAWN.
  const description = `${drawn.length} ${drawn.length === 1 ? "category" : "categories"}. Largest: ${largest.label}, ${cardNumber(largest.count).label}.`;
  // How many more, where the answer says: groups this tier leaves out of an answer that is
  // whole. A truncated answer cannot say how many it left out, so it says that more exist.
  const leftOut = rows.length - drawn.length;
  const note = truncated
    ? "More groups exist than are shown."
    : leftOut > 0
      ? `${leftOut} more ${leftOut === 1 ? "group" : "groups"}`
      : undefined;

  return (
    <ChartFrame
      title={title}
      // The shape in words, for a reader who cannot see the lengths. Naming
      // the biggest bucket is what the picture communicates first.
      description={description}
      // The grouped field's label heads the value column ("Status"), falling back to a
      // neutral word when the server described no field.
      labelHeading={labelHeading}
      rows={drawn}
      note={note}
    >
      {({ titleId, descId, title: heading, description: text }) => (
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
            {heading}
          </span>
          <span id={descId} className="sr-only">
            {text}
          </span>
          {drawn.map((row, index) => (
            <div key={row.key} className="flex flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                {/* Wrapped, never cut: a long author name takes another line rather than
                    losing its end or pushing the count off the card. */}
                <span
                  className={
                    row.announce
                      ? "min-w-0 break-words text-xs italic text-muted-foreground"
                      : "min-w-0 break-words text-xs text-foreground"
                  }
                >
                  {row.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <CardFigure value={row.count} />
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
  );
}
