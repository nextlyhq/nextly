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
 * - What the designer confirms is the documents placing the component, each
 *   of which loses the removed fields' values, whenever they were set. A
 *   value set before the hold, by a write already committed or already past
 *   its check, is set in a document that count includes; the hold keeps
 *   that count final and refuses a value set after it, which the author is
 *   told of, rather than lost unseen.
 * - A hold ends once a publish no longer exposes the held fields, or after
 *   {@link HOLD_MS}, so a publish that never lands holds nothing for long.
 *
 * Holds are kept in the plugin's bookkeeping table beside the retired ids,
 * under a kind of their own, its ids cut into rows of a bounded size, read
 * and written as the system. Each removal asked for keeps its own hold, so two asked for
 * at once neither end nor replace each other's.
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
  /**
   * Which request recorded it: the key it is renewed and ended by, so a
   * request ends or renews only its own.
   */
  readonly token: string;
}

/** The Direct API the store reads and writes through, as the system. */
export type HoldDirectApi = Pick<
  ClassUsageDirectApi,
  "find" | "create" | "delete"
>;

/** The holds, recorded, read and ended. */
export interface RemovalHoldStore {
  /**
   * Record a component's hold beside any others in force on it: two removals
   * asked for at once each keep their own, so neither can end or replace the
   * other's.
   */
  hold(componentId: string, hold: RemovalHold): Promise<void>;
  /** The holds in force on these components; one ended or run out is absent. */
  of(
    componentIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly RemovalHold[]>>;
  /**
   * Run the hold `token` recorded until `until`, if it is still in force:
   * `false` when it has ended or run out, which nothing then revives. Where
   * nothing is ever held, every hold is in force.
   */
  renew(componentId: string, token: string, until: number): Promise<boolean>;
  /**
   * End a component's holds, or only the one `token` recorded. Nothing to end
   * is no failure.
   */
  release(componentId: string, token?: string): Promise<void>;
}

/** How many component ids one read names, as the retired-ids read bounds it. */
const IDS_PER_READ = 128;

/** How many rows one page of a read asks for. */
const ROWS_PER_PAGE = 500;

/**
 * How much of a hold's ids one row carries, in UTF-16 units of their JSON.
 * Each unit is at most three bytes once stored, so a row stays far under
 * MySQL's 64 KiB TEXT however long an id is or however many a removal names.
 */
const IDS_PER_ROW = 8_000;

/**
 * One stored row of a hold. A hold's ids, as one JSON text, are cut into
 * parts of {@link IDS_PER_ROW}, one row each, so a hold takes rows in
 * proportion to its size rather than one per id; and a head row with the
 * rest, written LAST and ended FIRST, so a hold is read only whole. A head
 * carries its lease in its key, so renewing it writes a new head before
 * ending the old one, and the hold is never unheld between the two.
 */
type HoldRow =
  | {
      readonly part: "head";
      readonly token: string;
      readonly until: number;
      readonly confirmed: number;
      readonly confirmedComplete: boolean;
      /** How many parts the ids were cut into. */
      readonly parts: number;
    }
  | {
      readonly part: "ids";
      readonly token: string;
      /** Until when a part with no head is a hold still being written. */
      readonly until: number;
      /** Where the part falls among the hold's parts, from 0. */
      readonly at: number;
      readonly text: string;
    };

/** Whether a value is a count: a whole number, none or more. */
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A head row's fields, read strictly. */
function headRowOf(
  row: Record<string, unknown>,
  token: string,
  until: number
): HoldRow | null {
  const { confirmed, confirmedComplete, parts } = row;
  if (typeof confirmed !== "number" || typeof confirmedComplete !== "boolean") {
    return null;
  }
  return isCount(parts)
    ? { part: "head", token, until, confirmed, confirmedComplete, parts }
    : null;
}

/** A stored hold row, read strictly: anything else holds nothing. */
function holdRowOf(text: unknown): HoldRow | null {
  if (typeof text !== "string") return null;
  let row: unknown;
  try {
    row = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainRecord(row)) return null;
  const { token, until } = row;
  if (typeof token !== "string" || typeof until !== "number") return null;
  if (row.part === "head") return headRowOf(row, token, until);
  if (row.part !== "ids" || !isCount(row.at) || typeof row.text !== "string") {
    return null;
  }
  return { part: "ids", token, until, at: row.at, text: row.text };
}

/** A hold's ids, cut into the parts its rows carry. */
function partsOf(ids: RetiredExposures): string[] {
  const text = JSON.stringify({
    properties: ids.properties,
    slots: ids.slots,
  });
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += IDS_PER_ROW) {
    parts.push(text.slice(at, at + IDS_PER_ROW));
  }
  return parts;
}

