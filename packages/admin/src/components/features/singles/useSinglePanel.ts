"use client";

/**
 * What a Single's side panel is told about the Single: what it is, who
 * changed it last and when, the address "View API response" reads, and how
 * to open its history.
 *
 * Who comes from the Single's own read with `?details=1`, as an entry's does
 * (`useEntryDetails`); the server answers it only to a signed-in admin user
 * the read is granted to. History is offered by the rule the document bar
 * offers it by: a saved Single that keeps versions, to a person who may read
 * them (`useHistoryOffered`).
 *
 * @module components/features/singles/useSinglePanel
 */

import { useEntryDetails } from "@admin/components/features/entries/EntryForm/entry-details-read";
import type { DocumentPanelProps } from "@admin/components/features/entries/EntryForm/panels";
import { useHistoryAddress } from "@admin/components/features/versions/history-address";
import { historyEnabledFrom } from "@admin/components/features/versions/history-enabled";
import { useHistoryOffered } from "@admin/components/features/versions/history-offered";
import { documentApiAddress } from "@admin/hooks/useEntryJSON";
import type { SingleAdminOptions } from "@admin/types/entities";

/** The panel's props that are about the Single itself. */
export type SinglePanelProps = Required<
  Pick<DocumentPanelProps, "single" | "apiAddress">
> &
  Pick<DocumentPanelProps, "details">;

export function useSinglePanel({
  schema,
  documentId,
  locale,
}: {
  schema: {
    slug: string;
    label: string;
    description?: string;
    admin?: SingleAdminOptions;
    /** The Single's fields, which draw a version of it. */
    fields: readonly unknown[] | undefined;
    versions?: unknown;
  };
  /** The Single's document id, once it exists. */
  documentId: string | undefined;
  /** The language being edited, which who changed it is read in. */
  locale: string | undefined;
}): SinglePanelProps {
  // The bar's own rule, with the facts the Single editor hands the bar.
  const historyOffered = useHistoryOffered(schema.slug, {
    mode: "edit",
    documentId,
    fields: schema.fields,
    enabled: historyEnabledFrom(schema),
  });
  const { setOpen: setHistoryOpen } = useHistoryAddress(historyOffered);
  const details = useEntryDetails({
    scope: "single",
    collectionSlug: schema.slug,
    entryId: documentId,
    locale,
  });
  return {
    single: {
      label: schema.label,
      // The Single's own description, as its declaration's falls back to
      // the one under `admin`.
      description: schema.description || schema.admin?.description,
      ...(historyOffered ? { onOpenHistory: () => setHistoryOpen(true) } : {}),
    },
    apiAddress: documentApiAddress({
      scope: "single",
      collectionSlug: schema.slug,
    }),
    ...(details === undefined ? {} : { details }),
  };
}
