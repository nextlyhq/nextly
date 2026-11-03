/**
 * Retiring a component's removed fields, and keeping their values out of every
 * document written afterwards.
 *
 * Two hooks, because the two halves happen at different moments.
 *
 * ## Recorded when the removal goes live
 *
 * A field is retired when the definition that dropped it is PUBLISHED, never on
 * a draft save: live pages keep rendering the published definition, which
 * still shows the field, so stripping its values then would empty a field
 * visitors can see. Core decides between a held draft and a live write inside
 * its transaction, after every `before*` hook has run, so only the `after*`
 * phase can tell which one happened. The record is therefore made after commit,
 * as the ids the previous live definition exposed minus the ids the new one
 * does. A record that fails is logged naming the component, and repaired at
 * once where it can be: the ids are derived again from the component's
 * published versions (`retired-history`), and recorded. The editor asks for
 * the same repair before it mints a field id, so a record lost twice still
 * keeps the id from reuse.
 *
 * Retiring an id only a draft ever held is harmless, since ids are never
 * reused. Missing one is the harmful direction: the id could be minted again
 * and revive the old values. So an editor minting a field id in a draft passes
 * the PUBLISHED definition's ids beside the stored retired ones as
 * `ExposureSources.retired`: an id a draft dropped is not retired until the
 * draft is published, and a new field must not take it before then.
 *
 * ## Stripped on every write
 *
 * Every write that carries a blocks value has the retired values of the
 * components it places taken out before validation sees it, so a page saved
 * after the removal never stores them again. It covers Singles and writes made
 * inside a transaction, which the post-commit hooks decline: this changes only
 * the data being written, and needs no read of the document itself.
 *
 * A write to the component store also drops the component's OWN retired ids
 * from its `exposed` list, its `slots` and its variants, so restoring a version
 * from before the removal cannot bring the field back.
 *
 * A strip that cannot run lets the write through and logs. The resolver ignores
 * a retired id, so a value left behind is never drawn, and the cleanup pass
 * removes it later; refusing every page save while the table is unreadable
 * would cost authors their work for a value nobody sees.
 *
 * @module retired-exposure-hooks
 */