/** A hold's ids joined again from its parts, or `null` if they are not. */
function idsFrom(parts: readonly string[]): RetiredExposures | null {
  try {
    const ids = JSON.parse(parts.join("")) as unknown;
    if (!isPlainRecord(ids)) return null;
    const list = (value: unknown): string[] | null =>
      Array.isArray(value) &&
      value.every((id): id is string => typeof id === "string")
        ? value
        : null;
    const properties = list(ids.properties);
    const slots = list(ids.slots);
    return properties === null || slots === null ? null : { properties, slots };
  } catch {
    return null;
  }
}

/** One table row of a hold, with the row's own id to end it by. */
interface StoredRow {
  readonly id: string;
  readonly componentId: string;
  readonly row: HoldRow;
}

/** A table row as one of a hold's rows; anything else is none. */
function storedRowOf(item: unknown): StoredRow[] {
  if (!isPlainRecord(item)) return [];
  const { id, componentId, exposureId } = item;
  if (typeof componentId !== "string") return [];
  if (typeof id !== "string" && typeof id !== "number") return [];
  const row = holdRowOf(exposureId);
  return row === null ? [] : [{ id: String(id), componentId, row }];
}

/** A component's rows, by the token of the hold they belong to. */
function byToken(rows: readonly StoredRow[]): Map<string, StoredRow[]> {
  const tokens = new Map<string, StoredRow[]>();
  for (const stored of rows) {
    const list = tokens.get(stored.row.token) ?? [];
    list.push(stored);
    tokens.set(stored.row.token, list);
  }
  return tokens;
}

/** The latest head among a hold's rows, if it has one. */
function headOf(
  rows: readonly StoredRow[]
): Extract<HoldRow, { part: "head" }> | undefined {
  let head: Extract<HoldRow, { part: "head" }> | undefined;
  for (const { row } of rows) {
    if (row.part === "head" && (head === undefined || row.until > head.until)) {
      head = row;
    }
  }
  return head;
}

/** A hold read from its rows, or `null` when they are not one whole hold. */
function holdFrom(rows: readonly StoredRow[]): RemovalHold | null {
  const head = headOf(rows);
  if (head === undefined) return null;
  const parts = new Map<number, string>();
  for (const { row } of rows) {
    if (row.part === "ids") parts.set(row.at, row.text);
  }
  // A head is written after its parts and ended before them, so a part
  // missing is no hold this store wrote.
  const texts: string[] = [];
  for (let at = 0; at < head.parts; at += 1) {
    const text = parts.get(at);
    if (text === undefined) return null;
    texts.push(text);
  }
  const ids = idsFrom(texts);
  if (ids === null || parts.size !== head.parts) return null;
  return {
    ...ids,
    confirmed: head.confirmed,
    confirmedComplete: head.confirmedComplete,
    until: head.until,
    token: head.token,
  };
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
    const rows: StoredRow[] = [];
    for (let at = 0; at < componentIds.length; at += IDS_PER_READ) {
      const ids = componentIds.slice(at, at + IDS_PER_READ);
      let more = true;
      for (let page = 1; more; page += 1) {
        const found = await nextly.find({
          collection: args.collection,
          where: { componentId: { in: ids }, kind: { equals: REMOVAL_HOLD } },
          limit: ROWS_PER_PAGE,
          page,
          sort: "id",
          depth: 0,
          overrideAccess: true,
        });
        rows.push(...found.items.flatMap(storedRowOf));
        more = found.meta.hasNext;
      }
    }
    return rows;
  };
  const write = async (
    nextly: HoldDirectApi,
    componentId: string,
    row: HoldRow
  ) => {
    // Keyed by what makes the row one of a kind: a head by its lease, a part
    // by where it falls, each within its hold.
    const key = [
      row.token,
      row.part,
      String(row.part === "head" ? row.until : row.at),
    ];
    await nextly.create({
      collection: args.collection,
      data: {
        identity: await retiredKey(
          componentId,
          REMOVAL_HOLD,
          JSON.stringify(key)
        ),
        componentId,
        kind: REMOVAL_HOLD,
        exposureId: JSON.stringify(row),
      },
      overrideAccess: true,
    });
  };
  // Heads first, so the hold ends at once and its ids go after it unread.
  const end = async (nextly: HoldDirectApi, rows: readonly StoredRow[]) => {
    const heads = rows.filter(({ row }) => row.part === "head");
    const ids = rows.filter(({ row }) => row.part !== "head");
    for (const { id } of [...heads, ...ids]) {
      await nextly.delete({
        collection: args.collection,
        id,
        overrideAccess: true,
      });
    }
  };
  const release = async (componentId: string, token?: string) => {
    const nextly = await args.nextly();
    const rows = await rowsOf(nextly, [componentId]);
    await end(
      nextly,
      token === undefined ? rows : rows.filter(({ row }) => row.token === token)
    );
  };
  return {
    of: async componentIds => {
      const ids = [...new Set(componentIds)];
      if (ids.length === 0) return new Map();
      const at = now();
      const held = new Map<string, RemovalHold[]>();
      const rows = await rowsOf(await args.nextly(), ids);
      for (const componentId of ids) {
        const own = rows.filter(row => row.componentId === componentId);
        for (const hold of byToken(own).values()) {
          const read = holdFrom(hold);
          if (read === null || read.until <= at) continue;
          held.set(componentId, [...(held.get(componentId) ?? []), read]);
        }
      }
      return held;
    },
    release,
    renew: async (componentId, token, until) => {
      const nextly = await args.nextly();
      const rows = (await rowsOf(nextly, [componentId])).filter(
        ({ row }) => row.token === token
      );
      const head = headOf(rows);
      if (head === undefined || head.until <= now()) return false;
      if (until <= head.until) return true;
      await write(nextly, componentId, { ...head, until });
      await end(
        nextly,
        rows.filter(({ row }) => row.part === "head")
      );
      return true;
    },
    hold: async (componentId, hold) => {
      const nextly = await args.nextly();
      // What ran out is ended first: a hold whose lease has passed, and the
      // parts of one never finished, once they could no longer be one.
      const at = now();
      for (const rows of byToken(
        await rowsOf(nextly, [componentId])
      ).values()) {
        const head = headOf(rows);
        const lapsed =
          head === undefined
            ? rows.every(({ row }) => row.until <= at)
            : head.until <= at;
        if (lapsed) await end(nextly, rows);
      }
      const { token, until } = hold;
      const parts = partsOf(hold);
      for (const [at, text] of parts.entries()) {
        await write(nextly, componentId, {
          part: "ids",
          token,
          until,
          at,
          text,
        });
      }
      await write(nextly, componentId, {
        part: "head",
        token,
        until,
        confirmed: hold.confirmed,
        confirmedComplete: hold.confirmedComplete,
        parts: parts.length,
      });
    },
  };
}

