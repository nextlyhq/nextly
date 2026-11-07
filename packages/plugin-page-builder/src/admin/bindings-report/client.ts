"use client";

/**
 * The admin's read of the "Bindings to fix" report, and where each document
 * and binding opens in the editor.
 *
 * @module admin/bindings-report/client
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect } from "react";

import {
  BINDINGS_TO_FIX_ROUTE_PATH,
  type BindingsToFixItem,
  type BindingsToFixMeta,
  type BindingsToFixRow,
} from "../../bindings-report/contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  blockAddress,
  documentBuilderPath,
  singleBuilderPath,
} from "../editor/builder-address";

/** The route's answer. */
export interface BindingsToFixAnswer {
  readonly items: readonly BindingsToFixItem[];
  readonly meta: BindingsToFixMeta & {
    readonly total: number;
    readonly totalPages: number;
  };
}

/** Which part of the report to read. */
export interface BindingsToFixQuery {
  /** One document's part, by its key. */
  readonly document?: string;
  /** One place's documents: pages, components, patterns, layouts, entries, singles. */
  readonly place?: string;
  /** Which page of a hundred documents, from 1. */
  readonly page?: number;
}

/** How often the report is asked again while a check is still to finish. */
const CHECKING_POLL_MS = 10_000;

/**
 * The report as the signed-in person may see it, or the part `query` names.
 * Its counts are always of everything they may see. Kept for half a minute,
 * so a count shown on many screens is not asked again on each; asked again
 * every ten seconds while the check of every document has not finished, since
 * the route answers at once with what was stored and the check goes on.
 */
export function useBindingsToFix(query: BindingsToFixQuery = {}): {
  readonly data: BindingsToFixAnswer | undefined;
  readonly pending: boolean;
  readonly error: unknown;
  readonly refetch: () => void;
} {
  const params = new URLSearchParams();
  if (query.document !== undefined) params.set("document", query.document);
  if (query.place !== undefined) params.set("place", query.place);
  if (query.page !== undefined && query.page > 1) {
    params.set("page", String(query.page));
  }
  const search = params.size === 0 ? "" : `?${params.toString()}`;
  const read = usePluginRoute<BindingsToFixAnswer>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: `${BINDINGS_TO_FIX_ROUTE_PATH}${search}`,
    staleTime: 30_000,
  });
  const meta = read.data?.meta;
  const unsettled =
    meta !== undefined && (meta.checkedAt === null || meta.checking);
  const { refetch } = read;
  useEffect(() => {
    if (!unsettled) return undefined;
    const timer = setInterval(refetch, CHECKING_POLL_MS);
    return () => clearInterval(timer);
    // `refetch` is a new function each render, which an answer arriving
    // causes, so the timer restarts from each answer: ten seconds after it.
  }, [unsettled, refetch]);
  return read;
}

/** Whether every document has been checked against the schema as it is now. */
export function checkedNow(meta: BindingsToFixMeta): boolean {
  return meta.checkedAt !== null && !meta.checking;
}

/**
 * Where a binding opens in the editor: its document's builder, on the blocks
 * field it is in, with its block selected. A binding in the document's own
 * metadata opens the document with nothing selected; one in a page's Layout
 * region opens the component the region places, where it is edited; one in
 * another language than the default opens nowhere (`undefined`), since the
 * builder edits the default language only.
 */
export function editorAddressOf(
  item: Pick<BindingsToFixItem, "kind" | "slug" | "documentId">,
  row?: Pick<
    BindingsToFixRow,
    "nodeId" | "blocksField" | "opens" | "inAnotherLanguage"
  >
): string | undefined {
  if (row?.inAnotherLanguage === true) return undefined;
  if (row?.opens !== undefined) {
    return documentBuilderPath(row.opens.slug, row.opens.id);
  }
  const base =
    item.kind === "single"
      ? singleBuilderPath(item.slug)
      : documentBuilderPath(item.slug, item.documentId ?? "");
  const params = new URLSearchParams();
  if (row?.blocksField !== undefined && row.blocksField !== "") {
    params.set("field", row.blocksField);
  }
  const href = params.size === 0 ? base : `${base}?${params.toString()}`;
  return row === undefined || row.nodeId === ""
    ? href
    : blockAddress(href, row.nodeId);
}
