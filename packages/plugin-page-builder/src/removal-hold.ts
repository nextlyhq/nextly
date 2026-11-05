/**
 * Holding a component's removal still while it is published.
 *
 * Removing a field a component exposes takes its values from every placement
 * that set it once the removal is published, and the designer is told before
 * that how many documents place the component. Two things could make that
 * number wrong by the time the publish lands: documents placing it since, and
 * an author setting the field somewhere it was not set. So at publish the
 * editor asks for a HOLD:
 *
 * - The hold is recorded, and the count is taken again. When more documents
 *   place the component than the designer confirmed, or the count is now
 *   only a floor where it was whole, the hold is ended at once and the new
 *   count answered, so the editor can ask again.
 * - While a hold is in force no write may newly set one of the held fields
 *   on a placement of the component: the confirmed count is final. A value a
 *   document already stores may stay, since it was counted.
 * - As the publish is written the count is taken once more, on every path
 *   that publishes, and a grown count refuses it: a write already past its
 *   check when the hold was recorded is caught there.
 * - A hold ends once a publish no longer exposes the held fields, or after
 *   {@link HOLD_MS}, so a publish that never lands holds nothing for long.
 *
 * Holds are kept in the plugin's bookkeeping table beside the retired ids,
 * under a kind of their own, read and written as the system.
 *
 * @module removal-hold
 */
import {
  componentIdsIn,
  isPlainRecord,
  stripRetiredExposures,
  type BlockDocument,
  type DocumentLimits,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { retiredKey } from "./collections/component-retired-exposures";
import { asDocument } from "./component-store-source";
import { exposureIdsOf } from "./retired-history";

/** The bookkeeping kind a hold is filed under. */
export const REMOVAL_HOLD = "removal-hold";

/** How long a hold lasts when the publish it was taken for never lands. */
export const HOLD_MS: number = 2 * 60 * 1000;

/** The issue code a write refused by a hold carries. */
export const FIELD_BEING_REMOVED = "COMPONENT_FIELD_BEING_REMOVED";

/** One component's hold. */
export interface RemovalHold extends RetiredExposures {
  /** How many documents placing the component the designer confirmed. */
  readonly confirmed: number;
  /** Whether that count was the whole answer, rather than "at least". */
  readonly confirmedComplete: boolean;
  /** When the hold ends, in ms since the epoch. */
  readonly until: number;
}

/** The Direct API the store reads and writes through, as the system. */
export type HoldDirectApi = Pick<
  ClassUsageDirectApi,
  "find" | "create" | "delete"
>;

/** The holds, recorded, read and ended. */
export interface RemovalHoldStore {
  /** Record a component's hold, in place of any it had. */
  hold(componentId: string, hold: RemovalHold): Promise<void>;
  /** The holds in force on these components; one ended is absent. */
  of(
    componentIds: readonly string[]
  ): Promise<ReadonlyMap<string, RemovalHold>>;
  /** End a component's hold. Nothing to end is no failure. */
  release(componentId: string): Promise<void>;
}

/** How many component ids one read names, as the retired-ids read bounds it. */
const IDS_PER_READ = 128;

/** A stored hold, read strictly: anything else holds nothing. */
function holdOf(text: unknown): RemovalHold | null {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text) as Partial<RemovalHold> | null;
    const ids = (value: unknown): string[] | null =>
      Array.isArray(value) &&
      value.every((id): id is string => typeof id === "string")
        ? value
        : null;
    const properties = ids(parsed?.properties);
    const slots = ids(parsed?.slots);
    if (
      properties === null ||
      slots === null ||
      typeof parsed?.confirmed !== "number" ||
      typeof parsed.confirmedComplete !== "boolean" ||
      typeof parsed.until !== "number"
    ) {
      return null;
    }
    return {
      properties,
      slots,
      confirmed: parsed.confirmed,
      confirmedComplete: parsed.confirmedComplete,
      until: parsed.until,
    };
  } catch {
    return null;
  }
}

