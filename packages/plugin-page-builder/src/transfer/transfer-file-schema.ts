/**
 * A transfer file as an import accepts it: parsed at the boundary, so past
 * this point every list, id and media file has the shape the planner reads.
 *
 * The documents are parsed as documents and no deeper. What a document may
 * hold is the blocks field's own question, asked by the same validation every
 * write runs, which an import's writes go through; a second, narrower schema
 * here would be a second answer to it.
 *
 * Each media file is held to its own claims: its bytes decode to the size it
 * states and hash to the digest it states, so a damaged or edited file is
 * refused before anything is compared with it, let alone stored.
 *
 * @module transfer/transfer-file-schema
 */
import { isDefaultLook } from "@nextlyhq/blocks-engine";
import { z } from "nextly/zod";

import {
  MAX_TRANSFER_MEDIA_BYTES,
  TRANSFER_FORMAT,
  TRANSFER_FORMAT_VERSION,
  TRANSFER_KINDS,
  type TransferFile,
} from "./transfer-contract";
import { sha256Of } from "./transfer-media";

/** The longest id, name or slug a file may carry. */
const MAX_TEXT = 512;

/** The most items of any one kind a file may carry. */
const MAX_ITEMS = 2000;

const text = z.string().max(MAX_TEXT);
const id = text.min(1);

const documentOf = <K extends string>(kind: K) =>
  z.looseObject({
    formatVersion: z.literal(1),
    kind: z.literal(kind),
    nodes: z.array(z.unknown()),
  });

const itemBase = {
  id,
  title: text,
  slug: id,
  // As long as the collections store it: a textarea declares no maximum.
  description: z.string().optional(),
  status: z.enum(["published", "draft"]),
};

const breakpoint = z.strictObject({
  id,
  label: text,
  axis: z.enum(["viewport", "container"]),
  maxWidth: z.number().positive().finite(),
});

const media = z.strictObject({
  id,
  filename: id,
  mimeType: id,
  size: z.number().int().nonnegative().max(MAX_TRANSFER_MEDIA_BYTES),
  width: z.number().optional(),
  height: z.number().optional(),
  altText: z.string().optional(),
  caption: z.string().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  data: z.base64(),
});

/** The schema an import parses a file with. */
const TransferFileSchema = z
  .strictObject({
    format: z.literal(TRANSFER_FORMAT),
    formatVersion: z.literal(TRANSFER_FORMAT_VERSION),
    exportedAt: z.string().max(64),
    root: z.strictObject({ kind: z.enum(TRANSFER_KINDS), id }),
    components: z
      .array(
        z.strictObject({
          ...itemBase,
          category: text.optional(),
          area: text.optional(),
          content: documentOf("component"),
        })
      )
      .max(MAX_ITEMS),
    patterns: z
      .array(
        z.strictObject({
          ...itemBase,
          category: text.optional(),
          keywords: z.string().optional(),
          granularity: id,
          content: documentOf("pattern"),
        })
      )
      .max(MAX_ITEMS),
    layouts: z
      .array(
        z.strictObject({
          ...itemBase,
          areas: z.array(z.strictObject({ area: id, component: id })).max(32),
        })
      )
      .max(MAX_ITEMS),
    classes: z
      .array(
        z.looseObject({
          id,
          slug: id,
          orderIndex: z.number(),
          styles: z.record(z.string(), z.unknown()),
        })
      )
      .max(MAX_ITEMS),
    tokens: z
      .array(
        z.looseObject({
          id: id.optional(),
          name: id,
          kind: id,
          values: z.looseObject({
            light: z.string(),
            dark: z.string().optional(),
          }),
        })
      )
      .max(MAX_ITEMS),
    breakpoints: z.array(breakpoint).max(14),
    media: z.array(media).max(MAX_ITEMS),
    blockTypes: z.array(text).max(MAX_ITEMS),
  })
  .superRefine((file, issues) => {
    const kinds = {
      component: file.components,
      pattern: file.patterns,
      layout: file.layouts,
    };
    if (!kinds[file.root.kind].some(item => item.id === file.root.id)) {
      issues.addIssue({
        code: "custom",
        path: ["root"],
        message: "The file does not carry the item it was made from.",
      });
    }
    // Every list is keyed by the source's ids, which the import maps one to
    // one; a repeated id would be written twice and mapped once.
    const keyed: [string, readonly string[]][] = [
      ["components", file.components.map(item => item.id)],
      ["patterns", file.patterns.map(item => item.id)],
      ["layouts", file.layouts.map(item => item.id)],
      ["classes", file.classes.map(entry => entry.id)],
      ["tokens", file.tokens.map(token => token.id ?? token.name)],
      ["breakpoints", file.breakpoints.map(entry => entry.id)],
      ["media", file.media.map(entry => entry.id)],
    ];
    for (const [list, ids] of keyed) {
      const repeated = ids.find((id, at) => ids.indexOf(id) !== at);
      if (repeated !== undefined) {
        issues.addIssue({
          code: "custom",
          path: [list],
          message: `The file lists "${repeated}" twice among its ${list}.`,
        });
      }
    }
    let total = 0;
    file.media.forEach((entry, at) => {
      const bytes = Buffer.from(entry.data, "base64");
      total += bytes.byteLength;
      if (bytes.byteLength !== entry.size || sha256Of(bytes) !== entry.sha256) {
        issues.addIssue({
          code: "custom",
          path: ["media", at],
          message: `The media file "${entry.filename}" is damaged: its bytes do not match the size and digest the file states.`,
        });
      }
    });
    if (total > MAX_TRANSFER_MEDIA_BYTES) {
      issues.addIssue({
        code: "custom",
        path: ["media"],
        message: "The file's media are larger than an import accepts.",
      });
    }
  });

/** Where a file was refused, and why, in the validation envelope's terms. */
export interface FileIssue {
  readonly path: string;
  readonly code: "INVALID";
  readonly message: string;
}

/**
 * A file parsed as the docblock describes, or the issues that refuse it.
 * The parse keeps every document's other keys as they were, which is all the
 * planner and the writes assume of them.
 */
export function readTransferFile(
  raw: unknown
): { readonly file: TransferFile } | { readonly issues: readonly FileIssue[] } {
  const parsed = TransferFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(issue => ({
        path: ["file", ...issue.path.map(String)].join("."),
        code: "INVALID" as const,
        message: issue.message,
      })),
    };
  }
  // The parse checked the shapes the contract names; the documents' insides
  // are the blocks field's to judge, as the writes do.
  const file = parsed.data as unknown as TransferFile;
  // A block's own look edits the base of every block of its type on a site,
  // so it stays with the site it was made on: a file carrying one, however it
  // came to, never changes the importing site's own looks. Its documents draw
  // with that site's own looks, as they do with its bases.
  return {
    file: {
      ...file,
      classes: file.classes.filter(entry => !isDefaultLook(entry)),
    },
  };
}
