"use client";

/**
 * The editor's side of the conditions preview's read: what a visitor reads of
 * the page being edited, for applying its visibility conditions.
 *
 * @module admin/conditions-preview-client
 */

import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

// The CONTRACT, not the route: the route reads through the server's runtime.
import {
  CONDITIONS_PREVIEW_ENTRY_PATH,
  type ConditionsPreviewRequest,
  type ConditionsPreviewResponse,
} from "../conditions-preview-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** Whether an answer has the shape the route sends. */
function isAnswer(body: unknown): body is ConditionsPreviewResponse {
  if (typeof body !== "object" || body === null) return false;
  const { id, noun, publicValues, fields } =
    body as Partial<ConditionsPreviewResponse>;
  return (
    typeof id === "string" &&
    typeof noun === "string" &&
    (publicValues === null || typeof publicValues === "object") &&
    Array.isArray(fields)
  );
}

/** What a visitor reads of the page; throws when it can't be read. */
export async function readConditionsPreview(
  request: ConditionsPreviewRequest
): Promise<ConditionsPreviewResponse> {
  const body = await writePluginRoute<ConditionsPreviewResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: CONDITIONS_PREVIEW_ENTRY_PATH,
    method: "POST",
    body: request,
  });
  if (!isAnswer(body)) {
    throw new Error("What a visitor reads of this page could not be read.");
  }
  return body;
}