/** The store over the bookkeeping table, by its RESOLVED slug. */
export function removalHoldStore(args: {
  nextly: () => Promise<HoldDirectApi>;
  collection: string;
  /** The live clock, injected so a test can move it. */
  clock?: () => number;
}): RemovalHoldStore {
  const now = args.clock ?? (() => Date.now());
  const rowsOf = async (nextly: HoldDirectApi, componentIds: string[]) => {
    const rows: {
      id: string;
      componentId: string;
      hold: RemovalHold | null;
    }[] = [];
    for (let at = 0; at < componentIds.length; at += IDS_PER_READ) {
      const found = await nextly.find({
        collection: args.collection,
        where: {
          componentId: { in: componentIds.slice(at, at + IDS_PER_READ) },
          kind: { equals: REMOVAL_HOLD },
        },
        limit: IDS_PER_READ,
        depth: 0,
        overrideAccess: true,
      });
      for (const item of found.items) {
        if (!isPlainRecord(item)) continue;
        const { id, componentId, exposureId } = item;
        if (typeof componentId !== "string") continue;
        if (typeof id !== "string" && typeof id !== "number") continue;
        rows.push({ id: String(id), componentId, hold: holdOf(exposureId) });
      }
    }
    return rows;
  };
  const release = async (componentId: string) => {
    const nextly = await args.nextly();
    for (const row of await rowsOf(nextly, [componentId])) {
      await nextly.delete({
        collection: args.collection,
        id: row.id,
        overrideAccess: true,
      });
    }
  };
  return {
    of: async componentIds => {
      const ids = [...new Set(componentIds)];
      if (ids.length === 0) return new Map();
      const at = now();
      const held = new Map<string, RemovalHold>();
      for (const row of await rowsOf(await args.nextly(), ids)) {
        if (row.hold !== null && row.hold.until > at) {
          held.set(row.componentId, row.hold);
        }
      }
      return held;
    },
    release,
    hold: async (componentId, hold) => {
      // Ended first, so the one row the unique key allows is this hold.
      await release(componentId);
      const nextly = await args.nextly();
      await nextly.create({
        collection: args.collection,
        data: {
          identity: await retiredKey(componentId, REMOVAL_HOLD, ""),
          componentId,
          kind: REMOVAL_HOLD,
          exposureId: JSON.stringify(hold),
        },
        overrideAccess: true,
      });
    },
  };
}

/** The store where nothing is retired, so nothing need be held. */
export const NO_HOLDS: RemovalHoldStore = {
  hold: () => Promise.resolve(),
  of: () => Promise.resolve(new Map()),
  release: () => Promise.resolve(),
};

/** The plugin capabilities the fence needs, named structurally. */
export interface RemovalFenceContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { error(message: string, meta?: Record<string, unknown>): void };
}

/** What the fence is wired with. */
export interface RemovalFenceArgs {
  readonly ctx: RemovalFenceContext;
  readonly holds: () => Pick<RemovalHoldStore, "of">;
  /**
   * The written document's stored values that the write may change: its
   * pending working draft, read as the system. The live row is the hook's
   * own `originalData`.
   */
  readonly storedDraft: (at: {
    readonly collection: string;
    readonly id: string | undefined;
  }) => Promise<unknown>;
  readonly limits: () => DocumentLimits;
  /** A component's title, for the refusal; its id where none is read. */
  readonly titleOf?: (componentId: string) => Promise<string | undefined>;
}

/**
 * Register the fence on every create and update: a write newly setting a
 * held field on a placement of its component is refused.
 */
