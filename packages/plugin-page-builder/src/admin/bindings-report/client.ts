"use client";

/**
 * The admin's read of the "Bindings to fix" report, and where each document
 * and binding opens in the editor.
 *
 * @module admin/bindings-report/client
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

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

/**
 * The report as the signed-in person may see it, or the part `query` names.
 * Its counts are always of everything they may see. Kept for half a minute,
 * so a count shown on many screens is not asked again on each.
 */
export function useBindingsToFix(query: BindingsToFixQuery = {}): {
  readonly data: BindingsToFixAnswer | undefined;
  readonly pending: boolean;
  readonly error: unknown;
} {
  const params = new URLSearchParams();
  if (query.document !== undefined) params.set("document", query.document);
  if (query.place !== undefined) params.set("place", query.place);
  if (query.page !== undefined && query.page > 1) {
    params.set("page", String(query.page));
  }
  const search = params.size === 0 ? "" : `?${params.toString()}`;
  return usePluginRoute<BindingsToFixAnswer>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: `${BINDINGS_TO_FIX_ROUTE_PATH}${search}`,
    staleTime: 30_000,
  });
}

/**
 * Where a binding opens in the editor: its document's builder, on the blocks
 * field it is in, with its block selected. A binding in the document's own
 * metadata opens the document with nothing selected.
 */
export function editorAddressOf(
  item: Pick<BindingsToFixItem, "kind" | "slug" | "documentId">,
  row?: Pick<BindingsToFixRow, "nodeId" | "blocksField">
): string {
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
