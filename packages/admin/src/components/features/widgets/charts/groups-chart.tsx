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
 * The bars are drawn by the chart engine, in `drawn/groups-drawing`, which this module loads
 * lazily: the engine reaches a page only where a chart is drawn, and until it arrives the chart
 * holds its height. Everything a reader needs is here and drawn without the engine -- the chart's
 * name, description and table, the keys and the live region -- so the chart can be read before
 * its bars arrive.
 *
 * @module components/features/widgets/charts/groups-chart
 */

import { lazy, Suspense, type JSX } from "react";

import { ChartFrame, type ChartRow } from "../archetypes/chart-frame";
import { barFractions } from "../archetypes/chart-scale";
import { CardFigure } from "../frame/figure";
import { cardLocale, cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";
import { GROUPS_DRAWN } from "../tier-query";

import { chartSlotsFor, orderGroups, type ChartSlot } from "./chart-colour";
import { CHART_ROW_HEIGHT, type ChartConfig } from "./chart-config";
import { ChartReachArea, ChartTooltip, useChartReach } from "./chart-reach";
import { chartName, currentPointText, groupsSummary } from "./chart-text";

const GroupsDrawing = lazy(() => import("./drawn/groups-drawing"));

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
}: GroupsChartProps): JSX.Element {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const ordered = orderGroups(groups, cardLocale());
  const counted = floors
    ? ordered.map(group => ({ ...group, floor: true }))
    : ordered;
  const drawn = counted.slice(0, GROUPS_DRAWN[tier]);
  const fractions = barFractions(drawn.map(group => group.count));
  // Decided over every group the answer holds, not only those drawn, so a status chart cut short
  // by a small card keeps the colours it has on a large one.
  const slots = chartSlotsFor(counted.map(group => group.value));
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
      {({ descId, title: heading, description: text }) => (
        <ChartReachArea
          reach={reach}
          name={chartName({ kind: "bars", what: heading })}
          describedBy={descId}
          announcement={announcement}
        >
          {/* The bars are drawn for sight and hidden from assistive tech: the area around them is
            the chart's one accessible object, named and described once, and the table holds the
            numbers cell by cell. The description stays here for the area to point at. */}
          <span aria-hidden="true">
            <span id={descId} className="sr-only">
              {text}
            </span>
          </span>
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                data-testid="chart-pending"
                // design-lint-ok: holds the drawing's own height while the engine loads.
                style={{ height: drawn.length * CHART_ROW_HEIGHT }}
              />
            }
          >
            <GroupsDrawing
              rows={drawn.map((group, index) => ({
                key: groupKey(index),
                label: group.label,
                placeholder: group.announce !== undefined,
                // As drawn, "2,000+" or "1.2k": the table and the live region say it in full.
                count: cardNumber(group.count, { floor: group.floor, tier })
                  .text,
                fraction: fractions[index] ?? 0,
              }))}
              config={configOf(drawn, slots)}
              shown={reach.shown?.index}
              onHover={index => reach.hover({ series: 0, index })}
              tooltip={tooltipFor(drawn, reach.shown?.index, slots)}
            />
          </Suspense>
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

/** The key of the group at `index` in the drawn data and its config: never its stored value. */
function groupKey(index: number): string {
  return `g${index}`;
}

/** Each drawn group's colour, by its key: its slot among the chart's groups. */
function configOf(
  drawn: readonly GroupsChartGroup[],
  slots: readonly ChartSlot[]
): ChartConfig {
  return Object.fromEntries(
    drawn.map((group, index) => [
      groupKey(index),
      { label: group.label, slot: slots[index] ?? 1 },
    ])
  );
}

/** The tooltip of the group at `index`, the one in view: its name, colour and count. */
function tooltipFor(
  drawn: readonly GroupsChartGroup[],
  index: number | undefined,
  slots: readonly ChartSlot[]
) {
  const group = index === undefined ? undefined : drawn[index];
  if (!group || index === undefined) return null;
  return (
    <ChartTooltip
      title={group.label}
      lines={[
        {
          key: group.key,
          slot: slots[index] ?? 1,
          value: <CardFigure value={group.count} floor={group.floor} />,
        },
      ]}
      className="static"
    />
  );
}
