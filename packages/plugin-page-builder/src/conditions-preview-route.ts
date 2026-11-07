/**
 * The read behind applying a page's visibility conditions in the editor: what
 * a visitor reads of the page being edited.
 *
 * A page's conditions read the page's own fields. Applying them shows the
 * page as a visitor would get it, so this answers only what a visitor reads:
 * the page's published values through the public reader, which reads
 * published rows only and judges the read by the anonymous caller's rules,
 * and the fields a visitor may read. The page's working draft and anything
 * only the editor may read never leave the server.
 *
 * ## Which documents it reads
 *
 * Only one the editor may open: an entry of a collection that stores a blocks
 * field at its top level (the page builder's pages, and any collection whose
 * entries are built with blocks), which the caller can read through the
 * editor reader, as the editor itself reads it. Anything else (a collection
 * without a blocks field, one that does not exist, an entry the caller may
 * not read or that does not exist) gets the same forbidden answer, so the
 * answer never says which.
 *
 * ## Caching
 *
 * None: each answer is asked by one person, so the route is `noStore`.
 *
 * @experimental Settles with the editor's condition controls.
 * @module conditions-preview-route
 */
import {
  resolvedCollectionView,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";
import { z } from "nextly/zod";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import { labelOf } from "./collection-labels";
import { readBodyWith } from "./composition-route-kit";
import {
  CONDITIONS_PREVIEW_ENTRY_PATH,
  type ConditionsPreviewRequest,
  type ConditionsPreviewResponse,
} from "./conditions-preview-contract";
import { ENTRIES_LOCALE_MAX } from "./entries-contract";
import type {
  CollectionRecordRead,
  TemplateGuardSetup,
} from "./templates/template-guard";
import {
  directEntryReads,
  missedOrRefused,
  previewRefusal,
  visitorView,
  type PreviewEntryReads,
} from "./templates/template-preview-route";

/** The body: the page's collection, its id, and the language edited. */
const Body = z
  .object({
    collection: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    id: z.string().min(1).max(200),
    locale: z.string().min(1).max(ENTRIES_LOCALE_MAX).optional(),
  })
  .strict();

/** What the read reads with, injected so it is tested without a server. */
export interface ConditionsPreviewReads
  extends Pick<
    PreviewEntryReads,
    "editorEntry" | "publicEntry" | "publicFields"
  > {
  /** The collection's registry record, or `null` for none. */
  readonly readCollection: CollectionRecordRead;
}

/** The route's name in the log, beside the collection a refusal names. */
const ROUTE = "conditions preview entry";

/**
 * What a visitor reads of a page the caller may open in the editor, or the
 * one forbidden answer.
 *
 * The page must be one the editor opens, checked first: its collection holds
 * a top-level blocks field, and the caller reads the entry through the editor
 * reader. Only then is anything read as a visitor.
 */
export async function readConditionsPreview(
  request: ConditionsPreviewRequest,
  reads: ConditionsPreviewReads
): Promise<ConditionsPreviewResponse> {
  const { collection } = request;
  const record = await reads.readCollection(collection);
  if (
    record === null ||
    blocksFieldsOf({ fields: resolvedCollectionView(record).fields }).length ===
      0
  ) {
    throw previewRefusal(ROUTE, collection);
  }
  let opened: Record<string, unknown> | null;
  try {
    opened = await reads.editorEntry(request);
  } catch (error) {
    if (missedOrRefused(error)) throw previewRefusal(ROUTE, collection);
    throw error;
  }
  if (opened === null) throw previewRefusal(ROUTE, collection);
  // Only now, with the page shown to be the caller's to open: read as a
  // visitor reads it.
  const { publicValues, fields } = await visitorView(request, reads);
  return {
    id: request.id,
    noun: labelOf(record, collection),
    publicValues,
    fields,
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: the page is chosen by the body, which a permission
 * resolver never sees, and core's gate judges the editor read as the caller.
 * A POST because the read carries a body, never because it writes.
 */
export function conditionsPreviewEntryRoute(setup: {
  readonly guard: () => TemplateGuardSetup;
}): {
  method: "POST";
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: CONDITIONS_PREVIEW_ENTRY_PATH,
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, Body, ROUTE);
      const bound = directEntryReads(ctx, setup.guard);
      return respondDoc(
        await readConditionsPreview(body, {
          readCollection: slug => bound.collections.readCollection(slug),
          editorEntry: request => bound.editorEntry(request),
          publicEntry: request => bound.publicEntry(request),
          publicFields: (collection, locale) =>
            bound.publicFields(collection, locale),
        })
      );
    },
  };
}
