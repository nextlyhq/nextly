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
 * Colour names the category, not the count: each bar takes its group's value's
 * shared chart colour, so Published is the same colour on every card, and the
 * name beside each bar is what identifies it for a reader who cannot tell the
 * colours apart.
 *
 * This is the adapter from a grouped answer to `GroupsChart`, which draws it:
 * the buckets become groups named by the grouped field's own labels.
 *
 * @module components/features/widgets/archetypes/bars
 */

import { WithCollectionUnit } from "../charts/chart-unit";
import { GroupsChart, type GroupsChartGroup } from "../charts/groups-chart";

import { choiceLabel, type CellColumn } from "./cell-text";
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
): GroupsChartGroup {
  if (value === null) {
    return {
      key: "null",
      value,
      label: "(none)",
      count,
      announce: "no value stored",
    };
  }
  // Named by the grouped field's own value label ("Needs review", not `needs_review`), keyed by
  // the stored value, so two values that share a label still draw as two bars. Asked before the
  // empty-value placeholder: an option that stores "" on purpose ("None") is a choice, and it
  // reads here as it reads in a list or a table.
  const named = choiceLabel(value, choices);
  if (named !== undefined)
    return { key: `v${value}`, value, label: named, count };
  if (value === "") {
    return {
      key: "empty",
      value,
      label: "(empty)",
      count,
      announce: "an empty value",
    };
  }
  // A choice field's value with no option to name it (an option since removed, a value written
  // around the field) reads as a label would rather than as code: "needs_review" as "Needs
  // review". A field with no choices holds text as people wrote it, and is drawn as stored.
  const label = choices && choices.length > 0 ? humanised(value) : value;
  return { key: `v${value}`, value, label, count };
}

/** A stored code as words: separators to spaces, the first letter capital, the rest as stored. */
function humanised(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words === ""
    ? value
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
    //
    // A source that stopped at a work bound found no group in what it read, and the rest may
    // still hold some: that answer is a floor, so it says what was checked rather than claim
    // that nothing matches.
    return {
      ok: true,
      empty:
        result.atLeast === true
          ? {
              title: "None found in what was checked",
              detail:
                "This card read only part of the content, so groups may exist beyond what it checked.",
            }
          : {
              title: "Nothing to compare yet",
              detail: "Groups appear here once something matches this card.",
            },
    };
  }

  return {
    ok: true,
    node: (
      // The chart orders, cuts, colours and describes the groups; this adapter only reads them
      // out of the answer.
      // Counting a collection's entries, its tooltip names them ("7 posts").
      <WithCollectionUnit source={definition.query?.source}>
        {unit => (
          <GroupsChart
            groups={rows}
            truncated={result.truncated === true}
            // A source that counts only up to a bound says so, and every count is then drawn,
            // described and tabled as a floor ("N+").
            floors={result.atLeast === true}
            title={definition.title ?? "Comparison"}
            labelHeading={result.field?.label ?? "Value"}
            unit={unit}
          />
        )}
      </WithCollectionUnit>
    ),
  };
};
