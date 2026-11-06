/**
 * What a page holds as saved, read by its id.
 *
 * By id, not by finding it in the list: a list read returns one page of
 * entries, and in a full run more pages exist than one list page holds, so a
 * page created by this test falls off it and reads as holding nothing, which
 * looks exactly like a save that lost every block.
 *
 * `status=all` reads a page whatever its status, and `draft=true` lays the
 * pending working draft over the stored row, so a page saved as a draft reads
 * as the editor saved it.
 */
import { expect, type APIRequestContext } from "@playwright/test";

/** The top-level nodes of a page's Page Builder field as saved. */
export async function storedPageNodes(
  request: APIRequestContext,
  entries: string,
  id: string,
  field = "content"
): Promise<Record<string, unknown>[]> {
  const response = await request.get(
    `${entries}/${encodeURIComponent(id)}?status=all&draft=true`
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const document = body[field] as { nodes?: unknown } | undefined;
  return Array.isArray(document?.nodes)
    ? (document.nodes as Record<string, unknown>[])
    : [];
}
