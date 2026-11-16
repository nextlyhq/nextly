"use client";

/**
 * The editor's reads for a template's preview: the entries of its
 * collection the author may preview, and the one being previewed, each
 * through the template preview routes, as the author.
 *
 * Each read is made through the admin's own route write, which carries the
 * session and the CSRF token as every plugin read with a body does, and a
 * refusal rejects with the route's own words. Nothing is kept here: the
 * strip asks again when the window regains focus, so an entry made in
 * another tab can be previewed without a reload.
 *
 * @module admin/template-preview-client
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reads through the server's runtime.
import {
  TEMPLATE_PREVIEW_ENTRIES_PATH,
  TEMPLATE_PREVIEW_ENTRY_PATH,
  type PreviewEntriesRequest,
  type PreviewEntriesResponse,
  type PreviewEntryRequest,
  type PreviewEntryResponse,
} from "../templates/template-preview-contract";

/** What a successful answer must at least hold to be read as one. */
function isListAnswer(body: unknown): body is PreviewEntriesResponse {
  if (typeof body !== "object" || body === null) return false;
  const { items, meta } = body as Partial<PreviewEntriesResponse>;
  return (
    Array.isArray(items) &&
    typeof meta === "object" &&
    meta !== null &&
    typeof meta.mayCreate === "boolean"
  );
}

/**
 * The entries of `request.collection` the author may preview, newest first.
 * Rejects where the route refused the collection or the read failed; an
 * empty list is an answer, never a stand-in for a failure.
 */
export async function listPreviewEntries(
  request: PreviewEntriesRequest
): Promise<PreviewEntriesResponse> {
  const body = await writePluginRoute<PreviewEntriesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATE_PREVIEW_ENTRIES_PATH,
    method: "POST",
    body: request,
  });
  if (!isListAnswer(body)) {
    throw new Error("The entries to preview could not be read.");
  }
  return body;
}

/** The entry a template previews, as the author and as the public read it. */
export async function readPreviewEntry(
  request: PreviewEntryRequest
): Promise<PreviewEntryResponse> {
  const body = await writePluginRoute<PreviewEntryResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATE_PREVIEW_ENTRY_PATH,
    method: "POST",
    body: request,
  });
  if (
    body === undefined ||
    typeof body.id !== "string" ||
    typeof body.editorValues !== "object"
  ) {
    throw new Error("The entry being previewed could not be read.");
  }
  return body;
}
