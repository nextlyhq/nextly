/**
 * The audit row each change to a page's own code writes, once the write that
 * changed it has committed: hashes, sizes and counts, as a site code save
 * writes, never the code. Which page and field it was is named. Each change
 * to a document's custom CSS, its own or its blocks', writes one too:
 * hashes and sizes, never the CSS.
 *
 * Written from the write's committed hook rather than its validation, so a
 * write refused or rolled back for any reason leaves no row saying the code
 * changed. A row that can't be written is logged, and the write stands.
 *
 * @module site-code/page-code-audit
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";
import type { HookContext } from "@nextlyhq/plugin-sdk";

import {
  customCssHeldBy,
  type HeldCustomCss,
} from "../fields/custom-css-judgement";
import { sha256Hex } from "../sha256-hex";

import { pageCodeOf, samePageCode, type HeldPageCode } from "./page-code";
import {
  codeAuditMetadata,
  judgeCode,
  SITE_CODE_SAVED_METADATA,
  type PageBuilderSiteCodeOptions,
} from "./route";

/** The audit kind a change to a page's code writes. */
export const PAGE_CODE_SAVED_AUDIT =
  "nextlyhq-plugin-page-builder.page-code-saved";

/** The keys its row holds: site code's, and which page and field. */
export const PAGE_CODE_SAVED_METADATA: readonly string[] = [
  ...SITE_CODE_SAVED_METADATA,
  "collection",
  "entryId",
  "field",
];

/** The audit kind a change to a document's custom CSS writes. */
export const DOCUMENT_CSS_SAVED_AUDIT =
  "nextlyhq-plugin-page-builder.document-css-saved";

/**
 * The keys its row holds: hashes and sizes of the document's own CSS and of
 * its blocks' CSS, before and after, and which document and field.
 */
export const DOCUMENT_CSS_SAVED_METADATA: readonly string[] = [
  "cssSha256",
  "cssSha256Before",
  "cssChars",
  "cssCharsBefore",
  "blockCssSha256",
  "blockCssSha256Before",
  "blockCssChars",
  "blockCssCharsBefore",
  "blocksWithCss",
  "blocksWithCssBefore",
  "collection",
  "entryId",
  "field",
];

/** What the hook is wired with. */
export interface PageCodeAuditArgs {
  readonly ctx: {
    hooks: {
      on(
        type: string,
        collection: string,
        handler: (context: unknown) => unknown
      ): void;
    };
    logger: { error(message: string, meta?: Record<string, unknown>): void };
    audit?: {
      write(event: {
        kind: string;
        actorUserId?: string | null;
        metadata?: Record<string, string | number | boolean>;
      }): Promise<void>;
    };
  };
  /** Whether a document of `collection` may hold blocks at all. */
  readonly mayHoldBlocks: (collection: string) => boolean;
  readonly options: PageBuilderSiteCodeOptions | undefined;
  readonly siteOrigin: () => string;
  /**
   * The limits the site's pages are drawn under, so a change to the CSS of
   * every block a page draws is recorded; the engine's defaults where unset.
   */
  readonly limits?: DocumentLimits;
}

/** One field whose page code, or custom CSS, a write changed. */
interface Change<T> {
  readonly field: string;
  readonly before: T;
  readonly after: T;
}

/** A record, or nothing. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Whether a value is a blocks document, stored as a record or as its JSON. */
function isBlocksDocument(value: unknown): boolean {
  if (typeof value === "string") {
    if (!value.startsWith("{")) return false;
    try {
      return isBlocksDocument(JSON.parse(value));
    } catch {
      return false;
    }
  }
  const record = recordOf(value);
  return (
    record !== undefined &&
    Array.isArray(record.nodes) &&
    "formatVersion" in record
  );
}

/**
 * Each blocks document in `value`, by its path: at the top level, inside
 * named groups and inside repeaters' rows (`hero.body`, `sections[1].body`),
 * as the write's validation addresses them. A document is not looked inside:
 * its blocks are its own.
 */
function documentsByPath(
  value: unknown,
  path: string,
  found: Map<string, unknown>,
  depth = 0
): void {
  if (depth > 32) return;
  if (path !== "" && isBlocksDocument(value)) {
    found.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      documentsByPath(item, `${path}[${index}]`, found, depth + 1)
    );
    return;
  }
  const record = recordOf(value);
  if (record === undefined) return;
  for (const [key, inner] of Object.entries(record)) {
    documentsByPath(
      inner,
      path === "" ? key : `${path}.${key}`,
      found,
      depth + 1
    );
  }
}

/**
 * The blocks documents, by path, whose `read` differs between the two
 * versions of the entry. Only what the write sent is judged: a top-level
 * field it left out is not changed by it.
 */
