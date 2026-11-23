/**
 * A collection that holds files: its `files` option, the fields every one of
 * its entries carries for the file, and the rules the option is judged by.
 *
 * Each entry of such a collection is one file. The file's bytes live in
 * storage; the entry holds what the app and the checked routes need to know
 * about them. The fields are the system's, added by `defineCollection`, and
 * no caller writes them: field rules refuse every write to them through any
 * checked path, so only core's own upload and download code sets them, and the
 * storage key is withheld from every checked read as well.
 *
 * Who may upload or open a file is the collection's own `access` rules, as for
 * any collection.
 *
 * @module collections/config/collection-files
 * @experimental
 */
import { BLOCKED_MIME_TYPES } from "../../services/upload-validation/mime";
import type { FieldConfig } from "../fields/types";

/**
 * The `files` option of a collection whose entries are files.
 *
 * @experimental
 */
export interface CollectionFilesConfig {
  /**
   * Who can reach a file without Nextly. Only `"private"` today: no public
   * address ever serves the file, and every download goes through Nextly's
   * checked route, which applies the collection's read rule.
   */
  visibility: "private";

  /**
   * The file types accepted, by MIME type, each exactly
   * (`"application/pdf"`, `"image/png"`). A file is checked against this
   * list by what its bytes are, not only by what it claims to be.
   */
  accept: readonly string[];

  /** The largest file accepted, in bytes. */
  maxSize: number;

  /**
   * How a download is answered: `"stream"`, the bytes sent through Nextly, or
   * `"redirect"`, a link to the file in storage that lasts at most a minute.
   *
   * @default "stream"
   */
  delivery?: "stream" | "redirect";

  /**
   * How long, in seconds, an upload may wait to be confirmed before it is
   * removed, its stored bytes with it.
   *
   * @default 3600
   */
  pendingTimeout?: number;
}

/** The states a file's entry passes through. */
const FILE_STATUSES = ["pending", "ready", "rejected"] as const;

/** The longest and shortest wait for a confirm that a collection may set. */
const PENDING_TIMEOUT_BOUNDS = { min: 60, max: 7 * 24 * 60 * 60 } as const;

/** A MIME type, exactly: one type and subtype, lowercase, no parameters. */
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** The options the `files` option reads; any other key is a mistake. */
const FILES_KEYS: ReadonlySet<string> = new Set([
  "visibility",
  "accept",
  "maxSize",
  "delivery",
  "pendingTimeout",
]);

/** No caller writes a file's own fields; only core's routes do, as trusted code. */
const SYSTEM_WRITES = { create: false, update: false } as const;

/**
 * The fields a collection holding files carries for each file, in the order
 * they come before the author's own. Every one is the system's: no caller
 * writes it through a checked path, and `storageKey` is never read through
 * one either.
 *
 * - `filename`: the name the file was uploaded under, for display and for
 *   the download's name. Never part of the storage key.
 * - `mimeType`, `size`, `sha256`: what the stored bytes are, as checked when
 *   the upload was confirmed.
 * - `storageKey`: where the bytes are in storage.
 * - `fileStatus`: `pending` until the upload is confirmed, then `ready`, or
 *   `rejected` with a `rejectReason`.
 * - `uploadedByKind`, `uploadedById`: who started the upload (`user`, or a
 *   signed-in principal's kind), so only they can confirm it.
 *
 * @experimental
 */
