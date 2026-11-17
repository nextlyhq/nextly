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

import { Link } from "@admin/components/ui/link";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useDocumentAddress } from "@admin/lib/navigation/useDocumentAddress";
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

/**
 * Where a row opens its Single: where the admin's one rule opens it, as the
 * sidebar does, read from the Single the table holds. A Homepage whose main
 * field is a page layout opens in the Page Builder; a reader who may only
 * read it gets its form.
 */
function useOpenHref(single: ApiSingle): string {
  const addressOf = useDocumentAddress();
  return addressOf(
    { kind: "single", slug: single.slug },
    { collection: single }
  );
}

/** The row's name, linking where the Single opens. */
function SingleName({ single }: { single: ApiSingle }): JSX.Element {
  return (
    <RowName
      kind="single"
      icon={single.admin?.icon}
      label={singleDisplayName(single)}
      href={useOpenHref(single)}
    />
  );
}

/** Who or what edited it last, as the activity feed names them. */
function EditedByCell({ single }: { single: ApiSingle }): JSX.Element {
  const edit = useSingleLastEdit(single.slug);
  if (edit.isPending) return <Pending />;
  const by = edit.data?.by;
  return by === undefined ? (
    <NoValue label="Not recorded" />
  ) : (
    <span className="font-medium text-foreground">{by}</span>
  );
}

/** When it was edited last. */
function LastEditedCell({ single }: { single: ApiSingle }): JSX.Element {
  const edit = useSingleLastEdit(single.slug);
  if (edit.isPending) return <Pending />;
  const at = edit.data?.at;
  return at === undefined ? <NoValue label="Never edited" /> : <When at={at} />;
}

/** Edit where the reader may change it, else View: both open it as the row does. */
function EditAction({ single }: { single: ApiSingle }): JSX.Element {
  const { capabilities } = useCurrentUserPermissions();
  const href = useOpenHref(single);
  const verb =
    capabilities.collections[single.slug]?.canUpdate === true ? "Edit" : "View";
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href} aria-label={`${verb} ${singleDisplayName(single)}`}>
        {verb}
      </Link>
    </Button>
  );
}

const COLUMNS: NextlyColumn<ApiSingle>[] = [
  {
    name: "name",
    header: "Single",
    cell: ({ row }) => <SingleName single={row} />,
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
