/**
 * The files a Replace keeps for the uses of an item that name it by its
 * address, and the record of them.
 *
 * Most content refers to an item by its id (an upload field, a block
 * document's list, an attachment), and shows whatever file the item has now.
 * Rich text, a JSON value's `src` or `url`, and an email template's `<img>`
 * refer to it by its address, and go on naming the address it had when they
 * were written. So a Replace that removed the old file would leave those
 * pages pointing at nothing. Instead, while any document uses the item by
 * address, the old files are kept. Which uses do is what the usage record's
 * rows say (`address`), taken from the references the content makes; a use
 * still naming a kept address is one that shows the previous file.
 *
 * The record is one `nextly_meta` row per item, `media.replaced:<id>`, with
 * one more per kept address (`kept-addresses`), so content saved again with
 * the old address still counts as the item's use. The kept files go when the
 * item itself is deleted; until then nothing removes them, and
 * `media orphans`, which looks only at thumbnails, never lists the original
 * a page still shows.
 *
 * @module domains/media/usage/address-uses
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import type { Logger } from "../../../shared/types";
import {
  filesKeptByOthers,
  removeStoredFiles,
  type StoredFileRemover,
} from "../remove-stored-files";
import { StoredFileSearchReader } from "../stored-file-search";

import { keptAddressKey } from "./kept-addresses";

/** The `nextly_meta` key of an item's replaced files. */
function replacedKey(mediaId: string): string {
  return `media.replaced:${mediaId}`;
}

/** What is kept for an item's address uses after its file was replaced. */
const replacedRecordSchema = z.object({
  /** Each file kept, by its stored path, and the address it was served at. */
  files: z.array(z.object({ path: z.string(), url: z.string() })),
});
export type ReplacedRecord = z.infer<typeof replacedRecordSchema>;

/** An item's replaced-file record, or `null` when it has none. */
export async function readReplacedRecord(
  db: Pick<DrizzleAdapter, "select">,
  mediaId: string
): Promise<ReplacedRecord | null> {
  const [row] = await db.select<Record<string, unknown>>("nextly_meta", {
    columns: ["key", "value"],
    where: {
      and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
    },
  });
  if (!row) return null;
  let value: unknown = row.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const read = replacedRecordSchema.safeParse(value);
  return read.success ? read.data : null;
}

/** The addresses of the files a record keeps, each once. */
function keptAddressesOf(files: ReplacedRecord["files"]): string[] {
  return [...new Set(files.map(file => file.url).filter(url => url !== ""))];
}

/**
 * The addresses whose files a Replace kept for an item: those its uses by
 * address may still name, each showing the previous file.
 */
export async function keptAddresses(
  db: Pick<DrizzleAdapter, "select">,
  mediaId: string
): Promise<Set<string>> {
  const record = await readReplacedRecord(db, mediaId);
  return new Set(record ? keptAddressesOf(record.files) : []);
}

/** The statements recording kept files runs, on its own transaction. */
type KeptFilesDb = Pick<DrizzleAdapter, "transaction">;

/**
 * Record that `files` are kept for the item's uses by address, added to what
 * an earlier Replace of the same item kept, and each file's address as one
 * the item is still known by, all on one transaction.
 */
export async function recordKeptFiles(
  db: KeptFilesDb,
  mediaId: string,
  files: ReplacedRecord["files"]
): Promise<void> {
  await db.transaction(async tx => {
    const earlier = await readReplacedRecord(tx, mediaId);
    const record: ReplacedRecord = {
      files: [...(earlier?.files ?? []), ...files],
    };
    await tx.delete("nextly_meta", {
      and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
    });
    await tx.insert("nextly_meta", {
      key: replacedKey(mediaId),
      value: JSON.stringify(record),
      updated_at: new Date(),
    });
    for (const url of keptAddressesOf(files)) {
      await tx.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: keptAddressKey(url) }],
      });
      await tx.insert("nextly_meta", {
        key: keptAddressKey(url),
        value: JSON.stringify({ mediaId, url }),
        updated_at: new Date(),
      });
    }
  });
}

/**
 * Remove the files kept for a deleted item's address uses, except any
 * another item refers to, and the record of them.
 */
export async function removeKeptFiles(
  db: DrizzleAdapter,
  storage: StoredFileRemover,
  logger: Logger,
  mediaId: string
): Promise<void> {
  const record = await readReplacedRecord(db, mediaId);
  if (!record) return;
  const kept = await filesKeptByOthers(
    new StoredFileSearchReader(db, logger).search,
    record.files.map(file => file.path),
    [mediaId]
  );
  if (kept) {
    for (const file of record.files) {
      await removeStoredFiles(
        storage,
        { filename: file.path, url: file.url },
        mediaId,
        kept
      );
    }
  }
  for (const url of keptAddressesOf(record.files)) {
    await db.delete("nextly_meta", {
      and: [{ column: "key", op: "=", value: keptAddressKey(url) }],
    });
  }
  await db.delete("nextly_meta", {
    and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
  });
}
