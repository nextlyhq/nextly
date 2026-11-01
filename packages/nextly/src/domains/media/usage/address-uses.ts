/**
 * The uses of an item that name it by its address, and the files a Replace
 * keeps for them.
 *
 * Most content refers to an item by its id (an upload field, a block
 * document's list, an attachment), and shows whatever file the item has now.
 * Rich text and an email template's `<img>` refer to it by its address, and
 * go on naming the address it had when they were written. So a Replace that
 * removed the old file would leave those pages pointing at nothing. Instead,
 * while any document uses the item by address, the old files are kept, and
 * the uses that still name the old address are recorded: by the usage rows
 * that stood when the file was replaced. A document saved again has its rows
 * written anew, so a row still on that list is one whose content has not
 * changed since, and still shows the previous file.
 *
 * The record is one `nextly_meta` row per item, `media.replaced:<id>`. The
 * kept files go when the item itself is deleted; until then nothing removes
 * them, and `media orphans`, which looks only at thumbnails, never lists the
 * original a page still shows.
 *
 * @module domains/media/usage/address-uses
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import type { FieldConfig } from "../../../collections/fields/types";
import type { Logger } from "../../../shared/types";
import { resolveComponentSchemas } from "../../versions/restore-version";
import {
  filesKeptByOthers,
  removeStoredFiles,
  type StoredFileRemover,
} from "../remove-stored-files";
import { StoredFileSearchReader } from "../stored-file-search";

import { TEMPLATE_ADDRESS_FIELD } from "./email-template-usage";
import { addressFieldPaths } from "./media-references";
import type { MediaUsageRow, UsageSubjectKind } from "./media-usage-store";

/**
 * The fields of a collection or a Single that name items by address, by
 * path; for an email template, its HTML.
 */
export type AddressPaths = (
  kind: UsageSubjectKind,
  slug: string
) => Promise<ReadonlySet<string>>;

/**
 * The rows among `rows` whose field names the item by its address, each
 * collection's and Single's fields read once.
 */
export async function addressUseRows<T extends MediaUsageRow>(
  rows: readonly T[],
  addressPaths: AddressPaths
): Promise<T[]> {
  const paths = new Map<string, Promise<ReadonlySet<string>>>();
  const pathsOf = (kind: UsageSubjectKind, slug: string) => {
    const key = `${kind} ${slug}`;
    let found = paths.get(key);
    if (!found) {
      found = addressPaths(kind, slug);
      paths.set(key, found);
    }
    return found;
  };
  const kept: T[] = [];
  for (const row of rows) {
    const named = await pathsOf(row.subjectKind, row.subjectSlug);
    if (named.has(row.fieldPath)) kept.push(row);
  }
  return kept;
}

/** The registries a document's fields are read from. */
export interface FieldRegistries {
  collectionFields(slug: string): Promise<readonly FieldConfig[] | undefined>;
  singleFields(slug: string): Promise<readonly FieldConfig[] | undefined>;
}

/** The address fields of each kind of document, read from the registries. */
export function addressPathsFrom(registries: FieldRegistries): AddressPaths {
  return async (kind, slug) => {
    if (kind === "email-template") return new Set([TEMPLATE_ADDRESS_FIELD]);
    const fields =
      kind === "single"
        ? await registries.singleFields(slug)
        : await registries.collectionFields(slug);
    if (!fields) return new Set();
    const schemas = await resolveComponentSchemas([...fields]);
    return addressFieldPaths(fields, schemas);
  };
}

/** The `nextly_meta` key of an item's replaced files. */
function replacedKey(mediaId: string): string {
  return `media.replaced:${mediaId}`;
}

/** What is kept for an item's address uses after its file was replaced. */
const replacedRecordSchema = z.object({
  /** Each file kept, by its stored path, and the address it was served at. */
  files: z.array(z.object({ path: z.string(), url: z.string() })),
  /** The usage rows that named the old address when it was replaced. */
  rows: z.array(z.string()),
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

/**
 * Record that `files` are kept for the address uses `rowIds`, added to what
 * an earlier Replace of the same item kept.
 */
export async function recordKeptFiles(
  db: Pick<DrizzleAdapter, "select" | "insert" | "delete">,
  mediaId: string,
  files: ReplacedRecord["files"],
  rowIds: readonly string[]
): Promise<void> {
  const earlier = await readReplacedRecord(db, mediaId);
  const record: ReplacedRecord = {
    files: [...(earlier?.files ?? []), ...files],
    rows: [...new Set([...(earlier?.rows ?? []), ...rowIds])],
  };
  await db.delete("nextly_meta", {
    and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
  });
  await db.insert("nextly_meta", {
    key: replacedKey(mediaId),
    value: JSON.stringify(record),
    updated_at: new Date(),
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
  await db.delete("nextly_meta", {
    and: [{ column: "key", op: "=", value: replacedKey(mediaId) }],
  });
}
