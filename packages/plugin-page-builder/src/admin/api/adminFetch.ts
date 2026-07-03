/**
 * Minimal admin REST client for the full editor (spec §11). The custom Edit view gets
 * no save function and `entryApi` is not a public export, so we persist via the public
 * admin REST surface with same-origin cookie auth. Base + envelope verified in
 * NOTES-platform.md: base `/admin/api`, mutation envelope `{ message, item }`.
 */
import type { BlockDocument } from "../../core/types";

const ENTRIES = "/admin/api/collections/pages/entries";

export interface SavePageInput {
  id?: string;
  title: string;
  slug: string;
  content: BlockDocument;
  customCss: string;
  status: "draft" | "published";
}

async function handle(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  // Mutation envelope is `{ message, item }`; fall back to the bare body.
  return (body.item as Record<string, unknown>) ?? body;
}

/** Create (POST) or update (PATCH) the page. Returns the saved entry. */
export async function savePage(
  input: SavePageInput
): Promise<Record<string, unknown>> {
  const { id, ...payload } = input;
  const res = await fetch(id ? `${ENTRIES}/${id}` : ENTRIES, {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function deletePage(id: string): Promise<void> {
  const res = await fetch(`${ENTRIES}/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  await handle(res);
}
