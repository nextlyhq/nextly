/**
 * A chart of groups: one bar per group, longest first, each coloured by its group's value and
 * named beside it, with its count.
 *
 * A standalone component with a plain props API -- groups in, no widget definition or query
 * result -- so the breakdown archetype and a plugin's own card draw groups the same way. The
 * card's tier, formatter and locale are read where it is drawn, from the card around it.
 *
 * The groups are ordered before the tier cuts them, so the bars, the table, the text
 * alternative and "N more groups" all describe the same set.
 *
 * Drawn with layout rather than SVG. A bar is a `<div>` whose width is a percentage, which
 * wraps, reflows and respects the reader's font size for free -- none of which an SVG of the
 * same picture does without being told.
 *
 * @module components/features/widgets/charts/groups-chart
 */

import { ChartFrame, type ChartRow } from "../archetypes/chart-frame";
import { barFractions } from "../archetypes/chart-scale";
import { CardFigure } from "../frame/figure";
import { cardLocale, cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";
import { GROUPS_DRAWN } from "../tier-query";

import { chartColour, chartSlotFor, orderGroups } from "./chart-colour";
import { ChartReachArea, ChartTooltip, useChartReach } from "./chart-reach";
import { chartName, currentPointText, groupsSummary } from "./chart-text";

/** One group of a chart of groups. */
export interface GroupsChartGroup extends ChartRow {
  /** The stored value, which decides the bar's colour; `null` for the group with no value. */
  value: string | null;
}

export interface GroupsChartProps {
  /** What the chart shows, named to assistive tech and above the table. */
  title: string;
  /** What the groups are, heading the table's first column ("Status"). */
  labelHeading: string;
  groups: readonly GroupsChartGroup[];
  /** Groups were left out of the answer: the chart says more exist. */
  truncated?: boolean;
  /** Every count is a lower bound: drawn "N+", and no group is called the highest. */
  floors?: boolean;
}

export function GroupsChart({
  title,
  labelHeading,
  groups,
  truncated = false,
  floors = false,
}: GroupsChartProps) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const ordered = orderGroups(groups, cardLocale());
  const counted = floors
    ? ordered.map(group => ({ ...group, floor: true }))
    : ordered;
  const drawn = counted.slice(0, GROUPS_DRAWN[tier]);
  const fractions = barFractions(drawn.map(group => group.count));
  // Composed ONCE and handed to both the frame and the graphic, so the table's caption and the
  // chart's own description cannot describe different data. It counts every group the answer
  // holds, not only those this tier draws, so its total is the answer's; "N more groups" says
  // which of them the bars leave out.
  const description = groupsSummary({
    what: title,
    groups: counted,
    floors,
    partial: truncated,
    format: count => cardNumber(count).label,
  });
  const note = moreGroupsNote(truncated, ordered.length - drawn.length);
  const reach = useChartReach({ kind: "bars", bars: drawn.length });
  const keyed = reach.keyed ? drawn[reach.keyed.index] : undefined;
  // What the live region reads for the bar the keyboard is on: its group as the table speaks it
  // ("no value stored", not the "(none)" drawn), its count heard as the table's figure is ("N or
  // more" for a floor), and its place among the bars drawn.
  const announcement =
    keyed && reach.keyed
      ? currentPointText({
          when: keyed.announce ?? keyed.label,
          value: cardNumber(keyed.count, { floor: keyed.floor }).label,
          position: { index: reach.keyed.index, of: drawn.length },
        })
      : "";

  return (
    <ChartFrame
      title={title}
      description={description}
      labelHeading={labelHeading}
      rows={drawn}
      note={note}
    >
      {({ titleId, descId, title: heading, description: text }) => (
        <ChartReachArea
          reach={reach}
          name={chartName({ kind: "bars", what: heading })}
          describedBy={descId}
          announcement={announcement}
        >
          {/* A list of labelled values; `role="img"` prunes the children, so the description is
            what a screen reader hears, and the table holds the numbers cell by cell. */}
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
            {drawn.map((group, index) => (
              <GroupBar
                key={group.key}
                group={group}
                fraction={fractions[index] ?? 0}
                onHover={() => reach.hover({ series: 0, index })}
                tooltip={reach.shown?.index === index}
              />
            ))}
          </div>
        </ChartReachArea>
      )}
    </ChartFrame>
  );
}

/**
 * What the chart says about groups it leaves out: that more exist, where the answer itself was
 * cut and cannot say how many, or how many more where the tier left them out of a whole answer.
 */
function moreGroupsNote(
  truncated: boolean,
  leftOut: number
): string | undefined {
  if (truncated) return "More groups exist than are shown.";
  if (leftOut > 0)
    return `${leftOut} more ${leftOut === 1 ? "group" : "groups"}`;
  return undefined;
}

/** One group's name and count, over its bar, and its tooltip while it is the point in view. */
function GroupBar({
  group,
  fraction,
  onHover,
  tooltip,
}: {
  group: GroupsChartGroup;
  fraction: number;
  onHover: () => void;
  tooltip: boolean;
}) {
  const slot = chartSlotFor(group.value);
  return (
    <div
      className="relative flex flex-col gap-0.5"
      data-testid="chart-group"
      onPointerEnter={onHover}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        {/* Wrapped, never cut: a long name takes another line rather than losing its end or
            pushing the count off the card. */}
        <span
          className={
            group.announce
              ? "min-w-0 break-words text-xs italic text-muted-foreground"
              : "min-w-0 break-words text-xs text-foreground"
          }
        >
          {group.label}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <CardFigure value={group.count} floor={group.floor} />
        </span>
      </div>
      {/* The track is always full width, so the bars share one baseline and their lengths are
          comparable by eye. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          data-testid="chart-bar"
          className="h-full rounded-full"
          // design-lint-ok: the width IS the datum, and the colour is the group's shared chart
          // slot by its value, so a category is the same colour on every card.
          style={{
            width: `${fraction * 100}%`,
            backgroundColor: chartColour(slot),
          }}
        />
      </div>
      {tooltip ? (
        <ChartTooltip
          title={group.label}
          lines={[
            {
              key: group.key,
              slot,
              value: <CardFigure value={group.count} floor={group.floor} />,
            },
          ]}
          className="top-full left-0"
        />
      ) : null}
    </div>
  );
}
