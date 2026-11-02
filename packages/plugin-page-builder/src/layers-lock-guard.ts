/**
 * Refusing a write that empties a blocks field holding a block locked in
 * Layers.
 *
 * The field's own validation judges every value a write sends against the
 * stored document (`fields/layers-lock-judgement`). What it never sees is the
 * EMPTY value: core hands a field type's validator no `null`, because that is
 * what `required` is for, so a write setting a page's blocks field to `null`
 * would drop every locked block on it with nothing asked. That is data loss
 * through the one path the lock did not cover, and this closes it.
 *
 * ## Why a `beforeUpdate` hook on every collection
 *
 * `beforeUpdate` is the phase that can still say no: core awaits it before
 * validating or storing, and a throw refuses the write. On the wildcard
 * because a blocks field can sit on any collection a host declares or the
 * Schema Builder creates, and the collection's LIVE configuration is read when
 * the hook runs, as the class-usage index reads it.
 *
 * ## No second report
 *
 * Only a field the write empties is judged here. A field the write sends a
 * document for is the field validator's, which compares it with the stored one
 * already; judging it here as well would report one lock twice.
 *
 * ## What it judges against, and where it cannot judge
 *
 * The newest stored form: the working draft where there is one, else the row
 * the hook is handed. Read through the Direct API when it can be, and from the
 * handed row when it cannot (inside a caller's transaction, where a pooled
 * read would wait on the connection that transaction holds). A field kept per
 * language is not judged: the hook is not told which language the write is
 * in, so the server log says the write went unchecked rather than judging it
 * against another language's value. A Single is not judged either, because a
 * plugin has no read of a Single that does not create it.
 *
 * @module layers-lock-guard
 */
import { layersLockChanges } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginFieldIssue } from "@nextlyhq/plugin-sdk";
import type { HookContext } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import type { BlocksFieldDescriptor } from "./class-usage-subjects";
import type { LayersLockUnjudged } from "./fields/blocks-composition";
import { layersLockIssuesFor } from "./fields/layers-lock-judgement";
import { requestContextFor, SINGLE_HOOK_NAMESPACE } from "./write-target";

/** The plugin context this needs, named structurally. */
export interface LayersLockGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: HookContext<unknown>) => unknown
    ): void;
  };
  services: {
    collections: {
      getCollection(name: string, context: unknown): Promise<unknown>;
    };
  };
}

/**
 * Refuse, on every collection, an update that empties a blocks field holding
 * a block locked in Layers.
 */
export function registerLayersLockGuard(args: {
  ctx: LayersLockGuardContext;
  /** Told of a field the hook could not judge, for the server log. */
  onUnjudged: (found: LayersLockUnjudged) => void;
}): void {
  args.ctx.hooks.on("beforeUpdate", "*", context =>
    refuseEmptyingALockedField(args, context)
  );
}

/** Whether a write's value leaves a field empty: `null`, or an empty string. */
function isEmptied(value: unknown): boolean {
  return value === null || value === "";
}

/** A record, or `null` for anything else. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The Direct API a hook's request carries, or `null`. */
function directApiOf(
  context: HookContext<unknown>
): ClassUsageDirectApi | null {
  const nextly = recordOf(context.req)?.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as ClassUsageDirectApi)
    : null;
}

/**
 * The newest stored form of the document: its working draft where it has one,
 * else the row the hook was handed.
 *
 * The by-id draft read falls back to the live row when there is no draft, so
 * either answer is the newest form. Not read inside a caller's transaction:
 * the pooled read would wait on the connection that transaction holds, and the
 * handed row is the stored document as that transaction sees it.
 */
async function newestStored(
  context: HookContext<unknown>,
  original: Record<string, unknown>,
  id: string
): Promise<Record<string, unknown>> {
  const nextly = directApiOf(context);
  const inTransaction =
    (context as unknown as { executor?: unknown }).executor !== undefined;
  if (nextly === null || inTransaction) return original;
  const read = await nextly.findByID({
    collection: context.collection,
    id,
    draft: true,
    status: "all",
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
  });
  return recordOf(read) ?? original;
}

/** The update a hook judges: what it writes, the row it replaces, where. */
interface JudgedUpdate {
  readonly data: Record<string, unknown>;
  readonly original: Record<string, unknown>;
  readonly slug: string;
  readonly id: string;
}

/**
 * The update this hook can judge, or `null` when it declines: no data or no
 * stored row in hand, a Single, or a row without a usable id.
 */
function updateOf(context: HookContext<unknown>): JudgedUpdate | null {
  const data = recordOf(context.data);
  const original = recordOf(context.originalData);
  const slug = context.collection;
  if (data === null || original === null) return null;
  if (typeof slug !== "string" || slug.startsWith(SINGLE_HOOK_NAMESPACE)) {
    return null;
  }
  const id = original.id;
  if (typeof id !== "string" || id === "") return null;
  return { data, original, slug, id };
}

/**
 * The top-level blocks fields this update empties, read from the collection's
 * live configuration only once the write is known to empty something: almost
 * every update empties no field, and then the hook costs nothing.
 */
async function emptiedBlocksFields(
  args: Parameters<typeof registerLayersLockGuard>[0],
  context: HookContext<unknown>,
  update: JudgedUpdate
): Promise<BlocksFieldDescriptor[]> {
  const emptied = Object.keys(update.data).filter(key =>
    isEmptied(update.data[key])
  );
  if (emptied.length === 0) return [];
  const collection = await args.ctx.services.collections.getCollection(
    update.slug,
    requestContextFor(context)
  );
  return blocksFieldsOf(
    collection as Parameters<typeof blocksFieldsOf>[0]
  ).filter(field => emptied.includes(field.name));
}

/**
 * The fields that can be judged. A translated one is reported unjudged
 * instead, since the hook is not told the write's language.
 */
function judgeableFields(
  args: Parameters<typeof registerLayersLockGuard>[0],
  fields: readonly BlocksFieldDescriptor[],
  update: JudgedUpdate
): BlocksFieldDescriptor[] {
  for (const field of fields) {
    if (!field.localized) continue;
    args.onUnjudged({
      field: field.name,
      kind: "collection",
      slug: update.slug,
      id: update.id,
      reason: "language-unknown",
    });
  }
  return fields.filter(field => !field.localized);
}

/** Refuse the write with every lock it breaks, or return when it breaks none. */
function refuseIfAny(issues: readonly PluginFieldIssue[]): void {
  if (issues.length === 0) return;
  throw NextlyError.validation({
    errors: issues.map(issue => ({
      path: issue.path ?? "",
      code: issue.code ?? "",
      message: issue.message,
    })),
  });
}

/** One update, refused when it empties a field holding a locked block. */
async function refuseEmptyingALockedField(
  args: Parameters<typeof registerLayersLockGuard>[0],
  context: HookContext<unknown>
): Promise<void> {
  const update = updateOf(context);
  if (update === null) return;
  const fields = await emptiedBlocksFields(args, context, update);
  const judged = judgeableFields(args, fields, update);
  if (judged.length === 0) return;

  const stored = await newestStored(context, update.original, update.id);
  refuseIfAny(
    judged.flatMap(field =>
      layersLockIssuesFor(
        layersLockChanges(update.data[field.name], stored[field.name]),
        field.name,
        field.name
      )
    )
  );
}