export function registerRemovalFence(args: RemovalFenceArgs): void {
  for (const phase of ["beforeCreate", "beforeUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => fenceWrite(args, context));
  }
}

/**
 * End a component's hold once a write publishes a definition that no longer
 * exposes any held field or slot: the removal it was taken for has landed.
 * Any other publish of the component (its title, say, or a draft that kept
 * the fields) leaves the hold in force. Not inside a caller's transaction,
 * whose commit is yet to come; the hold then ends when it runs out.
 */
export function registerHoldRelease(args: {
  readonly ctx: RemovalFenceContext;
  /** The RESOLVED slug component definitions are stored under. */
  readonly componentCollection: string;
  /** The field on a component row holding its definition. */
  readonly componentField: string;
  readonly holds: () => Pick<RemovalHoldStore, "of" | "release">;
}): void {
  args.ctx.hooks.on("afterUpdate", args.componentCollection, async context => {
    const fields = context as { data?: unknown; executor?: unknown };
    const data = fields.data;
    if (fields.executor !== undefined || !isPlainRecord(data)) return;
    if (data._isWorkingDraft === true || data.status !== "published") return;
    const id = data.id;
    if (typeof id !== "string" && typeof id !== "number") return;
    const definition = asDocument(data[args.componentField]);
    if (definition === null) return;
    try {
      const hold = (await args.holds().of([String(id)])).get(String(id));
      if (hold === undefined || stillExposes(definition, hold)) return;
      await args.holds().release(String(id));
    } catch (error) {
      args.ctx.logger.error(
        `[page-builder] the hold on component "${String(id)}" was not ended after its publish; it ends on its own shortly.`,
        { componentId: String(id), error }
      );
    }
  });
}

/** The issue code a publish refused for a grown count carries. */
export const REMOVAL_RECOUNT = "COMPONENT_REMOVAL_RECOUNT";

/** A count of the documents placing a component, as the dialog says it. */
export interface PlacementCount {
  readonly documents: number;
  readonly complete: boolean;
}

/** Whether a count says more than the one confirmed, or less certainly. */
export function countGrew(
  now: PlacementCount,
  confirmed: Pick<RemovalHold, "confirmed" | "confirmedComplete">
): boolean {
  return (
    now.documents > confirmed.confirmed ||
    (confirmed.confirmedComplete && !now.complete)
  );
}

/**
 * Count again when a held removal is published, on every path that publishes
 * it, and refuse the publish when the count has grown since it was confirmed.
 *
 * The hold itself is asked for only by the editor, which showed the designer
 * a count; this is the check at the write, so a document placed between the
 * hold and the publish (one whose write was already under way when the hold
 * was made, say) still stops it. A publish of a component with no hold goes
 * ahead: nobody was shown a count to confirm, and its removed values are
 * cleaned up after it all the same. Not inside a caller's transaction, whose
 * count read would go to the pool outside it.
 */
export function registerPublishRecount(args: {
  readonly ctx: RemovalFenceContext;
  readonly componentCollection: string;
  readonly componentField: string;
  readonly holds: () => Pick<RemovalHoldStore, "of">;
  readonly count: (componentId: string) => Promise<PlacementCount>;
}): void {
  args.ctx.hooks.on("beforeUpdate", args.componentCollection, async context => {
    const fields = context as {
      data?: unknown;
      originalData?: unknown;
      executor?: unknown;
    };
    const data = fields.data;
    if (fields.executor !== undefined || !isPlainRecord(data)) return;
    if (data.status !== "published") return;
    const id = isPlainRecord(fields.originalData)
      ? fields.originalData.id
      : undefined;
    if (typeof id !== "string" && typeof id !== "number") return;
    const hold = (await args.holds().of([String(id)])).get(String(id));
    if (hold === undefined) return;
    // A publish naming a definition that still exposes every held field does
    // not remove them; one naming none publishes the held draft, which may.
    const definition = asDocument(data[args.componentField]);
    if (definition !== null && !removesAny(definition, hold)) return;
    const now = await args.count(String(id));
    if (!countGrew(now, hold)) return;
    throw NextlyError.validation({
      errors: [
        {
          path: args.componentField,
          code: REMOVAL_RECOUNT,
          message: `More documents place this component than when its removed fields were confirmed: ${now.complete ? "" : "at least "}${String(now.documents)} now. Publish again to review the new count.`,
        },
      ],
    });
  });
}

/** Whether a definition drops any field or slot the hold is for. */
function removesAny(definition: BlockDocument, hold: RemovalHold): boolean {
  const exposed = exposureIdsOf(definition);
  return (
    hold.properties.some(id => !exposed.properties.includes(id)) ||
    hold.slots.some(id => !exposed.slots.includes(id))
  );
}

/**
 * Wire every part of a hold over one store: the fence on every write, the
 * count again as a held removal is published, and the release once one lands.
 * Answers the store, for the route that records holds.
 */
export function installRemovalHolds(args: {
  readonly ctx: RemovalFenceContext;
  readonly store: RemovalHoldStore;
  readonly componentCollection: string;
  readonly componentField: string;
  readonly storedDraft: RemovalFenceArgs["storedDraft"];
  readonly limits: () => DocumentLimits;
  readonly count: (componentId: string) => Promise<PlacementCount>;
}): RemovalHoldStore {
  const holds = () => args.store;
  registerRemovalFence({
    ctx: args.ctx,
    holds,
    storedDraft: args.storedDraft,
    limits: args.limits,
  });
  registerHoldRelease({
    ctx: args.ctx,
    componentCollection: args.componentCollection,
    componentField: args.componentField,
    holds,
  });
  registerPublishRecount({
    ctx: args.ctx,
    componentCollection: args.componentCollection,
    componentField: args.componentField,
    holds,
    count: args.count,
  });
  return args.store;
}

/** Whether a definition still exposes any field or slot the hold is for. */
function stillExposes(definition: BlockDocument, hold: RemovalHold): boolean {
  const exposed = exposureIdsOf(definition);
  return (
    hold.properties.some(id => exposed.properties.includes(id)) ||
    hold.slots.some(id => exposed.slots.includes(id))
  );
}

/** The fence itself: throws the refusal, or lets the write through. */
async function fenceWrite(
  args: RemovalFenceArgs,
  context: unknown
): Promise<void> {
  const fields = context as {
    collection?: unknown;
    data?: unknown;
    originalData?: unknown;
    executor?: unknown;
  };
  if (!isPlainRecord(fields.data) || typeof fields.collection !== "string") {
    return;
  }
  // Asked of the values first, so a write carrying no document, which is most
  // of them, reads nothing.
  const written = documentsIn(fields.data, 0, []);
  if (written.length === 0) return;
  const limits = args.limits();
  const placed = new Set<string>();
  for (const { document } of written) {
    for (const id of componentIdsIn(document.nodes, limits.maxNodes)) {
      placed.add(id);
    }
  }
  if (placed.size === 0) return;
  let holds: ReadonlyMap<string, RemovalHold>;
  try {
    holds = await args.holds().of([...placed]);
  } catch (error) {
    // A hold that cannot be read lets the write through: the hold keeps a
    // count final, and refusing every save while the table is unreadable
    // would cost authors their work for a number.
    args.ctx.logger.error(
      `[page-builder] a write to "${fields.collection}" was not checked against components whose fields are being removed.`,
      { collection: fields.collection, error }
    );
    return;
  }
  if (holds.size === 0) return;
  const stored = await storedForms(args, fields);
  for (const [componentId, hold] of holds) {
    const where = newlySet(componentId, hold, written, stored, limits);
    if (where === undefined) continue;
    const title = (await args.titleOf?.(componentId)) ?? componentId;
    throw NextlyError.validation({
      errors: [
        {
          path: where.path,
          code: FIELD_BEING_REMOVED,
          message: refusal(title),
        },
      ],
    });
  }
}

/** The refusal's words. */
function refusal(title: string): string {
  return `A field of the component “${title}” is being removed right now, so it can’t be given a value here. Save again in a moment; it won’t be part of the component after that.`;
}

/**
 * The stored forms a write is compared with, each as the documents it holds:
 * the live row, and the pending working draft where there is one. A create
 * stores nothing yet.
 *
 * Inside a caller's transaction nothing is read: the draft would be read on
 * the pool, outside that transaction (or, on a one-connection pool, waiting
 * on it). Such a write is compared with nothing stored, so any held value it
 * carries is refused; it can be saved again once the hold ends.
 */
async function storedForms(
  args: RemovalFenceArgs,
  fields: {
    collection?: unknown;
    originalData?: unknown;
    executor?: unknown;
  }
): Promise<Found[][]> {
  const original = fields.originalData;
  if (fields.executor !== undefined || !isPlainRecord(original)) return [];
  const id = original.id;
  const draft = await args.storedDraft({
    collection: String(fields.collection),
    id:
      typeof id === "string" || typeof id === "number" ? String(id) : undefined,
  });
  return [
    documentsIn(original, 0, []),
    ...(isPlainRecord(draft) ? [documentsIn(draft, 0, [])] : []),
  ];
}

/**
 * Where the written documents set a held field more often than a stored form
 * does: the blocks field's path in the write, or `undefined` when they set
 * none anew. Counted with the strip that will take the values out, so "set"
 * here is exactly what the removal would remove. Compared per field, across
 * the whole document, so a value moved from one placement to another is not
 * new. Which stored form a write replaces is decided only once it runs, so it
 * is compared with the one setting the field least: a value the draft lacks
 * is new to it, whatever the live row holds.
 */
function newlySet(
  componentId: string,
  hold: RemovalHold,
  written: readonly Found[],
  stored: readonly (readonly Found[])[],
  limits: DocumentLimits
): { readonly path: string } | undefined {
  const fields: RetiredExposures[] = [
    ...hold.properties.map(id => ({ properties: [id], slots: [] })),
    ...hold.slots.map(id => ({ properties: [], slots: [id] })),
  ];
  for (const one of fields) {
    const only = new Map([[componentId, one]]);
    const setIn = (found: Found) =>
      stripRetiredExposures(found.document, only, limits).removed;
    const count = (form: readonly Found[]) =>
      form.reduce((sum, found) => sum + setIn(found), 0);
    const before =
      stored.length === 0 ? 0 : Math.min(...stored.map(form => count(form)));
    const after = count(written);
    if (after > before) {
      const first = written.find(found => setIn(found) > 0);
      return { path: first?.path.join(".") ?? "" };
    }
  }
  return undefined;
}

/** A blocks document a row holds, and the keys leading to it. */
interface Found {
  readonly path: readonly string[];
  readonly document: BlockDocument;
}

/** How deep a row's groups are looked into, as the strip looks. */
const MAX_GROUP_DEPTH = 16;

/** Every blocks document a row holds, its groups' included, with its path. */
function documentsIn(
  value: Record<string, unknown>,
  depth: number,
  path: readonly string[]
): Found[] {
  const found: Found[] = [];
  for (const [key, inner] of Object.entries(value)) {
    const document = asDocument(inner);
    if (document !== null) {
      found.push({ path: [...path, key], document });
    } else if (depth < MAX_GROUP_DEPTH && isPlainRecord(inner)) {
      found.push(...documentsIn(inner, depth + 1, [...path, key]));
    }
  }
  return found;
}
