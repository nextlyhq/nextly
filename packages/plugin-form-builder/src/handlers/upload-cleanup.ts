/**
 * The files of uploads no submission holds any more, deleted once that is
 * durable.
 *
 * An upload is released in the transaction that deletes its submission (one
 * deletion, a bulk one, the retention pass, or deleting the whole form), or
 * when a visitor uploaded it and never submitted (`releaseStaleUploads`,
 * after {@link UNCLAIMED_KEEP_MS}). Once released, its file is deleted after
 * the release commits, never inside it: a file cannot be put back by a
 * rollback. Before deleting, each is checked again: no other record of an
 * upload holds the same file, and nothing else on the site uses it
 * (`ctx.services.media.isInUse`: a document's field, an avatar, a logo). A
 * file in use is kept, with its record, and asked about again on the next
 * nightly pass, so it goes once nothing uses it.
 *
 * The file goes through `ctx.services.media.delete`, which records the
 * item's stored files as left to remove in the delete's own transaction and
 * has core's jobs queue remove them until they are gone. So once it returns
 * the bytes are core's to finish, even when storage refused them this time,
 * and the record here can go.
 *
 * Every step can run twice: a file or record already gone is what the step
 * wanted. A deletion that could not finish (a database error, a crash between
 * the commit and the delete) leaves the record released, and the nightly
 * retention pass finishes it, carrying on from where its last run stopped.
 *
 * @module handlers/upload-cleanup
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

/** How long an upload no submission claimed is kept: a day. */
const UNCLAIMED_KEEP_MS: number = 24 * 60 * 60 * 1000;

/** Rows read at a time. */
const PAGE = 100;

/** What freeing uploads reads, writes and deletes with. */
export interface UploadCleanupDeps {
  own: PluginContext["services"]["ownCollections"];
  collections: PluginContext["services"]["collections"];
  media: Pick<
    PluginContext["services"]["media"],
    "findById" | "isInUse" | "delete"
  >;
  uploadsSlug: string;
}

/** An upload as recorded. */
interface UploadRow {
  id: unknown;
  media?: unknown;
  submission?: unknown;
  releasedAt?: unknown;
}

function pastDeadline(deadline: Date | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline.getTime();
}

/** `work`, with a `NOT_FOUND` read as done: what it removes is gone. */
async function goneIsDone(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!NextlyError.isNotFound(error)) throw error;
  }
}

/** Whether another record that is not released holds the same file. */
async function heldElsewhere(
  deps: UploadCleanupDeps,
  upload: UploadRow
): Promise<boolean> {
  const others = await deps.own.count(deps.uploadsSlug, {
    where: {
      media: { equals: String(upload.media) },
      id: { not_equals: String(upload.id) },
      releasedAt: { exists: false },
    },
  });
  return others > 0;
}

