"use client";

/**
 * Recent entries: a collection's entries changed most recently, every row a link to its entry,
 * and a "View all" link to the collection's list under the card's Filter and Sort.
 *
 * By the card's own width, as core's lists are: small lists titles alone; medium adds a line
 * under each with its status and when it was updated; large is a table, headed by the columns
 * the server described. It draws at most the reader's "Number of items".
 *
 * @module components/features/dashboard/RecentEntriesCard
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { TieredRows } from "../widgets/archetypes/tiered-rows";
import { useListCard } from "../widgets/frame/list-slot";
import { CardEmpty, CardUnavailable } from "../widgets/frame/states";

import { entryDetail, entryHref, rowLabelField } from "./recent-entries-model";

/** The card's heading in its error state. */
const TITLE = "Recent entries";

export const RecentEntriesCard: React.FC<WidgetComponentProps> = props => {
  const { now, read } = useListCard(props, TITLE);
  const { query } = props;
  if ("node" in read) return read.node;
  const label = rowLabelField(query);
  // A card asked with no title field has no row to name: the collection publishes none to this
  // reader, so the card was never asked, and says so.
  if (label === undefined) return <CardUnavailable />;
  if (read.list.items.length === 0) {
    return (
      <CardEmpty
        title="No entries yet"
        detail="Entries in this collection show here, most recently changed first."
      />
    );
  }
  const columns = read.list.fields ?? [];
  return (
    <TieredRows
      items={read.list.items}
      columns={columns}
      labelField={label}
      detailField={undefined}
      detailOf={item => entryDetail(item, columns, now)}
      hrefOf={item => entryHref(query, item)}
      query={query}
      viewAll
    />
  );
};

RecentEntriesCard.displayName = "RecentEntriesCard";
