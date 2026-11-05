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
 * - The count is taken again. When more documents place the component than
 *   the designer confirmed, no hold is made, and the new count is answered so
 *   the editor can ask again.
 * - Otherwise the hold is recorded, and until it ends no write may newly set
 *   one of the held fields on a placement of the component: the confirmed
 *   count is final. A value a document already stores may stay, since it was
 *   counted. A hold ends when the component is next published, or after
 *   {@link HOLD_MS}, so a publish that never lands holds nothing for long.
 *   A designer who cancels when asked again holds nothing: a recount makes
 *   no hold, and ends any held before.
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
      typeof parsed.until !== "number"
    ) {
      return null;
    }
    return {
      properties,
      slots,
      confirmed: parsed.confirmed,
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
 * End a component's hold once a write leaves it published: the removal it
 * was taken for has landed. Not inside a caller's transaction, whose commit
 * is yet to come; the hold then ends when it runs out.
 */
export function registerHoldRelease(args: {
  readonly ctx: RemovalFenceContext;
  /** The RESOLVED slug component definitions are stored under. */
  readonly componentCollection: string;
  readonly holds: () => Pick<RemovalHoldStore, "release">;
}): void {
  args.ctx.hooks.on("afterUpdate", args.componentCollection, async context => {
    const fields = context as { data?: unknown; executor?: unknown };
    const data = fields.data;
    if (fields.executor !== undefined || !isPlainRecord(data)) return;
    if (data._isWorkingDraft === true || data.status !== "published") return;
    const id = data.id;
    if (typeof id !== "string" && typeof id !== "number") return;
    try {
      await args.holds().release(String(id));
    } catch (error) {
      args.ctx.logger.error(
        `[page-builder] the hold on component "${String(id)}" was not ended after its publish; it ends on its own shortly.`,
        { componentId: String(id), error }
      );
    }
  });
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
  const stored = await storedDocuments(args, fields);
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
 * The stored documents a write is compared with: the live row's and the
 * pending draft's. A create stores nothing yet.
 */
async function storedDocuments(
  args: RemovalFenceArgs,
  fields: { collection?: unknown; data?: unknown; originalData?: unknown }
): Promise<Found[]> {
  const original = fields.originalData;
  if (!isPlainRecord(original)) return [];
  const id = original.id;
  const draft = await args.storedDraft({
    collection: String(fields.collection),
    id:
      typeof id === "string" || typeof id === "number" ? String(id) : undefined,
  });
  return [
    ...documentsIn(original, 0, []),
    ...(isPlainRecord(draft) ? documentsIn(draft, 0, []) : []),
  ];
}

/**
 * Where the written documents set a held field more often than the stored
 * ones do: the blocks field's path in the write, or `undefined` when they set
 * none anew. Counted with the strip that will take the values out, so "set"
 * here is exactly what the removal would remove. Compared per field, across
 * the whole document, so a value moved from one placement to another is not
 * new.
 */
function newlySet(
  componentId: string,
  hold: RemovalHold,
  written: readonly Found[],
  stored: readonly Found[],
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
    const before = stored.reduce((sum, found) => sum + setIn(found), 0);
    const after = written.reduce((sum, found) => sum + setIn(found), 0);
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