/** The store where nothing is retired, so nothing need be held. */
export const NO_HOLDS: RemovalHoldStore = {
  hold: () => Promise.resolve(),
  of: () => Promise.resolve(new Map()),
  renew: () => Promise.resolve(true),
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
  /**
   * Where the written collection or Single stores each blocks field it
   * declares: the same survey the strip on every write reads. A value of any
   * other field is not a placement anything draws, whatever its shape.
   */
  readonly paths: (
    collection: string,
    context: unknown
  ) => Promise<readonly (readonly string[])[]>;
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
  /** Whether the component store has the Draft/Published lifecycle. */
  readonly lifecycle: () => Promise<boolean>;
}): void {
  args.ctx.hooks.on("afterUpdate", args.componentCollection, async context => {
    const fields = context as { data?: unknown; executor?: unknown };
    const data = fields.data;
    if (fields.executor !== undefined || !isPlainRecord(data)) return;
    if (!(await putsLive(data, args.lifecycle))) return;
    const id = data.id;
    if (typeof id !== "string" && typeof id !== "number") return;
    const definition = asDocument(data[args.componentField]);
    if (definition === null) return;
    try {
      const holds = (await args.holds().of([String(id)])).get(String(id));
      for (const hold of holds ?? []) {
        if (stillExposes(definition, hold)) continue;
        await args.holds().release(String(id), hold.token);
      }
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
 * cleaned up after it all the same. Inside a caller's transaction the count
 * cannot be taken (it would read the pool, outside that transaction), so a
 * publish there that removes a held field is refused: published on its own,
 * it is counted.
 */
export function registerPublishRecount(args: {
  readonly ctx: RemovalFenceContext;
  readonly componentCollection: string;
  readonly componentField: string;
  readonly holds: () => Pick<RemovalHoldStore, "of" | "release">;
  readonly count: (componentId: string) => Promise<PlacementCount>;
  /** Whether the component store has the Draft/Published lifecycle. */
  readonly lifecycle: () => Promise<boolean>;
}): void {
  args.ctx.hooks.on("beforeUpdate", args.componentCollection, async context => {
    const fields = context as {
      data?: unknown;
      originalData?: unknown;
      executor?: unknown;
    };
    const data = fields.data;
    if (!isPlainRecord(data)) return;
    if (!(await putsLive(data, args.lifecycle))) return;
    const id = isPlainRecord(fields.originalData)
      ? fields.originalData.id
      : undefined;
    if (typeof id !== "string" && typeof id !== "number") return;
    const holds = (await args.holds().of([String(id)])).get(String(id)) ?? [];
    // A publish naming a definition that still exposes every field a hold is
    // for does not remove them; one naming none publishes the held draft,
    // which may. Each hold is judged on its own count.
    const definition = asDocument(data[args.componentField]);
    const removing = holds.filter(
      hold => definition === null || removesAny(definition, hold)
    );
    if (removing.length === 0) return;
    if (fields.executor !== undefined) {
      throw NextlyError.validation({
        errors: [
          {
            path: args.componentField,
            code: REMOVAL_RECOUNT,
            message:
              "This component's removed fields are waiting to be published, and can't be published as part of a batch or import. Publish the component on its own.",
          },
        ],
      });
    }
    const now = await args.count(String(id));
    const grown = removing.filter(hold => countGrew(now, hold));
    if (grown.length === 0) return;
    // A hold whose count has grown is ended with the refusal, so the publish
    // asked again takes a hold for the new count and is judged on that one
    // alone, rather than refused until the old lease runs out.
    for (const hold of grown) {
      await args.holds().release(String(id), hold.token);
    }
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

/**
 * Whether a write to the component store puts its definition live: a publish
 * where the store has the Draft/Published lifecycle (a working-draft save is
 * not one), and every write where it has none.
 */
async function putsLive(
  data: Record<string, unknown>,
  lifecycle: () => Promise<boolean>
): Promise<boolean> {
  if (data._isWorkingDraft === true) return false;
  return data.status === "published" || !(await lifecycle());
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
  readonly paths: RemovalFenceArgs["paths"];
  readonly limits: () => DocumentLimits;
  readonly count: (componentId: string) => Promise<PlacementCount>;
  readonly lifecycle: () => Promise<boolean>;
}): RemovalHoldStore {
  const holds = () => args.store;
  registerRemovalFence({
    ctx: args.ctx,
    holds,
    storedDraft: args.storedDraft,
    paths: args.paths,
    limits: args.limits,
  });
  registerHoldRelease({
    ctx: args.ctx,
    componentCollection: args.componentCollection,
    componentField: args.componentField,
    holds,
    lifecycle: args.lifecycle,
  });
  registerPublishRecount({
    ctx: args.ctx,
    componentCollection: args.componentCollection,
    componentField: args.componentField,
    holds,
    count: args.count,
    lifecycle: args.lifecycle,
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
  // of them, reads nothing; then only the declared blocks fields count.
  if (documentsIn(fields.data, 0, []).length === 0) return;
  let paths: readonly (readonly string[])[];
  try {
    paths = await args.paths(fields.collection, context);
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${fields.collection}" was not checked against components whose fields are being removed.`,
      { collection: fields.collection, error }
    );
    return;
  }
  const written = foundAt(fields.data, paths);
  if (written.length === 0) return;
  const limits = args.limits();
  const placed = new Set<string>();
  for (const { document } of written) {
    for (const id of componentIdsIn(document.nodes, limits.maxNodes)) {
      placed.add(id);
    }
  }
  if (placed.size === 0) return;
  let holds: ReadonlyMap<string, readonly RemovalHold[]>;
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
  const stored = await storedForms(args, fields, paths);
  for (const [componentId, hold] of eachHold(holds)) {
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

/** Every hold in force, with the component it is on. */
function* eachHold(
  holds: ReadonlyMap<string, readonly RemovalHold[]>
): Generator<readonly [string, RemovalHold]> {
  for (const [componentId, list] of holds) {
    for (const hold of list) yield [componentId, hold];
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
  },
  paths: readonly (readonly string[])[]
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
    foundAt(original, paths),
    ...(isPlainRecord(draft) ? [foundAt(draft, paths)] : []),
  ];
}

/**
 * Where the write sets a held field more often than a stored form does once
 * the write is applied to it: the blocks field's path in the write, or
 * `undefined` when it sets none anew. Counted with the strip that will take
 * the values out, so "set" here is exactly what the removal would remove.
 * Compared per field, across the whole document, so a value moved from one
 * placement to another is not new, and a blocks field the write leaves out
 * keeps what it stores. Which stored form a write replaces is decided only
 * once it runs, so a value new to any of them is refused: one the draft lacks
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
    const keys = new Set(written.map(found => found.path.join(".")));
    const grows = (form: readonly Found[]) =>
      count([
        ...form.filter(found => !keys.has(found.path.join("."))),
        ...written,
      ]) > count(form);
    if (stored.length === 0 ? count(written) > 0 : stored.some(grows)) {
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

/** The blocks documents a row holds at the declared paths. */
function foundAt(
  row: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): Found[] {
  return paths.flatMap(path => {
    let value: unknown = row;
    for (const key of path) {
      if (!isPlainRecord(value) || !Object.hasOwn(value, key)) return [];
      value = value[key];
    }
    const document = asDocument(value);
    return document === null ? [] : [{ path, document }];
  });
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
