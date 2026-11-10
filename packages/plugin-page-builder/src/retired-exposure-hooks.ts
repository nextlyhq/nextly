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
 * after the removal never stores them again: at the top level and inside named
 * groups, wherever a field's value has a fixed path. It covers Singles and writes made
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

import { blocksFieldReach } from "./class-usage-blocks-fields";
import { leavesDocumentPublished } from "./component-readiness-hook";
import { asDocument } from "./component-store-source";
import {
  exposureIdsOf,
  reconcileRetired,
  repairRetired,
  type ComponentHistory,
  type ReconcileArgs,
  type RetiredHistoryMemo,
} from "./retired-history";
import type { RetiredPins } from "./retired-pins";
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
  /**
   * The versions a lost removal is derived from, held against retention
   * until a repair records it (`retired-pins`).
   */
  pins?: RetiredPins;
  /**
   * The wait before each look for a removal written inside a caller's
   * transaction to commit. Short at first, then a second; a test waits for
   * nothing.
   */
  commitWait?: (look: number) => Promise<void>;
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
    if (live?.live === true && componentId !== undefined) {
      await hold(args, context, componentId, retired, live.lifecycle);
    }
    await repair(args, live, componentId, inCallersTransaction(context));
  }
}

/**
 * Pin the versions either side of the removal before the repair, so that if
 * the repair fails too, retention cannot prune the only record of it before
 * a later one is made. The repair releases them when it records the ids.
 *
 * Inside a caller's transaction the removal is not yet visible, and the pin
 * would wait on the component's write lock, which that transaction holds. It
 * is then made once the removal shows in history, which is when the
 * transaction has committed (`holdOnceCommitted`).
 */
async function hold(
  args: RetiredExposureHooksArgs,
  context: HookContext<unknown>,
  componentId: string,
  retired: RetiredExposures,
  lifecycle: boolean
): Promise<void> {
  const pins = args.pins;
  if (pins === undefined) return;
  if (inCallersTransaction(context)) {
    void holdOnceCommitted(args, pins, componentId, retired, lifecycle);
    return;
  }
  try {
    await pins.hold(componentId, retired, lifecycle);
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] the versions behind component "${componentId}"'s lost ` +
        "retirement could not be held against retention; a repair records it " +
        "while history still has them.",
      { componentId, retired, error }
    );
  }
}

/** How many times a removal in a caller's transaction is looked for. */
const COMMIT_LOOKS = 70;

/**
 * The wait before a look: short at first, since the caller usually commits
 * right after the hook returns and a store keeping few versions may prune the
 * one before the removal at its next save, then a second at most, for about
 * a minute in all. Never keeps the process alive.
 */
function soon(look: number): Promise<void> {
  const ms = Math.min(1000, 25 * 2 ** look);
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });
}

/**
 * Hold a removal written inside a caller's transaction once it commits, then
 * repair: the history the pool reads shows the removal only then. Looked for
 * once a second for a minute; a transaction that rolled back never shows it,
 * and nothing is held for a removal that did not happen. Never raises: it
 * runs after the hook has returned.
 */
async function holdOnceCommitted(
  args: RetiredExposureHooksArgs,
  pins: RetiredPins,
  componentId: string,
  retired: RetiredExposures,
  lifecycle: boolean
): Promise<void> {
  const wait = args.commitWait ?? soon;
  // What history showed before the transaction committed: the removal is
  // newer, and an earlier removal of the same id must not end the wait. Read
  // now, while the transaction is open; read later it would already show the
  // removal. Without it, a hold cannot tell this removal from an earlier one,
  // so every look holds what it finds and the wait runs its whole course.
  const visible = await lookOrNull(args, componentId, retired, () =>
    pins.newestVersion(componentId)
  );
  for (let look = 0; look < COMMIT_LOOKS; look += 1) {
    await wait(look);
    const held = await lookOrNull(args, componentId, retired, () =>
      pins.hold(componentId, retired, lifecycle, visible ?? 0)
    );
    if (held === true && visible !== null) {
      await repair(args, { live: true, lifecycle }, componentId);
      return;
    }
  }
  if (visible === null) {
    await repair(args, { live: true, lifecycle }, componentId);
    return;
  }
  args.ctx.logger.warn(
    `[page-builder] component "${componentId}"'s removal, written in a ` +
      "transaction, was not held: it never showed in its history, as when " +
      "the transaction rolled back, or every look failed.",
    { componentId, retired }
  );
}

