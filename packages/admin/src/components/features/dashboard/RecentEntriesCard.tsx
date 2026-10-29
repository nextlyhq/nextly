"use client";

/**
 * Recent entries: a collection's entries changed most recently, every row a link to its entry,
 * and, when there are more than it draws, "View all (N)" to the collection's list under the
 * card's Filter and Sort.
 *
 * Drawn as core's lists are, by the one list card: stacked rows with when each was updated and
 * its status, or a table at the large tier. It draws the rows its body holds, and at most the
 * reader's "Number of items".
 *
 * @module components/features/dashboard/RecentEntriesCard
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

import { answerTotal } from "../widgets/archetypes/tiered-rows";
import { FrameState } from "../widgets/frame/card-state";
import { useCollectionLabel } from "../widgets/frame/collection-label";
import { ListCard } from "../widgets/frame/list-card";
import { useListCard } from "../widgets/frame/list-slot";
import {
  collectionSlugOf,
  listViewHref,
} from "../widgets/frame/list-view-href";

import { recentEntriesModel, rowLabelField } from "./recent-entries-model";

export const RecentEntriesCard: React.FC<WidgetComponentProps> = props => {
  const { tier, drawn, density, now, read } = useListCard(props);
  const labelOf = useCollectionLabel();
  const sources = useBranding().widgetSources;
  const { query } = props;
  // Whether the collection has a lifecycle, as its published source says: only
  // then is a `status` column the lifecycle's, drawn as a pill.
  const slug = collectionSlugOf(query?.source);
  const lifecycle =
    sources?.find(source => source.collection === slug)?.lifecycle === true;
  if ("node" in read) return read.node;
  const label = rowLabelField(query);
  // A card asked with no title field has no row to name: the collection publishes none to this
  // reader, so the card was never asked, and says so.
  if (label === undefined) return <FrameState state={{ kind: "no-access" }} />;
  if (read.list.items.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: "No entries yet",
            detail:
              "Entries in this collection show here, most recently changed first.",
          },
        }}
      />
    );
  }
  const columns = read.list.fields ?? [];
  return (
    <ListCard
      model={recentEntriesModel(query, label, columns, now, labelOf, lifecycle)}
      rows={read.list.items}
      drawn={drawn}
      total={answerTotal(read.list)}
      viewAllHref={listViewHref(query)}
      tier={tier}
      density={density}
    />
  );
};

RecentEntriesCard.displayName = "RecentEntriesCard";
