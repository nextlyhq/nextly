/**
 * Putting a removed Layout back from the copy its removal took.
 *
 * Used in one situation only: the settings Single names a Layout that no
 * longer exists, because a promotion committed after the removal's last look
 * at the default and before its delete. Pages drawn inside the default would
 * otherwise lose their regions until the repair re-pointed the default at the
 * seed, losing the author's choice of default with them.
 *
 * ## Under a new id, never over an existing Layout
 *
 * The restored Layout is created afresh and the Single is pointed at it.
 * Creating it under the old id would need ids to be accepted on create, which
 * would let anyone with create rights take over a deleted Layout's id. And a
 * Layout that still exists is never written from a copy: an edit made since
 * the copy would be lost.
 *
 * ## Claimed before it is done
 *
 * The removal's own check after its delete and the default repair can both
 * find the same missing default. The one that moves the row to `restoring`
 * restores; the other finds the row moved and leaves it, so a Layout is never
 * restored twice.
 *
 * @module layout-removal/restore
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  layoutExists,
  readLayoutSettings,
  relationId,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "../default-layout/store";

import { areaRows } from "./layout-copy";
import type { LayoutCopy, LayoutRemoval, LayoutRemovalStore } from "./store";

/** How many addresses a restore tries when its own is taken. */
const SLUG_ATTEMPTS = 5;

/** What a restore needs. */
export interface RestoreDeps {
  readonly nextly: Pick<
    DefaultLayoutDirectApi,
    "create" | "update" | "findSingle" | "updateSingle"
  >;
  readonly store: LayoutRemovalStore;
  readonly slugs: DefaultLayoutSlugs;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The columns a stored Layout row carries that the system writes, never an
 * author: its id, its timestamps and its lifecycle. A restore leaves them to
 * the write it makes. Keys starting with `_` (a read's own bookkeeping, such as
 * `_isWorkingDraft`) are left off too.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "firstPublishedAt",
  "first_published_at",
  "publishedAt",
  "published_at",
]);

/**
 * The authored fields of a stored Layout row, as a write takes them: the whole
 * row less what the system writes, so fields another plugin added to Layouts
 * come back with it. The address is left to each caller, which knows whether
 * the row's own is still free.
 */
function authored(row: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_FIELDS.has(key) || key === "slug" || key.startsWith("_")) {
      continue;
    }
    fields[key] = value;
  }
  // Read through `areaRows`, so a copy holding the repeater as SQLite's JSON
  // text keeps its areas as the other dialects' copies do.
  fields.areas = areaRows(row).map(area => {
    if (typeof area !== "object" || area === null) return area;
    // A repeater row's own id belongs to the deleted Layout's rows.
    const rest: Record<string, unknown> = { ...area };
    delete rest.id;
    return rest;
  });
  return fields;
}

/**
 * Put a Layout a removal unpublished back as its copy held it: its live row
 * published again with the copy's content, then its working draft as a
 * working draft. Written as the system, carrying the removal's token, since
 * the removal still holds the Layout. Used when a page published while the
 * unpublish ran still names the Layout, so the unpublish changes nothing.
 */
export async function republishFromCopy(
  deps: Pick<RestoreDeps, "nextly" | "slugs" | "warn">,
  layoutId: string,
  copy: LayoutCopy | null,
  context: Record<string, unknown>
): Promise<void> {
  const slug = copy?.live.slug;
  await deps.nextly.update({
    collection: deps.slugs.layouts,
    id: layoutId,
    data: {
      ...(copy === null ? {} : authored(copy.live)),
      ...(typeof slug === "string" && slug !== "" ? { slug } : {}),
      status: "published",
    },
    overrideAccess: true,
    context,
  });
  if (copy !== null) await restoreDraft(deps, layoutId, copy, context);
}

/**
 * The working draft's own address, when its edit changed it; `null` when the
 * draft keeps the live row's, which the restored Layout already has (under the
 * next free address if its own was taken).
 */
function draftSlug(copy: LayoutCopy): string | null {
  const slug = copy.draft?.slug;
  return typeof slug === "string" && slug !== "" && slug !== copy.live.slug
    ? slug
    : null;
}

/**
 * Save the copy's working draft onto the restored Layout, without a status, so
 * it is the working draft again rather than its published form. Its own
 * address goes with it; one another Layout took meanwhile is left off, with a
 * log line, rather than failing the restore.
 */
async function restoreDraft(
  deps: Pick<RestoreDeps, "nextly" | "slugs" | "warn">,
  restored: string,
  copy: LayoutCopy,
  /** The hook context the writes carry: a removal's token, where one holds the Layout. */
  context?: Record<string, unknown>
): Promise<void> {
  const draft = copy.draft;
  if (draft === null) return;
  const slug = draftSlug(copy);
  const save = (data: Record<string, unknown>) =>
    deps.nextly.update({
      collection: deps.slugs.layouts,
      id: restored,
      data,
      overrideAccess: true,
      ...(context === undefined ? {} : { context }),
    });
  try {
    await save({ ...authored(draft), ...(slug === null ? {} : { slug }) });
  } catch (error) {
    if (slug === null || !NextlyError.isCode(error, "DUPLICATE")) throw error;
    deps.warn(
      "[page-builder] a restored Layout's working draft kept its published address, since another Layout holds the one the draft chose",
      { restoredLayout: restored, slug }
    );
    await save(authored(draft));
  }
}

