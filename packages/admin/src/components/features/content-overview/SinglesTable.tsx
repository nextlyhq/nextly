"use client";

/**
 * The Content overview's Singles: one row each, with who edited it last, when,
 * and Edit, or View for a reader who may only read it. A Single has no entry
 * count: it is one document.
 *
 * @module components/features/content-overview/SinglesTable
 */
import { Button } from "@nextlyhq/ui";
import { useId, type JSX } from "react";

import { StoryActorName } from "@admin/components/features/versions/StoryActorName";
import { Link } from "@admin/components/ui/link";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  searchSidebarSingles,
  singleDisplayName,
} from "@admin/lib/sidebar-landing";
import type { ApiSingle } from "@admin/types/entities";

import {
  ACTIONS_HEADER,
  NoValue,
  Pending,
  RowName,
  SectionHead,
  When,
} from "./overview-cells";
import { useSingleLastEdit } from "./overview-rows";

function editHref(single: ApiSingle): string {
  return buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug });
}

/** Who or what edited it last, as its history names them. */
function EditedByCell({ single }: { single: ApiSingle }): JSX.Element {
  const edit = useSingleLastEdit(single.slug);
  if (edit.isPending) return <Pending />;
  const by = edit.data?.by;
  return by === undefined ? (
    <NoValue label="Not recorded" />
  ) : (
    <StoryActorName actor={by} />
  );
}

/** When it was edited last. */
function LastEditedCell({ single }: { single: ApiSingle }): JSX.Element {
  const edit = useSingleLastEdit(single.slug);
  if (edit.isPending) return <Pending />;
  const at = edit.data?.at;
  return at === undefined ? <NoValue label="Never edited" /> : <When at={at} />;
}

/** Edit where the reader may change it, else View: both open its editor. */
function EditAction({ single }: { single: ApiSingle }): JSX.Element {
  const { capabilities } = useCurrentUserPermissions();
  const verb =
    capabilities.collections[single.slug]?.canUpdate === true ? "Edit" : "View";
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        href={editHref(single)}
        aria-label={`${verb} ${singleDisplayName(single)}`}
      >
        {verb}
      </Link>
    </Button>
  );
}

const COLUMNS: NextlyColumn<ApiSingle>[] = [
  {
    name: "name",
    header: "Single",
    cell: ({ row }) => (
      <RowName
        kind="single"
        icon={row.admin?.icon}
        label={singleDisplayName(row)}
        href={editHref(row)}
      />
    ),
  },
  {
    name: "editedBy",
    header: "Edited by",
    cell: ({ row }) => <EditedByCell single={row} />,
  },
  {
    name: "lastEdited",
    header: "Last edited",
    cell: ({ row }) => <LastEditedCell single={row} />,
  },
  {
    name: "actions",
    header: ACTIONS_HEADER,
    align: "right",
    hideLabelOnMobile: true,
    cell: ({ row }) => <EditAction single={row} />,
  },
];

export function SinglesTable({
  singles,
  search,
}: {
  /** The Singles the reader may open, in the Content panel's order. */
  singles: readonly ApiSingle[];
  search: string;
}): JSX.Element {
  const headingId = useId();
  const matched = searchSidebarSingles([...singles], search);
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SectionHead
        id={headingId}
        label="Singles"
        count={matched.length}
        hint="One document each"
      />
      <DataTableView
        columns={COLUMNS}
        rows={matched}
        getRowId={single => single.slug}
        ariaLabel="Singles"
        emptyMessage={`No Singles match “${search}”.`}
      />
    </section>
  );
}