function changesOf<T>(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  read: (document: unknown) => T,
  same: (a: T, b: T) => boolean
): Change<T>[] {
  const was = new Map<string, unknown>();
  const now = new Map<string, unknown>();
  for (const field of Object.keys(after)) {
    documentsByPath(before?.[field], field, was);
    documentsByPath(after[field], field, now);
  }
  const paths = new Set([...was.keys(), ...now.keys()]);
  return [...paths].flatMap(field => {
    const a = read(was.get(field));
    const b = read(now.get(field));
    return same(a, b) ? [] : [{ field, before: a, after: b }];
  });
}

/** The blocks' CSS, in an order of its own, so moving a block changes none. */
function blockCssOf(held: HeldCustomCss): string[] {
  return held.blocks.map(block => block.text).sort();
}

/** Whether two documents' custom CSS is the same, their own and their blocks'. */
function sameCustomCss(a: HeldCustomCss, b: HeldCustomCss): boolean {
  const left = blockCssOf(a);
  const right = blockCssOf(b);
  return (
    a.document === b.document &&
    left.length === right.length &&
    left.every((text, index) => text === right[index])
  );
}

/** Text of a page's code, empty where it holds none. */
function textsOf(code: HeldPageCode | null): { head: string; body: string } {
  return { head: code?.head ?? "", body: code?.body ?? "" };
}

/** Which entry a committed write was to, and who made it. */
interface Where {
  readonly collection: string;
  readonly id: string;
  readonly actor: string | null;
}

/** The hashes and sizes a document's custom CSS is audited by. */
async function cssFacts(
  held: HeldCustomCss,
  suffix: "" | "Before"
): Promise<Record<string, string | number>> {
  const own = held.document ?? "";
  const blocks = blockCssOf(held);
  return {
    [`cssSha256${suffix}`]: await sha256Hex(own),
    [`cssChars${suffix}`]: own.length,
    // One hash over every block's CSS, each text kept apart from the next.
    [`blockCssSha256${suffix}`]: await sha256Hex(JSON.stringify(blocks)),
    [`blockCssChars${suffix}`]: blocks.reduce(
      (sum, text) => sum + text.length,
      0
    ),
    [`blocksWithCss${suffix}`]: blocks.length,
  };
}

/** Write one change of custom CSS's row. */
async function writeCssRow(
  args: PageCodeAuditArgs,
  change: Change<HeldCustomCss>,
  where: Where
): Promise<void> {
  await args.ctx.audit?.write({
    kind: DOCUMENT_CSS_SAVED_AUDIT,
    actorUserId: where.actor,
    metadata: {
      ...(await cssFacts(change.after, "")),
      ...(await cssFacts(change.before, "Before")),
      collection: where.collection,
      entryId: where.id,
      field: change.field,
    },
  });
}

/** Write one change of page code's row. */
async function writeRow(
  args: PageCodeAuditArgs,
  change: Change<HeldPageCode | null>,
  where: Where
): Promise<void> {
  const after = textsOf(change.after);
  const judged = await judgeCode(
    after,
    args.siteOrigin(),
    args.options,
    "page"
  );
  await args.ctx.audit?.write({
    kind: PAGE_CODE_SAVED_AUDIT,
    actorUserId: where.actor,
    metadata: {
      ...(await codeAuditMetadata(
        after,
        textsOf(change.before),
        judged,
        args.siteOrigin()
      )),
      collection: where.collection,
      entryId: where.id,
      field: change.field,
    },
  });
}

/** The rows one committed write's changes to page code write. */
async function auditWrite(
  args: PageCodeAuditArgs,
  context: unknown
): Promise<void> {
  const hook = context as Partial<HookContext>;
  const collection = hook.collection;
  const data = recordOf(hook.data);
  if (typeof collection !== "string" || data === undefined) return;
  if (!args.mayHoldBlocks(collection)) return;
  const before = recordOf(hook.originalData);
  const rows = [
    ...changesOf(before, data, pageCodeOf, samePageCode).map(change => ({
      change,
      what: "a page's code",
      write: (where: Where) => writeRow(args, change, where),
    })),
    ...changesOf(
      before,
      data,
      document => customCssHeldBy(document, args.limits),
      sameCustomCss
    ).map(change => ({
      change,
      what: "a document's custom CSS",
      write: (where: Where) => writeCssRow(args, change, where),
    })),
  ];
  if (rows.length === 0) return;
  const where = {
    collection,
    id: typeof data.id === "string" ? data.id : "",
    actor: typeof hook.user?.id === "string" ? hook.user.id : null,
  };
  // Each field's row on its own: one that can't be written leaves the
  // others to be written, and the log names the field whose row is missing.
  const record = async (): Promise<void> => {
    for (const row of rows) {
      try {
        await row.write(where);
      } catch (error) {
        args.ctx.logger.error(
          `[page-builder] a change to ${row.what} was saved, but its audit row could not be written`,
          {
            collection,
            entryId: where.id,
            field: row.change.field,
            error: String(error),
          }
        );
      }
    }
  };
  await (hook.afterCommit ? hook.afterCommit(record) : record());
}

/** Register the audit on every committed create and update. */
export function registerPageCodeAudit(args: PageCodeAuditArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => auditWrite(args, context));
  }
}
