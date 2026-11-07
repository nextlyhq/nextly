/**
 * Empty the link (`forkedFrom`) of every own design copied from a template
 * that is being deleted, in the delete's transaction: the copies are kept,
 * and keep serving their entries, but name no template that is gone.
 *
 * Templates keep drafts, so where the write lands matters. A write that
 * names no status, to a published design, is stored as its working draft and
 * leaves the live row as it was, still naming the deleted template. So a
 * published design is written with its status, which writes the live row;
 * every other is written without one, which for a design never published
 * writes its row directly.
 *
 * A published design with a working draft waiting is the exception. Writing
 * its live row means publishing, and a publish takes the waiting draft live
 * with it: deleting a template would publish someone's unfinished edits. So
 * its link is emptied in the draft alone, which its next publish takes live,
 * and until then the live row names the deleted template. That link is only
 * a record of where the copy came from; nothing serves or finds a design by
 * it but this walk.
 *
 * @module templates/unlink-copies
 */
import { PENDING_CHANGE_KEY } from "nextly/reserved-filter-keys";

import { TEMPLATE_FORKED_FROM_FIELD } from "../collections/templates";
import { asOverwrite } from "../document-version";

/** How many copies one read takes. */
const PAGE = 100;

/** List options, as the services take them. */
interface ListOptions {
  where: Record<string, unknown>;
  pagination: { limit: number };
  depth: number;
}

/** The reads and the write the walk makes, all on the delete's transaction. */
export interface UnlinkServices<Tx> {
  /** The templates' live rows matching `options`, read for update. */
  listForUpdate(
    tx: Tx,
    options: ListOptions
  ): Promise<{ data: readonly unknown[] }>;
  /** The templates' live rows matching `options`, read with a shared lock. */
  list(tx: Tx, options: ListOptions): Promise<{ data: readonly unknown[] }>;
  /** Write `data` to template `id`. */
  update(tx: Tx, id: string, data: Record<string, unknown>): Promise<unknown>;
}

/** A listed row's id as text, or undefined. */
function idOf(row: unknown): string | undefined {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/** Which of `ids` hold a working draft not yet published, read on `tx`. */
async function waitingDrafts<Tx>(
  services: UnlinkServices<Tx>,
  tx: Tx,
  ids: readonly string[]
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const found = await services.list(tx, {
    where: { id: { in: [...ids] }, [PENDING_CHANGE_KEY]: true },
    pagination: { limit: ids.length },
    depth: 0,
  });
  return new Set(
    found.data.flatMap(row => {
      const id = idOf(row);
      return id === undefined ? [] : [id];
    })
  );
}

/**
 * Empty, in `tx`, the link of every own design copied from template `id`.
 *
 * The first page again after each is emptied, so a copy made or removed
 * meanwhile cannot shift one past a page number. A copy read twice (one whose
 * live row keeps the link, as above) is not written again, and a page of
 * nothing but those ends the walk rather than looping on it.
 */
export async function unlinkCopies<Tx>(
  services: UnlinkServices<Tx>,
  tx: Tx,
  id: string
): Promise<void> {
  const emptied = new Set<string>();
  for (;;) {
    const found = await services.listForUpdate(tx, {
      where: { [TEMPLATE_FORKED_FROM_FIELD]: { equals: id } },
      pagination: { limit: PAGE },
      depth: 0,
    });
    const copies = found.data.flatMap(row => {
      const copy = idOf(row);
      return copy === undefined || emptied.has(copy)
        ? []
        : [{ id: copy, published: isPublished(row) }];
    });
    if (copies.length === 0) return;
    const waiting = await waitingDrafts(
      services,
      tx,
      copies.filter(copy => copy.published).map(copy => copy.id)
    );
    for (const copy of copies) {
      const live = copy.published && !waiting.has(copy.id);
      await services.update(
        tx,
        copy.id,
        asOverwrite({
          [TEMPLATE_FORKED_FROM_FIELD]: null,
          ...(live ? { status: "published" } : {}),
        })
      );
      emptied.add(copy.id);
    }
    if (found.data.length < PAGE) return;
  }
}

/** Whether a listed live row is published. */
function isPublished(row: unknown): boolean {
  return (row as { status?: unknown } | null)?.status === "published";
}
