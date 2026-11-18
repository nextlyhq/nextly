/**
 * The audit row each change to a page's own code writes, once the write that
 * changed it has committed: hashes, sizes and counts, as a site code save
 * writes, never the code. Which page and field it was is named.
 *
 * Written from the write's committed hook rather than its validation, so a
 * write refused or rolled back for any reason leaves no row saying the code
 * changed. A row that can't be written is logged, and the write stands.
 *
 * @module site-code/page-code-audit
 */
import type { HookContext } from "@nextlyhq/plugin-sdk";

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
}

/** One field whose page code a write changed. */
interface CodeChange {
  readonly field: string;
  readonly before: HeldPageCode | null;
  readonly after: HeldPageCode | null;
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
 * The page code each blocks document in `value` holds, by its path: at the
 * top level, inside named groups and inside repeaters' rows (`hero.body`,
 * `sections[1].body`), as the write's validation addresses them. A document
 * is not looked inside: its blocks are its own.
 */
function codeByPath(
  value: unknown,
  path: string,
  found: Map<string, HeldPageCode | null>,
  depth = 0
): void {
  if (depth > 32) return;
  if (path !== "" && isBlocksDocument(value)) {
    found.set(path, pageCodeOf(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      codeByPath(item, `${path}[${index}]`, found, depth + 1)
    );
    return;
  }
  const record = recordOf(value);
  if (record === undefined) return;
  for (const [key, inner] of Object.entries(record)) {
    codeByPath(inner, path === "" ? key : `${path}.${key}`, found, depth + 1);
  }
}

/**
 * The blocks documents, by path, whose page code differs between the two
 * versions of the entry. Only what the write sent is judged: a top-level
 * field it left out is not changed by it.
 */
function pageCodeChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>
): CodeChange[] {
  const was = new Map<string, HeldPageCode | null>();
  const now = new Map<string, HeldPageCode | null>();
  for (const field of Object.keys(after)) {
    codeByPath(before?.[field], field, was);
    codeByPath(after[field], field, now);
  }
  const paths = new Set([...was.keys(), ...now.keys()]);
  return [...paths].flatMap(field => {
    const a = was.get(field) ?? null;
    const b = now.get(field) ?? null;
    return samePageCode(a, b) ? [] : [{ field, before: a, after: b }];
  });
}

/** Text of a page's code, empty where it holds none. */
function textsOf(code: HeldPageCode | null): { head: string; body: string } {
  return { head: code?.head ?? "", body: code?.body ?? "" };
}

/** Write one change's row. */
async function writeRow(
  args: PageCodeAuditArgs,
  change: CodeChange,
  where: { collection: string; id: string; actor: string | null }
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
  const changes = pageCodeChanges(recordOf(hook.originalData), data);
  if (changes.length === 0) return;
  const where = {
    collection,
    id: typeof data.id === "string" ? data.id : "",
    actor: typeof hook.user?.id === "string" ? hook.user.id : null,
  };
  // Each field's row on its own: one that can't be written leaves the
  // others to be written, and the log names the field whose row is missing.
  const record = async (): Promise<void> => {
    for (const change of changes) {
      try {
        await writeRow(args, change, where);
      } catch (error) {
        args.ctx.logger.error(
          "[page-builder] a change to a page's code was saved, but its audit row could not be written",
          {
            collection,
            entryId: where.id,
            field: change.field,
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
