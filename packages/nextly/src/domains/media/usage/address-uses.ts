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

/** The `nextly_meta` key prefix of every item's replaced files. */
const REPLACED_KEY_PREFIX = "media.replaced:";

/** The `nextly_meta` key of an item's replaced files. */
function replacedKey(mediaId: string): string {
  return `${REPLACED_KEY_PREFIX}${mediaId}`;
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
  return row ? replacedRecordOf(row.value) : null;
}

/** A replaced-file record's stored value, or `null` when it is not one. */
function replacedRecordOf(stored: unknown): ReplacedRecord | null {
  let value: unknown = stored;
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

/** The statements a kept-file record is written with: a transaction's. */
type KeptFilesTx = Pick<DrizzleAdapter, "select" | "delete" | "insert">;

/** Write an item's replaced-file record as `record`, or remove it when empty. */
async function writeReplacedRecord(
  tx: KeptFilesTx,
  mediaId: string,
  record: ReplacedRecord
): Promise<void> {
  await tx.delete("nextly_meta", {
    and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
  });
  if (record.files.length === 0) return;
  await tx.insert("nextly_meta", {
    key: replacedKey(mediaId),
    value: JSON.stringify(record),
    updated_at: new Date(),
  });
}

/**
 * Record that `files` are kept for the item's uses by address, added to what
 * an earlier Replace of the same item kept, and each file's address as one
 * the item is still known by, on `tx`: the Replace's own transaction, so the
 * item never points at its new file without its old files recorded as its.
 */
export async function recordKeptFiles(
  tx: KeptFilesTx,
  mediaId: string,
  files: ReplacedRecord["files"]
): Promise<void> {
  if (files.length === 0) return;
  const earlier = await readReplacedRecord(tx, mediaId);
  await writeReplacedRecord(tx, mediaId, {
    files: [...(earlier?.files ?? []), ...files],
  });
  await writeKeptAddresses(tx, mediaId, keptAddressesOf(files));
}

/**
 * Take `files` back out of the item's record, once a Replace has found
 * nothing names them, with each address no file left in the record keeps,
 * all on one transaction. Before their files are removed, so a failure here
 * leaves the files and the record agreeing that they are kept.
 */
export async function forgetKeptFiles(
  db: Pick<DrizzleAdapter, "transaction">,
  mediaId: string,
  files: ReplacedRecord["files"]
): Promise<void> {
  if (files.length === 0) return;
  const same = (a: ReplacedRecord["files"][number]) =>
    files.some(file => file.path === a.path && file.url === a.url);
  await db.transaction(async tx => {
    const earlier = await readReplacedRecord(tx, mediaId);
    const left = (earlier?.files ?? []).filter(file => !same(file));
    await writeReplacedRecord(tx, mediaId, { files: left });
    const stillKept = new Set(keptAddressesOf(left));
    for (const url of keptAddressesOf(files)) {
      if (stillKept.has(url)) continue;
      await tx.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: keptAddressKey(url) }],
      });
    }
  });
}

/** The statements writing kept addresses runs: a transaction's. */
type KeptAddressWriter = Pick<DrizzleAdapter, "delete" | "insert">;

/** Record each of `urls` as an address the item is still known by. */
async function writeKeptAddresses(
  tx: KeptAddressWriter,
  mediaId: string,
  urls: readonly string[]
): Promise<void> {
  for (const url of urls) {
    await tx.delete("nextly_meta", {
      and: [{ column: "key", op: "=", value: keptAddressKey(url) }],
    });
    await tx.insert("nextly_meta", {
      key: keptAddressKey(url),
      value: JSON.stringify({ mediaId, url }),
      updated_at: new Date(),
    });
  }
}

/**
 * Record every address every Replace has kept a file for as one its item is
 * still known by, from the items' replaced-file records: for the rebuild,
 * before it reads any document, so content still naming an address kept by
 * a Replace made before addresses were recorded counts as the item's use.
 * Each item's on a transaction of its own; writing one again is harmless.
 */
export async function indexKeptAddresses(
  db: Pick<DrizzleAdapter, "select" | "transaction">
): Promise<number> {
  const rows = await db.select<Record<string, unknown>>("nextly_meta", {
    columns: ["key", "value"],
    where: {
      and: [{ column: "key", op: "LIKE", value: `${REPLACED_KEY_PREFIX}%` }],
    },
  });
  let indexed = 0;
  for (const row of rows) {
    const key = typeof row.key === "string" ? row.key : "";
    const record = replacedRecordOf(row.value);
    if (!key.startsWith(REPLACED_KEY_PREFIX) || record === null) continue;
    const mediaId = key.slice(REPLACED_KEY_PREFIX.length);
    const urls = keptAddressesOf(record.files);
    await db.transaction(tx => writeKeptAddresses(tx, mediaId, urls));
    indexed += urls.length;
  }
  return indexed;
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
