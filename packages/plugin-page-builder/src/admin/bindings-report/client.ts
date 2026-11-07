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
  readonly meta: BindingsToFixMeta & { readonly total: number };
}

/**
 * The report as the signed-in person may see it; one document's part of it
 * when `document` names one. Read fresh on each mount and kept for half a
 * minute, so a count shown on many screens is not asked again on each.
 */
export function useBindingsToFix(document?: string): {
  readonly data: BindingsToFixAnswer | undefined;
  readonly pending: boolean;
  readonly error: unknown;
} {
  const query =
    document === undefined
      ? ""
      : `?${new URLSearchParams({ document }).toString()}`;
  return usePluginRoute<BindingsToFixAnswer>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: `${BINDINGS_TO_FIX_ROUTE_PATH}${query}`,
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
