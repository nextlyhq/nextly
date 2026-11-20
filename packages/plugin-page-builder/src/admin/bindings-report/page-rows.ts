"use client";
/**
 * The open document's bindings that no longer fit, as its canvas shows
 * them: in the field the editor is open on, in the default language it
 * edits. One reading, so the top bar's chip and Page checks list the same
 * bindings.
 *
 * @module admin/bindings-report/page-rows
 */
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import type {
  BindingsToFixItem,
  BindingsToFixRow,
} from "../../bindings-report/contract";
import { documentKeyOf } from "../../host-rewrite/contract";

import { useBindingsToFix } from "./client";

/** The open document's key in the report, or `undefined` before it is saved. */
function useDocumentKey(): string | undefined {
  const identity = useDocumentIdentity();
  if (identity === null || identity === undefined) return undefined;
  if (identity.kind === "single") {
    return documentKeyOf({ kind: "single", slug: identity.slug });
  }
  return identity.documentId === undefined
    ? undefined
    : documentKeyOf({
        kind: "collection",
        slug: identity.slug,
        id: identity.documentId,
      });
}

/** The open document's report entry and the rows on its canvas. */
export interface PageBindingsToFix {
  /** The document's key in the report; undefined before it is saved. */
  readonly key: string | undefined;
  /** Its entry in the report, once read; undefined while it has none. */
  readonly item: BindingsToFixItem | undefined;
  /** Its bindings on this canvas: the field `field`, the default language. */
  readonly rows: readonly BindingsToFixRow[];
}

/** The open document's bindings to fix on the canvas of the field `field`. */
export function usePageBindingsToFix(field: string): PageBindingsToFix {
  const key = useDocumentKey();
  const report = useBindingsToFix(key === undefined ? {} : { document: key });
  const item =
    key === undefined
      ? undefined
      : report.data?.items.find(entry => entry.documentKey === key);
  // Kept while the entry and the field are the same: a new list each render
  // gave the page checks, which read these rows, new facts on every click and
  // keystroke, and every check ran again over a page that had not changed.
  const rows = useMemo(
    () =>
      (item?.rows ?? []).filter(
        row =>
          (row.blocksField === undefined || row.blocksField === field) &&
          row.inAnotherLanguage !== true
      ),
    [item, field]
  );
  return { key, item, rows };
}