/**
 * One look of the wait, its failure logged and answered as `null`, so one
 * failed read does not end the wait.
 */
async function lookOrNull<T>(
  args: RetiredExposureHooksArgs,
  componentId: string,
  retired: RetiredExposures,
  look: () => Promise<T>
): Promise<T | null> {
  try {
    return await look();
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a look for component "${componentId}"'s removal in its ` +
        "history failed; it is looked for again.",
      { componentId, retired, error }
    );
    return null;
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
  componentId: string | undefined,
  inTransaction = false
): Promise<void> {
  if (live?.live !== true || componentId === undefined) return;
  const lifecycle = live.lifecycle;
  try {
    await reconcileRetired(
      repairArgs(args, lifecycle, inTransaction),
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

/** What a repair of this store's retired ids reads and writes through. */
function repairArgs(
  args: RetiredExposureHooksArgs,
  lifecycle: boolean,
  /**
   * Whether the repair runs inside a caller's transaction. A release then
   * waits: it takes the component's write lock, which that transaction holds,
   * and a later repair makes it.
   */
  inTransaction = false
): ReconcileArgs {
  return {
    history: args.ctx.services.versions,
    componentCollection: args.componentCollection,
    componentField: args.componentField,
    lifecycle,
    store: args.store,
    logger: args.ctx.logger,
    ...(args.memo === undefined ? {} : { memo: args.memo }),
    ...(args.pins === undefined || inTransaction ? {} : { pins: args.pins }),
  };
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
  if (!Object.values(data).some(value => mayHoldDocument(value, 0))) {
    return undefined;
  }
  const slug = fields.collection;
  if (typeof slug !== "string") return undefined;

  try {
    const written = (await blocksFieldPaths(args.ctx, slug, context)).flatMap(
      path => {
        const raw = valueAt(data, path);
        const document = asDocument(raw);
        return document === null ? [] : [{ path, raw, document }];
      }
    );
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

/**
 * How deep a write's named groups are looked into for a blocks value, as deep
 * as the walk of a declaration follows them.
 */
const MAX_GROUP_DEPTH = 16;

/**
 * Whether a written value is, or inside its named groups holds, something a
 * blocks value could be. Text is decoded only at the top level, where a value
 * may arrive as JSON text; a group's own values arrive decoded.
 */
function mayHoldDocument(value: unknown, depth: number): boolean {
  if (depth === 0 ? asDocument(value) !== null : isDocumentShaped(value)) {
    return true;
  }
  return (
    depth < MAX_GROUP_DEPTH &&
    isPlainRecord(value) &&
    Object.values(value).some(inner => mayHoldDocument(inner, depth + 1))
  );
}

/** Whether a decoded value has a document's shape. */
function isDocumentShaped(value: unknown): boolean {
  return isPlainRecord(value) && Array.isArray(value.nodes);
}

/** The value at a path of a write's data, or `undefined` where none is. */
function valueAt(
  data: Record<string, unknown>,
  path: readonly string[]
): unknown {
  let value: unknown = data;
  for (const key of path) {
    if (!isPlainRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * The data with `value` at `path`, every record on the way copied, so the
 * write's own objects are never changed.
 */
function withValueAt(
  data: Record<string, unknown>,
  path: readonly string[],
  value: unknown
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (key === undefined) return data;
  const inner = data[key];
  return {
    ...data,
    [key]:
      rest.length === 0 || !isPlainRecord(inner)
        ? value
        : withValueAt(inner, rest, value),
  };
}

/** One blocks value a write carries, decoded, with the form it arrived in. */
interface WrittenDocument {
  /** Where it is in the write: one key, or the named groups leading to it. */
  readonly path: readonly string[];
  readonly raw: unknown;
  readonly document: BlockDocument;
}

/** The strip itself, over the blocks fields the write carries. */
async function stripped(
  args: RetiredExposureHooksArgs,
  slug: string,
  fields: Record<string, unknown>,
  data: Record<string, unknown>,
  written: readonly WrittenDocument[]
): Promise<Record<string, unknown> | undefined> {
  const limits = args.limits();
  const own =
    slug === args.componentCollection
      ? (idOf(fields.originalData) ?? idOf(data))
      : undefined;
  const retired = new Map(
    await args.store.of(placedComponentIds(written, own, limits.maxNodes))
  );
  if (own !== undefined) {
    // `fields` is the hook context, read as a record above.
    const context = fields as unknown as HookContext<unknown>;
    const repaired = await ownRetired(args, own, context);
    if (repaired !== undefined) retired.set(own, repaired);
  }
  if (retired.size === 0) return undefined;

  let next: Record<string, unknown> | undefined;
  for (const entry of written) {
    const placements = stripRetiredExposures(entry.document, retired, limits);
    const self =
      own !== undefined &&
      entry.path.length === 1 &&
      entry.path[0] === args.componentField
        ? withoutOwnRetired(placements.document, retired.get(own))
        : { document: placements.document, removed: 0 };
    if (placements.removed + self.removed === 0) continue;
    // In the encoding it arrived in: a value written as JSON text is stored as
    // text, and handing back an object would change what the write stores.
    next = withValueAt(
      next ?? data,
      entry.path,
      typeof entry.raw === "string"
        ? JSON.stringify(self.document)
        : self.document
    );
  }
  return next;
}

/**
 * A written component's own retired ids, repaired from its history first.
 *
 * The table alone is not enough here: a retirement whose record was lost is
 * missing from it, and a restore or publish exposing that id again would put
 * the field back live with the values placements still hold. History says
 * the id was dropped, so the write drops it, and the table learns it.
 *
 * `undefined` where the store records no retirements (a localized one), or
 * where history cannot be read: the table's ids then stand alone, as the
 * strip lets a write through whenever it cannot run.
 */
async function ownRetired(
  args: RetiredExposureHooksArgs,
  componentId: string,
  context: HookContext<unknown>
): Promise<RetiredExposures | undefined> {
  try {
    const collection = (await args.ctx.services.collections.getCollection(
      args.componentCollection,
      requestContextFor(context)
    )) as { localized?: unknown; status?: unknown } | null;
    if (collection?.localized === true) return undefined;
    const repaired = await repairRetired(
      repairArgs(
        args,
        collection?.status === true,
        inCallersTransaction(context)
      ),
      componentId
    );
    return repaired.retired;
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] the retired fields of component "${componentId}" ` +
        "could not be derived from its history before this write; only the " +
        "recorded ones are dropped from it.",
      { componentId, error }
    );
    return undefined;
  }
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
 * Where the written collection or Single stores each blocks field it
 * declares: one key at the top level, or the named groups leading to it. A
 * field with no fixed path (inside a repeater) is not reached; its values are
 * never drawn, and the cleanup reports where it found them.
 *
 * A Single's hooks are namespaced `single:<slug>`, and its declaration comes
 * from the Singles registry, which is the one place a plugin can read it
 * without creating the Single's row.
 */
export async function blocksFieldPaths(
  ctx: RetiredExposurePluginContext,
  slug: string,
  context: HookContext<unknown>
): Promise<readonly (readonly string[])[]> {
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
  return blocksFieldReach(
    declaration as { fields?: unknown; localized?: unknown }
  ).fields.map(field => field.path);
}

/**
 * A definition without its own retired fields and slots.
 *
 * Taken out of `exposed`, `slots` and every variant's values. A variant that
 * loses its only value stays, and shows the component's defaults, as it does
 * when a field is removed in the editor. Hands the same document back when
 * there is nothing to remove, and never changes the one passed in.
 */
export function withoutOwnRetired(
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

/**
 * Whether the hook runs inside a transaction its caller owns: core hands it
 * that transaction's executor only then.
 */
function inCallersTransaction(context: HookContext<unknown>): boolean {
  return (context as { executor?: unknown }).executor !== undefined;
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
