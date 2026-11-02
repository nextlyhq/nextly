"use client";

/**
 * Breakdown: how a collection's entries divide, as one bar per group, largest first, and the same
 * values as a table on request ("View as table").
 *
 * Drawn from the data its `load` answers: the groups, named by the grouped field's own value
 * labels, as the `bars` archetype names them, and whether the counts are floors or groups were
 * left out. The frame drew loading, no permission and error before this is reached.
 *
 * @module components/features/dashboard/BreakdownCard
 */

import type { BreakdownWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { bucketRow, groupsEmpty } from "../widgets/archetypes/bars";
import { orderGroups } from "../widgets/charts/chart-colour";
import { ChartTableDisclosure } from "../widgets/charts/chart-table-disclosure";
import { useCollectionUnit } from "../widgets/charts/chart-unit";
import { GroupsChart } from "../widgets/charts/groups-chart";
import { FrameState } from "../widgets/frame/card-state";
import { cardLocale } from "../widgets/frame/format";

/** What the Breakdown card is handed: its declaration's props, with the data its `load` answers. */
export type BreakdownCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: BreakdownWidgetData;
};

export const BreakdownCard: React.FC<BreakdownCardProps> = ({
  data,
  settings,
}) => {
  // Counting a collection's entries, its tooltip names them ("7 posts"). Asked before any early
  // answer, as a hook must be.
  const unit = useCollectionUnit(
    typeof settings.collection === "string" ? settings.collection : undefined
  );
  // A collection with nothing to divide its entries by for this reader was never asked: the
  // frame's one "not available" state, as such a card has always drawn.
  if (data.buckets === null) {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  const floors = data.atLeast === true;
  const groups = data.buckets.map(bucket =>
    bucketRow(bucket.value, bucket.count, data.field?.choices)
  );
  if (groups.length === 0) {
    return <FrameState state={{ kind: "empty", empty: groupsEmpty(floors) }} />;
  }
  const labelHeading = data.field?.label ?? "Value";
  return (
    <ChartTableDisclosure
      labelHeading={labelHeading}
      // Every group, in the chart's own order, each count a floor where the chart's is.
      rows={orderGroups(groups, cardLocale()).map(group =>
        floors ? { ...group, floor: true } : group
      )}
      chart={
        <GroupsChart
          groups={groups}
          truncated={data.truncated === true}
          // A source that counts only up to a bound says so, and every count is then drawn,
          // described and tabled as a floor ("N+").
          floors={floors}
          // Named as the card is, as the archetype named the chart by its widget's title.
          title="Breakdown"
          labelHeading={labelHeading}
          {...(unit === undefined ? {} : { unit })}
        />
      }
    />
  );
};

BreakdownCard.displayName = "BreakdownCard";
