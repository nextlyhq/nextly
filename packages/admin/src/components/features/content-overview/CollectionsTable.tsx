"use client";

/**
 * The Content overview's collections: one row each, with its entries, its
 * drafts, its last edit and a New action for a reader who may create.
 *
 * Collections that name an `admin.sidebarGroup` are listed under their group,
 * the groups first in the order their first collection appears and then the
 * rest under "Other", as the Content panel lists them. Each group is a table
 * of its own under its heading, drawn by the admin's list table, which turns
 * each row into a card on a narrow screen.
 *
 * @module components/features/content-overview/CollectionsTable
 */
import { Button } from "@nextlyhq/ui";
import { useId, type JSX } from "react";

import { Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { groupCollections } from "@admin/lib/content-groups";
import {
  collectionDisplayName,
  searchSidebarCollections,
} from "@admin/lib/sidebar-landing";
import type { ApiCollection } from "@admin/types/entities";

import {
  ACTIONS_HEADER,
  GroupHead,
  NoValue,
  Pending,
  RowName,
  SectionHead,
  When,
} from "./overview-cells";
import { useCollectionRowStats } from "./overview-rows";

function listHref(collection: ApiCollection): string {
  return buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name });
}

/** Its entries: the total its list shows. */
function EntriesCell({
  collection,
}: {
  collection: ApiCollection;
}): JSX.Element {
  const stats = useCollectionRowStats(collection);
  if (stats.isPending) return <Pending />;
  if (stats.data === undefined) return <NoValue label="Not available" />;
  const { total } = stats.data;
  return (
    <span
      className={
        total === 0 ? "text-muted-foreground tabular-nums" : "tabular-nums"
      }
    >
      {total}
    </span>
  );
}

/**
 * Its drafts, linked to its list's Draft filter when there are any: "—" for a
 * collection without the Draft / Published lifecycle.
 */
function DraftsCell({
  collection,
}: {
  collection: ApiCollection;
}): JSX.Element {
  const stats = useCollectionRowStats(collection);
  if (stats.isPending) return <Pending />;
  const drafts = stats.data?.drafts ?? null;
  if (drafts === null) return <NoValue label="No drafts" />;
  if (drafts === 0) {
    return <span className="text-muted-foreground tabular-nums">0</span>;
  }
  const label = collectionDisplayName(collection);
  return (
    <Link
      href={`${listHref(collection)}?${new URLSearchParams({ status: "draft" }).toString()}`}
      aria-label={`${drafts} drafts in ${label}`}
      // A 24px target however few digits it holds.
      className="inline-flex min-h-6 min-w-6 items-center justify-end font-medium tabular-nums text-foreground underline underline-offset-2"
    >
      {drafts}
    </Link>
  );
}

/** When any of its entries was last edited. */
function LastEditedCell({
  collection,
}: {
  collection: ApiCollection;
}): JSX.Element {
  const stats = useCollectionRowStats(collection);
  if (stats.isPending) return <Pending />;
  const at = stats.data?.lastEdited ?? null;
  return at === null ? <NoValue label="Never edited" /> : <When at={at} />;
}

/**
 * New, for a reader the server lets create in it; nothing for a collection
 * only a machine writes to (`admin.disableCreate`).
 */
function NewEntryAction({
  collection,
}: {
  collection: ApiCollection;
}): JSX.Element | null {
  const { capabilities } = useCurrentUserPermissions();
  const mayCreate =
    capabilities.collections[collection.name]?.canCreate === true &&
    collection.admin?.disableCreate !== true;
  if (!mayCreate) return null;
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        href={buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
          slug: collection.name,
        })}
        aria-label={`New entry in ${collectionDisplayName(collection)}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New
      </Link>
    </Button>
  );
}

const COLUMNS: NextlyColumn<ApiCollection>[] = [
  {
    name: "name",
    header: "Collection",
    cell: ({ row }) => (
      <RowName
        kind="collection"
        icon={row.admin?.icon}
        label={collectionDisplayName(row)}
        href={listHref(row)}
      />
    ),
  },
  {
    name: "entries",
    header: "Entries",
    align: "right",
    cell: ({ row }) => <EntriesCell collection={row} />,
  },
  {
    name: "drafts",
    header: "Drafts",
    align: "right",
    cell: ({ row }) => <DraftsCell collection={row} />,
  },
  {
    name: "lastEdited",
    header: "Last edited",
    cell: ({ row }) => <LastEditedCell collection={row} />,
  },
  {
    name: "actions",
    header: ACTIONS_HEADER,
    align: "right",
    hideLabelOnMobile: true,
    cell: ({ row }) => <NewEntryAction collection={row} />,
  },
];

export function CollectionsTable({
  collections,
  search,
}: {
  /** The collections the reader may open, in the Content panel's order. */
  collections: readonly ApiCollection[];
  search: string;
}): JSX.Element {
  const headingId = useId();
  const { customGroups } = useBranding();
  const matched = searchSidebarCollections([...collections], search);
  const groups = groupCollections(matched, customGroups);
  // Headings only where a group is named; a list of ungrouped collections
  // alone is one table with no heading of its own.
  const grouped = groups.some(group => group.slug !== null);
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SectionHead
        id={headingId}
        label="Collections"
        count={matched.length}
        hint="Many entries each"
      />
      {groups.length === 0 ? (
        <DataTableView
          columns={COLUMNS}
          rows={[]}
          ariaLabel="Collections"
          emptyMessage={`No collections match “${search}”.`}
        />
      ) : (
        groups.map(group => {
          const name = group.slug === null ? "Other" : group.name;
          return (
            <div key={group.slug ?? ""} className="space-y-2">
              {grouped ? (
                <GroupHead label={name} count={group.items.length} />
              ) : null}
              <DataTableView
                columns={COLUMNS}
                rows={group.items}
                ariaLabel={grouped ? `Collections: ${name}` : "Collections"}
              />
            </div>
          );
        })
      )}
    </section>
  );
}