/** Whether the media item is still there. */
async function mediaPresent(
  deps: UploadCleanupDeps,
  mediaId: string
): Promise<boolean> {
  try {
    await deps.media.findById(mediaId, {});
    return true;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Free one released upload: delete its file unless another record holds it
 * or something else uses it, then its record. A file in use keeps its
 * record, for the next pass. Answers whether the record is gone. Its stored
 * bytes are removed durably by the media delete itself, so the record need
 * not outlive it.
 */
async function freeUpload(
  deps: UploadCleanupDeps,
  upload: UploadRow
): Promise<boolean> {
  const mediaId = String(upload.media);
  const fileIsOurs =
    !(await heldElsewhere(deps, upload)) && (await mediaPresent(deps, mediaId));
  if (fileIsOurs) {
    if (await deps.media.isInUse(mediaId)) return false;
    await goneIsDone(() => deps.media.delete(mediaId, { as: "system" }));
  }
  await goneIsDone(() =>
    deps.collections.deleteEntry(deps.uploadsSlug, String(upload.id), {
      as: "system",
    })
  );
  return true;
}

/** The next page of released uploads `where` narrows to, after `after`. */
async function releasedAfter(
  deps: UploadCleanupDeps,
  where: Record<string, unknown>,
  after: string | undefined
): Promise<UploadRow[]> {
  const { data } = await deps.own.listEntries(deps.uploadsSlug, {
    where: {
      ...where,
      releasedAt: { exists: true },
      ...(after === undefined ? {} : { id: { greater_than: after } }),
    },
    sort: { field: "id", direction: "asc" },
    pagination: { limit: PAGE },
    depth: 0,
  });
  return data;
}

/**
 * Where the nightly sweep carries on from: past the released records it
 * checked, by id, and past all of them once `releasedDone`. Handed to the
 * retention pass's continuation, so records kept because their file is in
 * use are not checked again by every run while those after them, and the
 * uploads nobody claimed, wait.
 */
export interface UploadSweepCursor {
  releasedDone?: boolean;
  afterUpload?: string;
}

/**
 * Free the released uploads `where` selects (every one, by default), in id
 * order from just after `from`, until `deadline`. Answers "done", or where
 * it stopped.
 */
async function freeReleasedUploads(
  deps: UploadCleanupDeps,
  where: Record<string, unknown> = {},
  deadline?: Date,
  from?: string
): Promise<"done" | UploadSweepCursor> {
  let after = from;
  for (;;) {
    const page = await releasedAfter(deps, where, after);
    for (const upload of page) {
      if (pastDeadline(deadline)) {
        return after === undefined ? {} : { afterUpload: after };
      }
      await freeUpload(deps, upload);
      after = String(upload.id);
    }
    if (page.length < PAGE) return "done";
  }
}

/**
 * Release an upload nobody claimed, if nobody has since: read for update,
 * so a submission claiming it at this moment either commits first and it
 * stays, or waits and is refused. Answers the released row, or none.
 */
async function giveUp(
  deps: UploadCleanupDeps,
  id: string
): Promise<UploadRow | undefined> {
  return deps.collections.withTransaction(async tx => {
    let upload: UploadRow | null;
    try {
      upload = await deps.own.findEntryByIdInTransaction(
        tx,
        deps.uploadsSlug,
        id,
        { lock: "update" }
      );
    } catch (error) {
      if (NextlyError.isNotFound(error)) return undefined;
      throw error;
    }
    if (!upload || upload.submission || upload.releasedAt) return undefined;
    const releasedAt = new Date();
    await deps.collections.updateEntryInTransaction(tx, deps.uploadsSlug, id, {
      releasedAt,
      _overwrite: true,
    });
    return { ...upload, releasedAt };
  });
}

/**
 * Release and free the uploads no submission claimed within a day of being
 * uploaded: a visitor who uploaded and never submitted. Answers false when
 * the deadline stopped it first. Each released row stops matching, so the
 * first page is always the next batch.
 */
async function releaseStaleUploads(
  deps: UploadCleanupDeps,
  now: number,
  deadline?: Date
): Promise<boolean> {
  const where = {
    submission: { exists: false },
    releasedAt: { exists: false },
    createdAt: { less_than: new Date(now - UNCLAIMED_KEEP_MS) },
  };
  for (;;) {
    const { data } = await deps.own.listEntries(deps.uploadsSlug, {
      where,
      pagination: { limit: PAGE },
      depth: 0,
    });
    for (const row of data as UploadRow[]) {
      if (pastDeadline(deadline)) return false;
      const released = await giveUp(deps, String(row.id));
      if (released) await freeUpload(deps, released);
    }
    if (data.length < PAGE) return true;
  }
}

/**
 * The nightly part, from `cursor`: retry the released uploads an earlier
 * deletion could not free, then give up on the ones never claimed. Answers
 * "done", or where the deadline stopped it.
 */
export async function sweepUploads(
  deps: UploadCleanupDeps,
  now: number,
  deadline: Date,
  cursor: UploadSweepCursor = {}
): Promise<"done" | UploadSweepCursor> {
  if (!cursor.releasedDone) {
    const stopped = await freeReleasedUploads(
      deps,
      {},
      deadline,
      cursor.afterUpload
    );
    if (stopped !== "done") return stopped;
  }
  return (await releaseStaleUploads(deps, now, deadline))
    ? "done"
    : { releasedDone: true };
}

/** An after-delete hook's deleted id, and its hold until the commit. */
interface DeletedHook {
  data?: { id?: unknown };
  afterCommit?: (effect: () => unknown) => Promise<void>;
}

/**
 * Once the deletion `context` describes is durable, free the uploads it
 * released. With no way to wait for the commit, it leaves them to the
 * nightly pass rather than delete a file a rollback would still need.
 */
function freeAfterCommit(
  context: unknown,
  deps: UploadCleanupDeps,
  whereFor: (id: string) => Record<string, unknown>
): Promise<void> | undefined {
  const hook = context as DeletedHook;
  const id = hook.data?.id;
  if ((typeof id !== "string" && typeof id !== "number") || !hook.afterCommit) {
    return undefined;
  }
  return hook.afterCommit(() =>
    freeReleasedUploads(deps, whereFor(String(id)))
  );
}

/**
 * Free the files of every deletion's released uploads after it commits: one
 * submission's, and a form's (its submissions' and those nobody claimed).
 */
export function registerUploadCleanup(
  ctx: Pick<PluginContext, "hooks">,
  deps: UploadCleanupDeps,
  slugs: { forms: string; submissions: string }
): void {
  ctx.hooks.on("afterDelete", slugs.submissions, (context: unknown) =>
    freeAfterCommit(context, deps, id => ({ submission: { equals: id } }))
  );
  ctx.hooks.on("afterDelete", slugs.forms, (context: unknown) =>
    freeAfterCommit(context, deps, id => ({ form: { equals: id } }))
  );
}