import {
  componentIdsIn,
  isPlainRecord,
  stripRetiredExposures,
  type BlockDocument,
  type DocumentLimits,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import { leavesDocumentPublished } from "./component-readiness-hook";
import { asDocument } from "./component-store-source";
import {
  exposureIdsOf,
  reconcileRetired,
  type ComponentHistory,
  type RetiredHistoryMemo,
} from "./retired-history";
import type { RetiredStore } from "./retired-store";
import { requestContextFor, SINGLE_HOOK_NAMESPACE } from "./write-target";

/** The plugin capabilities the hooks need, named structurally. */
export interface RetiredExposurePluginContext {
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
    singles: {
      list(options: {
        slugAllowlist: string[];
        limit: number;
      }): Promise<{ data: readonly { slug: string; fields?: unknown }[] }>;
    };
    /** Version history, read when a failed record is repaired. */
    versions: ComponentHistory;
  };
  logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

/** What both hooks are wired with. */
export interface RetiredExposureHooksArgs {
  ctx: RetiredExposurePluginContext;
  /** The RESOLVED slug component definitions are stored under. */
  componentCollection: string;
  /** The field on a component row holding its document. */
  componentField: string;
  store: RetiredStore;
  /** The bounds documents are walked under, asked per call. */
  limits: () => DocumentLimits;
  /** What the repair has read of each component's history already. */
  memo?: RetiredHistoryMemo;
}

/**
 * Register the record on publish and the strip on every write.
 *
 * The record listens on `afterUpdate` only: a created component has no earlier
 * definition, so it has nothing to retire. The strip listens on the wildcard,
 * because the collections and Singles holding blocks are not known when a
 * plugin is wired.
 */
export function registerRetiredExposures(args: RetiredExposureHooksArgs): void {
  args.ctx.hooks.on("afterUpdate", args.componentCollection, context =>
    recordRetirements(args, context)
  );
  for (const phase of ["beforeCreate", "beforeUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => stripWrite(args, context));
  }
}

/**
 * Record the ids a published write stopped exposing.
 *
 * Never throws: the write has committed, and an `after*` raise would report a
 * publish that succeeded as one that broke.
 */
async function recordRetirements(
  args: RetiredExposureHooksArgs,
  context: HookContext<unknown>
): Promise<void> {
  const fields = context as unknown as Record<string, unknown>;
  const componentId = idOf(fields.data) ?? idOf(fields.originalData);
  const before = asDocument(fieldOf(fields.originalData, args.componentField));
  const after = asDocument(fieldOf(fields.data, args.componentField));
  // An unreadable value says nothing about which ids went. Reading it as
  // "exposes none" would retire every field the component has.
  if (before === null || after === null) return;
  const retired = droppedExposures(before, after);
  if (retired.properties.length === 0 && retired.slots.length === 0) return;
  // A working draft puts nothing live, so it retires nothing; answered before
  // any read, as the hook may run inside the caller's transaction, where a
  // read on the pool would wait on the connection that transaction holds.
  if (
    (fields.data as { _isWorkingDraft?: unknown } | undefined)
      ?._isWorkingDraft === true
  ) {
    return;
  }
  let live: Live | undefined;
  try {
    live = await goesLive(args, context, componentId, retired);
    if (!live.live) return;
    if (componentId === undefined) {
      throw new Error("the published row carries no id");
    }
    await args.store.retire(componentId, retired);
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] the fields component "${componentId ?? "(unknown)"}" ` +
        "stopped exposing were not recorded as retired. Pages keep their " +
        "values until they are recorded, and the ids could be minted again.",
      { componentId, retired, error }
    );
    await repair(args, live, componentId);
  }
}

/**
 * Derive the component's retired ids from its history and record the ones the
 * table lacks, best effort: the editor asks for the same repair before it
 * mints, so a repair that fails here is made there.
 *
 * Only once the write is known to have put the removal live: a failure before
 * that says nothing about the store, which may be localized and record no
 * retirements at all.
 */
async function repair(
  args: RetiredExposureHooksArgs,
  live: Live | undefined,
  componentId: string | undefined
): Promise<void> {
  if (live?.live !== true || componentId === undefined) return;
  const lifecycle = live.lifecycle;
  try {
    await reconcileRetired(
      {
        history: args.ctx.services.versions,
        componentCollection: args.componentCollection,
        componentField: args.componentField,
        lifecycle,
        store: args.store,
        logger: args.ctx.logger,
        ...(args.memo === undefined ? {} : { memo: args.memo }),
      },
      componentId
    );
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] the retired fields of component "${componentId}" ` +
        "could not be derived from its history; they are derived again when " +
        "the component is next edited.",
      { componentId, error }
    );
  }
}

/** Whether a write puts its removal live, and how the store decides that. */
interface Live {
  readonly live: boolean;
  /** Whether the store has the Draft/Published lifecycle. */
  readonly lifecycle: boolean;
}

/**
 * Whether this write puts the removal live, so its ids are retired now.
 *
 * A store with no Draft/Published lifecycle puts every write live. A
 * LOCALIZED store is declined, and said so. Publishing there is per
 * language, so a write leaves one language live while another may still expose
 * the field, and retiring it would strip values that language still shows;
 * telling which languages have dropped it is not done yet. The warning names
 * the component, so its removed ids can be kept from reuse by hand.
 */
async function goesLive(
  args: RetiredExposureHooksArgs,
  context: HookContext<unknown>,
  componentId: string | undefined,
  retired: RetiredExposures
): Promise<Live> {
  const collection = await args.ctx.services.collections.getCollection(
    args.componentCollection,
    requestContextFor(context)
  );
  const store = collection as { localized?: unknown; status?: unknown } | null;
  if (store?.localized === true) {
    args.ctx.logger.warn(
      `[page-builder] component "${componentId ?? "(unknown)"}" stopped ` +
        "exposing fields in a localized component store, where removed fields " +
        "are not retired: their values stay on pages, and their ids must not " +
        "be reused.",
      { componentId, retired }
    );
    return { live: false, lifecycle: store?.status === true };
  }
  // A store without the Draft/Published lifecycle keeps no draft: every write
  // is the definition pages render from.
  if (store?.status !== true) return { live: true, lifecycle: false };
  return {
    live: leavesDocumentPublished(context, collection),
    lifecycle: true,
  };
}

