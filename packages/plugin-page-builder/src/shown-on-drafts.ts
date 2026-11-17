/**
 * Which places, of those the index found only in a document's unpublished
 * working draft, the caller is shown: the ones core's own read of the
 * document, as the caller asking for its working draft, holds.
 *
 * Core decides per document whether a caller sees its working draft: one
 * who may update it, or else publish it, and only where no read rule's
 * filter is in force. So the question is asked of that read, not of a
 * permission beside it: a place is shown where the value the caller's read
 * answers still binds the Single in that block.
 *
 * @module shown-on-drafts
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";

import { bindingUsesOf } from "./bindings-report/uses";
import { readingAsUser } from "./library-route";

/** A document holding places found only in its working draft. */
export interface DraftDocument {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly documentId?: string;
  /** The blocks fields those places are in, as dotted paths. */
  readonly fields: readonly string[];
  /** The language of the values they are in, where stored per language. */
  readonly locale?: string;
}

/** The value at a dotted path, or `undefined`. */
function valueAt(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** The document as the caller's read answers it, its working draft asked for. */
async function readAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  document: DraftDocument
): Promise<unknown> {
  const as = await readingAsUser(ctx);
  const nextly = requireNextly();
  const inLocale =
    document.locale === undefined ? {} : { locale: document.locale };
  try {
    if (document.kind === "single") {
      return await nextly.findSingle({
        slug: document.slug,
        createIfMissing: false,
        depth: 0,
        draft: true,
        ...inLocale,
        ...as,
      });
    }
    return await nextly.findByID({
      collection: document.slug,
      id: document.documentId ?? "",
      depth: 0,
      draft: true,
      status: "all",
      ...inLocale,
      ...as,
    } as never);
  } catch (error) {
    // Refused, or not there for them: none of it is theirs to see.
    if (NextlyError.isForbidden(error) || NextlyError.isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * The places of `document` the caller's own read shows binding `single`, as
 * `<blocks field>\0<node id>` keys.
 */
export async function draftPlacesShown(
  ctx: Pick<PluginRouteContext, "caller">,
  document: DraftDocument,
  single: string,
  maxNodes: number
): Promise<ReadonlySet<string>> {
  const row = await readAsCaller(ctx, document);
  const shown = new Set<string>();
  if (row === null || row === undefined) return shown;
  for (const field of document.fields) {
    for (const use of bindingUsesOf(valueAt(row, field), maxNodes)) {
      if (use.sourceKey === single) shown.add(`${field}\u0000${use.nodeId}`);
    }
  }
  return shown;
}