export function fileSystemFields(): Array<FieldConfig & { name: string }> {
  const shown = { readOnly: true } as const;
  return [
    {
      type: "text",
      name: "filename",
      label: "File name",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "mimeType",
      label: "Type",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "number",
      name: "size",
      label: "Size (bytes)",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "sha256",
      label: "SHA-256",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "storageKey",
      label: "Storage key",
      localized: false,
      // Withheld from every checked read, as well as written by no caller:
      // knowing where a file is in storage is a step toward reaching it
      // without Nextly.
      access: { read: false, ...SYSTEM_WRITES },
      admin: { readOnly: true, hidden: true },
    },
    {
      type: "select",
      name: "fileStatus",
      label: "File status",
      localized: false,
      options: FILE_STATUSES.map(value => ({ label: value, value })),
      defaultValue: "pending",
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "rejectReason",
      label: "Why it was rejected",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "uploadedByKind",
      label: "Uploaded by (kind)",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
    {
      type: "text",
      name: "uploadedById",
      label: "Uploaded by",
      localized: false,
      access: SYSTEM_WRITES,
      admin: shown,
    },
  ];
}

/** A problem with a collection's `files` option, at `path` within it. */
export interface FilesProblem {
  path: string;
  message: string;
}

/** The collection settings the `files` option is judged beside. */
interface FilesCollection {
  files?: unknown;
  fields?: unknown;
  status?: unknown;
  versions?: unknown;
  localized?: unknown;
  timestamps?: unknown;
  publicAddress?: unknown;
  access?: unknown;
}

/** Each key of the `files` option that is not one of its options. */
function unknownKeyProblems(files: Record<string, unknown>): FilesProblem[] {
  return Object.keys(files)
    .filter(key => !FILES_KEYS.has(key))
    .map(key => ({
      path: `files.${key}`,
      message: `'${key}' is not a files option. The options are ${[...FILES_KEYS].join(", ")}.`,
    }));
}

/** Whether `value` is a whole number from `min` to `max`. */
function wholeNumberWithin(value: unknown, min: number, max: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}

/** Each problem with the size, delivery and wait the option sets. */
function limitProblems(files: Record<string, unknown>): FilesProblem[] {
  const problems: FilesProblem[] = [];
  if (!wholeNumberWithin(files.maxSize, 1, Number.MAX_SAFE_INTEGER)) {
    problems.push({
      path: "files.maxSize",
      message: "files.maxSize must be a whole number of bytes above 0.",
    });
  }
  const { delivery } = files;
  if (![undefined, "stream", "redirect"].includes(delivery as string)) {
    problems.push({
      path: "files.delivery",
      message: `files.delivery must be "stream" or "redirect".`,
    });
  }
  const { min, max } = PENDING_TIMEOUT_BOUNDS;
  if (
    files.pendingTimeout !== undefined &&
    !wholeNumberWithin(files.pendingTimeout, min, max)
  ) {
    problems.push({
      path: "files.pendingTimeout",
      message: `files.pendingTimeout must be a whole number of seconds from ${min} to ${max}.`,
    });
  }
  return problems;
}

/** Each problem with the `files` option's own shape. */
function shapeProblems(files: Record<string, unknown>): FilesProblem[] {
  return [
    ...unknownKeyProblems(files),
    ...(files.visibility === "private"
      ? []
      : [
          {
            path: "files.visibility",
            message: `files.visibility must be "private".`,
          },
        ]),
    ...acceptProblems(files.accept),
    ...limitProblems(files),
  ];
}

/**
 * Each problem with the accepted types: at least one, each a MIME type
 * written exactly, none a type a browser would run as a page or a script
 * (`BLOCKED_MIME_TYPES`, which every upload refuses) or an SVG, which can
 * carry script and is only made safe by the media library's sanitiser.
 */
function acceptProblems(accept: unknown): FilesProblem[] {
  if (!Array.isArray(accept) || accept.length === 0) {
    return [
      {
        path: "files.accept",
        message:
          'files.accept must list at least one MIME type, such as "application/pdf".',
      },
    ];
  }
  const problems: FilesProblem[] = [];
  accept.forEach((type: unknown, index) => {
    const path = `files.accept[${index}]`;
    if (typeof type !== "string" || !MIME_TYPE.test(type)) {
      problems.push({
        path,
        message: `${JSON.stringify(type)} is not a MIME type written exactly, such as "application/pdf" (lowercase, no wildcard, no parameters).`,
      });
      return;
    }
    if (BLOCKED_MIME_TYPES.has(type) || type === "image/svg+xml") {
      problems.push({
        path,
        message: `'${type}' can run as a page or a script in a browser, so no collection accepts it.`,
      });
    }
  });
  return problems;
}

/**
 * Each setting that a collection holding files cannot have beside `files`:
 * each says the entries are something a file's entry is not.
 */
function conflictProblems(collection: FilesCollection): FilesProblem[] {
  const problems: FilesProblem[] = [];
  const refuse = (path: string, why: string) =>
    problems.push({ path, message: `A collection with files ${why}` });
  if (collection.status === true) {
    refuse("status", "has no drafts: a file is pending until it is confirmed.");
  }
  if (collection.versions !== undefined && collection.versions !== false) {
    refuse("versions", "keeps no versions: each file is its own entry.");
  }
  if (collection.localized === true) {
    refuse(
      "localized",
      "is not localized: a file is one file in every language."
    );
  }
  if (collection.timestamps === false) {
    refuse(
      "timestamps",
      "keeps its timestamps: an unconfirmed upload is removed by when it started."
    );
  }
  if (collection.publicAddress !== undefined) {
    refuse("publicAddress", "has no public address: its files are private.");
  }
  const read = (collection.access as { read?: unknown } | undefined)?.read;
  if (read === true) {
    refuse(
      "access.read",
      "is never readable by everyone: its read rule decides who may open a file."
    );
  }
  return problems;
}

/**
 * The fields of `fileSystemFields` that `fields` lacks, by name. A collection
 * declared through `defineCollection` always has them; one written as a plain
 * object does not, and its files would have nowhere to be recorded.
 */
function missingSystemFields(fields: unknown): string[] {
  const present = new Set(
    (Array.isArray(fields) ? fields : []).map(
      field => (field as { name?: unknown } | null)?.name
    )
  );
  return fileSystemFields()
    .map(field => field.name)
    .filter(name => !present.has(name));
}

/**
 * Every problem with `collection`'s `files` option: its own shape, the
 * settings it cannot be beside, and the system fields it needs. None when the
 * collection has no `files` option.
 *
 * @experimental
 */
export function filesProblems(collection: FilesCollection): FilesProblem[] {
  const { files } = collection;
  if (files === undefined) return [];
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return [
      {
        path: "files",
        message: `files must be an object such as { visibility: "private", accept: ["application/pdf"], maxSize: 10485760 }.`,
      },
    ];
  }
  const missing = missingSystemFields(collection.fields);
  return [
    ...shapeProblems(files as Record<string, unknown>),
    ...conflictProblems(collection),
    ...(missing.length > 0
      ? [
          {
            path: "fields",
            message: `A collection with files carries the fields ${missing.join(", ")}, which defineCollection adds. Declare it with defineCollection.`,
          },
        ]
      : []),
  ];
}
