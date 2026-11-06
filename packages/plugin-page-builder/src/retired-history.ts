/**
 * The retired ids a component's own history implies, and the repair that
 * records any the retired table lacks.
 *
 * A retirement is recorded after the publish that drops the field commits
 * (see `retired-exposure-hooks`), so a record that fails leaves the removed id
 * in neither the definition nor the table. Nothing would then keep a new field
 * from being minted under it, and the values placements still hold under that
 * id would come back on the new field. The table is therefore not the only
 * source: history keeps every definition that went live, so the retired ids
 * can always be derived again.
 *
 * They are derived as the publish hook records them: for each published
 * version, the ids the published version before it exposed and it does not.
 * An id dropped once stays retired even if a later version exposes it again,
 * as it would had the record been made: a restore of a definition from before
 * the removal does not bring the field back.
 *
 * Only versions whose content was served count. A field a draft added and the
 * next draft dropped was never on a page, so nothing holds values under it,
 * and retiring it would record what no publish ever did.
 *
 * The repair only adds. An id the table holds stays retired whatever history
 * says, and the store skips rows it holds, so the repair is safe to run any
 * number of times, including twice at once.
 *
 * @module retired-history
 */
import {
  isPlainRecord,
  type BlockDocument,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "./component-store-source";
import type { RetiredPins } from "./retired-pins";
import type { RetiredStore } from "./retired-store";

/** The document a component's versions belong to. */
export interface ComponentHistoryRef {
  readonly scopeKind: "collection";
  readonly scopeSlug: string;
  readonly entryId: string;
}

/**
 * The two history reads the derivation makes, as `ctx.services.versions`
 * offers them: they run as the system, so every version is read whoever
 * asks, and nothing read here is handed to a caller beyond the ids.
 */
export interface ComponentHistory {
  /** One page of durable versions, newest first, without snapshots. */
  list(
    ref: ComponentHistoryRef,
    options: { limit: number; cursor?: number }
  ): Promise<readonly { versionNo: number | null; status: string }[]>;
  /** One version, with its snapshot. */
  get(
    ref: ComponentHistoryRef,
    versionNo: number
  ): Promise<{ snapshot: unknown }>;
}

/** How many versions one page of the listing returns. */
const VERSIONS_PER_PAGE = 50;

/**
 * How many listing pages one derivation reads, and how many published
 * snapshots it loads: the bounds a component with an unusually long history
 * is read under. Past either, the derivation says it is incomplete.
 */
const MAX_PAGES = 100;
const MAX_SERVED_SNAPSHOTS = 500;

/**
 * How many snapshots are read at once: enough that a first read of a long
 * history is not one round trip per version, few enough that one component
 * does not take the pool.
 */
const SNAPSHOTS_AT_ONCE = 8;

/** How many components' history the memo keeps. */
const MEMO_SIZE = 256;

/** What a derivation found in the versions up to one version number. */
interface Folded {
  /** The newest version number read. */
  readonly through: number;
  /** Every id a published version dropped. */
  readonly retired: RetiredExposures;
  /**
   * The ids the newest published definition read exposes: what the next
   * published version is compared with.
   */
  readonly newest: RetiredExposures | undefined;
}

/**
 * What the derivation has already read of each component's history.
 *
 * History only grows: a version, once recorded, is never rewritten, so what
 * the versions up to a number dropped stays what it was, and the next
 * derivation reads only what was recorded since. Retention may prune old
 * versions later; what they dropped is kept here. Kept per process and
 * bounded, the oldest entry going first, and only from a complete read.
 */
export interface RetiredHistoryMemo {
  get(key: string): Folded | undefined;
  set(key: string, folded: Folded): void;
}

/** A memo of at most {@link MEMO_SIZE} components. */
export function retiredHistoryMemo(): RetiredHistoryMemo {
  const entries = new Map<string, Folded>();
  return {
    get: key => entries.get(key),
    set: (key, folded) => {
      entries.delete(key);
      entries.set(key, folded);
      if (entries.size > MEMO_SIZE) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}

/** What a derivation reads through. */
export interface RetiredHistoryArgs {
  readonly history: ComponentHistory;
  /** The RESOLVED slug component definitions are stored under. */
  readonly componentCollection: string;
  /** The field on a component row holding its document. */
  readonly componentField: string;
  /**
   * Whether the store has the Draft/Published lifecycle. Without it every
   * version was served, whatever its status says.
   */
  readonly lifecycle: boolean;
  readonly memo?: RetiredHistoryMemo;
}

/** A derivation's answer. */
export interface DerivedRetired {
  readonly retired: RetiredExposures;
  /**
   * False when the bounds stopped the read before the oldest version, or a
   * published definition could not be read, so a removal may be missing. The
   * ids are then the ones found, never more.
   */
  readonly complete: boolean;
  /** The newest version number read: what the answer is true as of. */
  readonly through: number;
}

const NONE: RetiredExposures = { properties: [], slots: [] };

/** What one published version says about the definition. */
export type Exposure = RetiredExposures | "absent" | "unreadable";

/** The ids a component's published history retired. */
export async function deriveRetired(
  args: RetiredHistoryArgs,
  componentId: string
): Promise<DerivedRetired> {
  const ref: ComponentHistoryRef = {
    scopeKind: "collection",
    scopeSlug: args.componentCollection,
    entryId: componentId,
  };
  // Keyed by what decides which versions count, as well as by the component:
  // a host that moves the store or turns its lifecycle off reads afresh.
  const key = [args.componentCollection, args.lifecycle, componentId].join(
    "\u0000"
  );
  const known = args.memo?.get(key);
  const walk = await walkHistory(args, ref, known);
  const folded = foldWalk(walk, known);
  // A definition that could not be read may have dropped an id, and the
  // derivation cannot say which.
  const complete = walk.reached && !walk.served.includes("unreadable");
  if (complete && folded.through > 0) args.memo?.set(key, folded);
  return { retired: folded.retired, complete, through: folded.through };
}

/** A walk down one component's history, newest first. */
interface Walk {
  /** The newest version number listed. */
  newest: number | undefined;
  /** The last version number listed, where the next page starts below. */
  cursor: number | undefined;
  /** What each published version says, newest first. */
  readonly served: Exposure[];
  /** Whether it reached the oldest version, or the part the memo holds. */
  reached: boolean;
  /** Whether it has stopped, at the end or at a bound. */
  done: boolean;
}

/** List the versions not yet folded, a page at a time, under the bounds. */
async function walkHistory(
  args: RetiredHistoryArgs,
  ref: ComponentHistoryRef,
  known: Folded | undefined
): Promise<Walk> {
  const walk: Walk = {
    newest: undefined,
    cursor: undefined,
    served: [],
    reached: false,
    done: false,
  };
  for (let page = 0; page < MAX_PAGES && !walk.done; page += 1) {
    const rows = await args.history.list(ref, {
      limit: VERSIONS_PER_PAGE,
      ...(walk.cursor === undefined ? {} : { cursor: walk.cursor }),
    });
    const load = toLoad(args, known, rows, walk);
    walk.served.push(...(await loadAll(args, ref, load)));
    if (!walk.done && rows.length < VERSIONS_PER_PAGE) {
      walk.reached = true;
      walk.done = true;
    }
  }
  return walk;
}

/**
 * The published versions of one listed page to load, newest first. Marks the
 * walk done where it meets what the memo holds, or its bound.
 */
function toLoad(
  args: RetiredHistoryArgs,
  known: Folded | undefined,
  rows: readonly { versionNo: number | null; status: string }[],
  walk: Walk
): number[] {
  const load: number[] = [];
  for (const row of rows) {
    const versionNo = row.versionNo;
    if (typeof versionNo !== "number") continue;
    if (known !== undefined && versionNo <= known.through) {
      walk.reached = true;
      walk.done = true;
      break;
    }
    walk.newest ??= versionNo;
    walk.cursor = versionNo;
    if (args.lifecycle && row.status !== "published") continue;
    if (walk.served.length + load.length === MAX_SERVED_SNAPSHOTS) {
      walk.done = true;
      break;
    }
    load.push(versionNo);
  }
  return load;
}

/** What each of these versions says, a few reads at a time, in order. */
async function loadAll(
  args: RetiredHistoryArgs,
  ref: ComponentHistoryRef,
  versionNos: readonly number[]
): Promise<Exposure[]> {
  const loaded: Exposure[] = [];
  for (let at = 0; at < versionNos.length; at += SNAPSHOTS_AT_ONCE) {
    const versions = await Promise.all(
      versionNos
        .slice(at, at + SNAPSHOTS_AT_ONCE)
        .map(versionNo => args.history.get(ref, versionNo))
    );
    for (const version of versions) {
      loaded.push(exposedIn(version.snapshot, args.componentField));
    }
  }
  return loaded;
}

/**
 * What the walk and the memo know together: each published version compared
 * with the one before it. The memo's part counts only when the walk reached
 * it, since a walk its bound stopped has a gap between the two.
 */
function foldWalk(walk: Walk, known: Folded | undefined): Folded {
  const joined = walk.reached ? known : undefined;
  const definitions = walk.served.filter(
    (exposure): exposure is RetiredExposures => typeof exposure !== "string"
  );
  // Oldest last: the memo's newest definition precedes everything read now.
  const ordered =
    joined?.newest === undefined
      ? definitions
      : [...definitions, joined.newest];
  const dropped = ordered
    .slice(0, -1)
    .map((after, index) => droppedFrom(ordered[index + 1], after));
  return {
    through: walk.newest ?? known?.through ?? 0,
    retired: union([...dropped, joined?.retired ?? NONE]),
    newest: definitions[0] ?? joined?.newest,
  };
}

/** The ids `before` exposes that `after` does not. */
function droppedFrom(
  before: RetiredExposures,
  after: RetiredExposures
): RetiredExposures {
  return {
    properties: before.properties.filter(id => !after.properties.includes(id)),
    slots: before.slots.filter(id => !after.slots.includes(id)),
  };
}

/** Every id any of these holds, once each, in the order first seen. */
function union(all: readonly RetiredExposures[]): RetiredExposures {
  return {
    properties: [...new Set(all.flatMap(ids => ids.properties))],
    slots: [...new Set(all.flatMap(ids => ids.slots))],
  };
}

/**
 * What a version's snapshot says about the definition: the ids it exposes,
 * `absent` when it holds none (a row saved before its definition, which says
 * nothing about which ids went), or `unreadable` when it holds one this cannot
 * read.
 */
export function exposedIn(snapshot: unknown, field: string): Exposure {
  const row = typeof snapshot === "string" ? parsed(snapshot) : snapshot;
  if (!isPlainRecord(row)) return "unreadable";
  const value = row[field];
  if (value === null || value === undefined) return "absent";
  const document = asDocument(value);
  return document === null ? "unreadable" : exposureIdsOf(document);
}

/** `JSON.parse`, answering `undefined` rather than throwing. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The field and slot ids a definition exposes, read as stored. */
export function exposureIdsOf(document: BlockDocument): RetiredExposures {
  const envelope = document as unknown as Record<string, unknown>;
  const exposed = Array.isArray(envelope.exposed) ? envelope.exposed : [];
  const properties: string[] = [];
  for (const entry of exposed) {
    const id = isPlainRecord(entry) ? entry.id : undefined;
    if (typeof id === "string") properties.push(id);
  }
  const slots = isPlainRecord(envelope.slots)
    ? Object.keys(envelope.slots)
    : [];
  return { properties, slots };
}

/** What the repair reads and writes through. */
export interface ReconcileArgs extends RetiredHistoryArgs {
  readonly store: RetiredStore;
  /**
   * The versions held for removals whose records were lost, released once a
   * repair has read history whole and recorded what it found.
   */
  readonly pins?: Pick<RetiredPins, "release">;
  readonly logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

/** What a repair found, and whether history was read whole. */
export interface RepairedRetired {
  /** The table's ids and the derived ones together. */
  readonly retired: RetiredExposures;
  /** As {@link DerivedRetired.complete}. */
  readonly complete: boolean;
}

/**
 * Record the retired ids history implies that the table lacks, and answer the
 * table's and history's together, read whole or not.
 *
 * Raises when either read fails. A record that fails is logged, and the
 * derived ids are still answered: they are retired whether or not the table
 * holds them yet, and the next repair records them.
 */
export async function repairRetired(
  args: ReconcileArgs,
  componentId: string
): Promise<RepairedRetired> {
  const derived = await deriveRetired(args, componentId);
  const held = (await args.store.of([componentId])).get(componentId) ?? NONE;
  const missing: RetiredExposures = {
    properties: derived.retired.properties.filter(
      id => !held.properties.includes(id)
    ),
    slots: derived.retired.slots.filter(id => !held.slots.includes(id)),
  };
  const recorded = await recordMissing(args, componentId, missing);
  // Only a component that has retired something can hold versions for a lost
  // removal: what a pin holds is read here like the rest of history.
  const retiredAny =
    derived.retired.properties.length > 0 || derived.retired.slots.length > 0;
  if (recorded && derived.complete && retiredAny) {
    await releasePins(args, componentId, derived.through);
  }
  return {
    retired: {
      properties: [...held.properties, ...missing.properties],
      slots: [...held.slots, ...missing.slots],
    },
    complete: derived.complete,
  };
}

/**
 * Record the derived ids the table lacks. Answers whether the table now holds
 * them all; a record that fails is logged, and the next repair makes it.
 */
async function recordMissing(
  args: ReconcileArgs,
  componentId: string,
  missing: RetiredExposures
): Promise<boolean> {
  if (missing.properties.length === 0 && missing.slots.length === 0) {
    return true;
  }
  try {
    await args.store.retire(componentId, missing);
    return true;
  } catch (error) {
    args.logger.error(
      `[page-builder] the fields component "${componentId}" retired could ` +
        "not be recorded; they stay reserved, and the next read records them.",
      { componentId, retired: missing, error }
    );
    return false;
  }
}

/**
 * Free the versions held for the component's lost removals: the table holds
 * every retirement history shows, so history is no longer the only copy. A
 * release that fails keeps them held, which costs only retention room.
 */
async function releasePins(
  args: ReconcileArgs,
  componentId: string,
  through: number
): Promise<void> {
  try {
    await args.pins?.release(componentId, through);
  } catch (error) {
    args.logger.warn(
      `[page-builder] the versions held for component "${componentId}"'s ` +
        "removed fields were not released; they stay held, and the next " +
        "repair releases them.",
      { componentId, error }
    );
  }
}

/**
 * The component's retired ids for a caller about to mint: {@link repairRetired},
 * failing when history could not be read whole, so a new id is never chosen
 * from a partial answer. What was found is recorded first.
 */
export async function reconcileRetired(
  args: ReconcileArgs,
  componentId: string
): Promise<RetiredExposures> {
  const repaired = await repairRetired(args, componentId);
  if (!repaired.complete) {
    throw new Error(
      `[page-builder] the history of component "${componentId}" could not ` +
        "be read whole, so a field it retired may be missing from its " +
        "retired ids; no field id is offered until it can."
    );
  }
  return repaired.retired;
}