/** The ids `before` exposes that `after` does not, fields and slots apart. */
function droppedExposures(
  before: BlockDocument,
  after: BlockDocument
): RetiredExposures {
  const kept = exposureIdsOf(after);
  const was = exposureIdsOf(before);
  return {
    properties: was.properties.filter(id => !kept.properties.includes(id)),
    slots: was.slots.filter(id => !kept.slots.includes(id)),
  };
}

/**
 * The data with every retired value taken out, or `undefined` when nothing in
 * it is retired, which leaves the write as it came.
 */
async function stripWrite(
  args: RetiredExposureHooksArgs,
  context: HookContext<unknown>
): Promise<Record<string, unknown> | undefined> {
  const fields = context as unknown as Record<string, unknown>;
  const data = fields.data;
  if (!isPlainRecord(data)) return undefined;
  // Asked of the values before the configuration, so a write carrying no
  // document, which is most of them, costs no registry read.
  const candidates = Object.keys(data).filter(
    key => asDocument(data[key]) !== null
  );
  if (candidates.length === 0) return undefined;
  const slug = fields.collection;
  if (typeof slug !== "string") return undefined;

  try {
    const blocks = await blocksFieldNames(args.ctx, slug, context);
    const written = candidates.filter(name => blocks.has(name));
    if (written.length === 0) return undefined;
    return await stripped(args, slug, fields, data, written);
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${slug}" kept any values of removed ` +
        "component fields it holds; they are not drawn, and are removed later.",
      { collection: slug, error }
    );
    return undefined;
  }
}

/** One blocks value a write carries, decoded, with the form it arrived in. */
interface WrittenDocument {
  readonly name: string;
  readonly raw: unknown;
  readonly document: BlockDocument;
}

/** The strip itself, over the blocks fields the write carries. */
async function stripped(
  args: RetiredExposureHooksArgs,
  slug: string,
  fields: Record<string, unknown>,
  data: Record<string, unknown>,
  names: readonly string[]
): Promise<Record<string, unknown> | undefined> {
  const limits = args.limits();
  const written = names.flatMap(name => {
    const document = asDocument(data[name]);
    return document === null ? [] : [{ name, raw: data[name], document }];
  });
  const own =
    slug === args.componentCollection
      ? (idOf(fields.originalData) ?? idOf(data))
      : undefined;
  const retired = await args.store.of(
    placedComponentIds(written, own, limits.maxNodes)
  );
  if (retired.size === 0) return undefined;

  let next: Record<string, unknown> | undefined;
  for (const entry of written) {
    const placements = stripRetiredExposures(entry.document, retired, limits);
    const self =
      own !== undefined && entry.name === args.componentField
        ? withoutOwnRetired(placements.document, retired.get(own))
        : { document: placements.document, removed: 0 };
    if (placements.removed + self.removed === 0) continue;
    next ??= { ...data };
    // In the encoding it arrived in: a value written as JSON text is stored as
    // text, and handing back an object would change what the write stores.
    next[entry.name] =
      typeof entry.raw === "string"
        ? JSON.stringify(self.document)
        : self.document;
  }
  return next;
}

/**
 * The components whose retired ids this write needs: every one its documents
 * place, under the host's node cap, and the written component itself.
 */