/**
 * The addresses a restored Layout may be created under, in order: its own,
 * the numbered ones after it, and last one named for its removal, which only
 * a Layout created to block it would hold.
 */
function slugsFor(base: string, token: string): string[] {
  const numbered = Array.from({ length: SLUG_ATTEMPTS }, (_, attempt) =>
    attempt === 0 ? base : `${base}-${String(attempt + 1)}`
  );
  return [...numbered, `${base}-${token.slice(0, 8)}`];
}

/** Create the Layout from the copy, published, under the first free address. */
async function createFromCopy(
  deps: RestoreDeps,
  copy: LayoutCopy,
  token: string
): Promise<string> {
  const base =
    typeof copy.live.slug === "string" && copy.live.slug !== ""
      ? copy.live.slug
      : "restored-layout";
  const slugs = slugsFor(base, token);
  for (const [attempt, slug] of slugs.entries()) {
    try {
      const created = await deps.nextly.create({
        collection: deps.slugs.layouts,
        data: { ...authored(copy.live), slug, status: "published" },
        overrideAccess: true,
      });
      const id = relationId(created.item);
      if (id === null) throw NextlyError.internal();
      return id;
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      if (attempt + 1 >= slugs.length) throw error;
    }
  }
  throw NextlyError.internal();
}

/**
 * Create the restored Layout, or, when every address it could take is held,
 * put the row back at the step it was claimed from. Nothing was created then,
 * so the copy is kept and a later repair or sweep tries again; leaving the
 * row at `restoring` would have the sweep settle it and drop the only copy.
 */
async function createOrRelease(
  deps: RestoreDeps,
  removal: LayoutRemoval,
  copy: LayoutCopy
): Promise<string> {
  try {
    return await createFromCopy(deps, copy, removal.token);
  } catch (error) {
    if (NextlyError.isCode(error, "DUPLICATE")) {
      await deps.store.advance({
        layoutId: removal.layoutId,
        token: removal.token,
        from: "restoring",
        to: removal.step,
      });
      deps.warn(
        "[page-builder] a deleted default Layout could not be restored, since every address it could take is held by another Layout; its copy is kept and the restore will be tried again",
        { removedLayout: removal.layoutId }
      );
    }
    throw error;
  }
}

/**
 * Restore the Layout `removal` deleted, if the default still names it and the
 * row can be claimed. Answers the new id, or `null` when there was nothing to
 * restore here (no copy, another run claimed it, or the default moved on).
 */
export async function restoreFromCopy(
  deps: RestoreDeps,
  removal: LayoutRemoval
): Promise<string | null> {
  const copy = removal.copy;
  if (copy === null || removal.action !== "delete") return null;
  const { defaultLayout } = await readLayoutSettings(deps.nextly, deps.slugs);
  if (defaultLayout !== removal.layoutId) return null;
  const claimed = await deps.store.advance({
    layoutId: removal.layoutId,
    token: removal.token,
    from: removal.step,
    to: "restoring",
  });
  if (!claimed) return null;

  const restored = await createOrRelease(deps, removal, copy);
  if (copy.draft !== null) await restoreDraft(deps, restored, copy);
  // Re-read just before writing: a newer choice of default made meanwhile is
  // kept, and the restored Layout is then simply one more Layout.
  const latest = await readLayoutSettings(deps.nextly, deps.slugs);
  if (latest.defaultLayout === removal.layoutId) {
    await writeLayoutSettings(deps.nextly, deps.slugs, {
      defaultLayout: restored,
      defaultLayoutChangedBy: null,
    });
  }
  await deps.store.settle(removal.layoutId, removal.token, "restoring");
  deps.warn(
    "[page-builder] a Layout was made the default while it was being deleted, so it was restored from its copy under a new id and the default points at it",
    { removedLayout: removal.layoutId, restoredLayout: restored }
  );
  return restored;
}

/**
 * The repair's half: the settings name `layoutId`, which no longer exists.
 * Restore it when its removal holds a copy and has not been settled; answer
 * the new id, or `null` when there is nothing to restore from. A Layout that
 * still exists is never written from a copy.
 */
export async function restoreMissingDefault(
  deps: RestoreDeps & { readonly nextly: Pick<DefaultLayoutDirectApi, "find"> },
  layoutId: string
): Promise<string | null> {
  if (await layoutExists(deps.nextly, deps.slugs, layoutId)) return null;
  const removal = await deps.store.removalOf(layoutId);
  if (removal === null) return null;
  if (removal.step !== "final" && removal.step !== "removed") return null;
  return restoreFromCopy(deps, removal);
}