function placedComponentIds(
  written: readonly WrittenDocument[],
  own: string | undefined,
  maxNodes: number
): string[] {
  const ids = new Set<string>(own === undefined ? [] : [own]);
  for (const entry of written) {
    for (const id of componentIdsIn(entry.document.nodes, maxNodes)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * The names of the blocks fields the written collection or Single declares.
 *
 * A Single's hooks are namespaced `single:<slug>`, and its declaration comes
 * from the Singles registry, which is the one place a plugin can read it
 * without creating the Single's row.
 */
async function blocksFieldNames(
  ctx: RetiredExposurePluginContext,
  slug: string,
  context: HookContext<unknown>
): Promise<ReadonlySet<string>> {
  const declaration = slug.startsWith(SINGLE_HOOK_NAMESPACE)
    ? (
        await ctx.services.singles.list({
          slugAllowlist: [slug.slice(SINGLE_HOOK_NAMESPACE.length)],
          limit: 1,
        })
      ).data[0]
    : await ctx.services.collections.getCollection(
        slug,
        requestContextFor(context)
      );
  return new Set(
    blocksFieldsOf(declaration as { fields?: unknown }).map(field => field.name)
  );
}

/**
 * A definition without its own retired fields and slots.
 *
 * Taken out of `exposed`, `slots` and every variant's values. A variant that
 * loses its only value stays, and shows the component's defaults, as it does
 * when a field is removed in the editor. Hands the same document back when
 * there is nothing to remove, and never changes the one passed in.
 */
function withoutOwnRetired(
  document: BlockDocument,
  retired: RetiredExposures | undefined
): { document: BlockDocument; removed: number } {
  if (retired === undefined) return { document, removed: 0 };
  const found = ownRetiredIn(document, retired, false);
  if (found === 0) return { document, removed: 0 };
  const copy = structuredClone(document);
  return { document: copy, removed: ownRetiredIn(copy, retired, true) };
}

/** Count, and when `apply` is set also remove, a definition's own retired ids. */
function ownRetiredIn(
  document: BlockDocument,
  retired: RetiredExposures,
  apply: boolean
): number {
  const envelope = document as unknown as Record<string, unknown>;
  return (
    retiredFieldsIn(envelope, retired.properties, apply) +
    retiredSlotsIn(envelope, retired.slots, apply) +
    retiredVariantValuesIn(envelope, retired.properties, apply)
  );
}

/** The retired entries of `exposed`. */
function retiredFieldsIn(
  envelope: Record<string, unknown>,
  properties: readonly string[],
  apply: boolean
): number {
  if (!Array.isArray(envelope.exposed)) return 0;
  const kept = envelope.exposed.filter(
    entry => !(isPlainRecord(entry) && properties.includes(entry.id as string))
  );
  const removed = envelope.exposed.length - kept.length;
  if (apply) envelope.exposed = kept;
  return removed;
}

/** The retired exposed slots; a record left empty is dropped, as absent. */
function retiredSlotsIn(
  envelope: Record<string, unknown>,
  slots: readonly string[],
  apply: boolean
): number {
  const record = envelope.slots;
  if (!isPlainRecord(record)) return 0;
  const removed = removeOwnKeys(record, slots, apply);
  if (apply && Object.keys(record).length === 0) delete envelope.slots;
  return removed;
}

/** Each variant's values under a retired field id. */
function retiredVariantValuesIn(
  envelope: Record<string, unknown>,
  properties: readonly string[],
  apply: boolean
): number {
  const variants = envelope.variants;
  if (!isPlainRecord(variants)) return 0;
  let removed = 0;
  for (const variant of Object.values(variants)) {
    const overrides = isPlainRecord(variant) ? variant.overrides : undefined;
    if (isPlainRecord(overrides)) {
      removed += removeOwnKeys(overrides, properties, apply);
    }
  }
  return removed;
}

/** Remove the named own keys of a record; returns how many it held. */
function removeOwnKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  apply: boolean
): number {
  let removed = 0;
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    removed += 1;
    if (apply) delete record[key];
  }
  return removed;
}

/** A field of a row that may be absent. */
function fieldOf(row: unknown, name: string): unknown {
  return isPlainRecord(row) ? row[name] : undefined;
}

/** A row's id, when it carries a usable one. */
function idOf(row: unknown): string | undefined {
  const id = fieldOf(row, "id");
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
