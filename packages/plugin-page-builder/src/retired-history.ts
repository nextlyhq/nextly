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
 * can always be derived again, as every field and slot id any published
 * version exposed minus the ids the newest published version exposes.
 *
 * Only versions whose content was served count. A field a draft added and the
 * next draft dropped was never on a page, so nothing holds values under it,
 * and retiring it would record what no publish ever did.
 *
 * The repair only adds. An id the table holds stays retired whatever history
 * says, so a restore that brings an old definition back cannot un-retire one;
 * and the store skips rows it holds, so the repair is safe to run any number
 * of times, including twice at once.
 *
 * @module retired-history
 */
import {
  isPlainRecord,
  type BlockDocument,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "./component-store-source";
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
 * is read under. Past either, the derivation says it is incomplete, and keeps
 * what it found, which is the newest part of the history and the part a lost
 * record is in.
 */
const MAX_PAGES = 100;
const MAX_SERVED_SNAPSHOTS = 500;

/** How many components' history the memo keeps. */
const MEMO_SIZE = 256;

/** What a derivation found in the versions up to one version number. */
interface Folded {
  /** The newest version number read. */
  readonly through: number;
  /** Every id a served version exposed. */
  readonly ever: RetiredExposures;
  /** The ids the newest served version exposes, if one was read. */
  readonly current: RetiredExposures | undefined;
}

/**
 * What the derivation has already read of each component's history.
 *
 * History only grows: a version, once recorded, is never rewritten, so the ids
 * the versions up to a number exposed stay what they were, and the next
 * derivation reads only what was recorded since. Retention may prune old
 * versions later; what they exposed is kept here, which is the point. Kept
 * per process and bounded, the oldest entry going first.
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
   * False when the bounds stopped the read before the oldest version, or the
   * newest published definition could not be read. The ids are then the ones
   * found, never more.
   */
  readonly complete: boolean;
}

const NONE: RetiredExposures = { properties: [], slots: [] };

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
  // The live definition is the one to subtract. Unreadable, it cannot be
  // replaced by an older one: an id the live one still exposes would then read
  // as retired, and its values would be stripped from pages that show it.
  if (walk.served[0] === null) return { retired: NONE, complete: false };
  const folded = foldWalk(walk, known);
  if (walk.reached && folded.through > 0) args.memo?.set(key, folded);
  return { retired: retiredOf(folded), complete: walk.reached };
}

/** A walk down one component's history, newest first. */
interface Walk {
  /** The newest version number listed. */
  newest: number | undefined;
  /** The last version number listed, where the next page starts below. */
  cursor: number | undefined;
  /** Each served version's ids, newest first; null where unreadable. */
  readonly served: (RetiredExposures | null)[];
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
    for (const row of rows) {
      if (walk.done) break;
      await stepTo(args, ref, known, row, walk);
    }
    if (!walk.done && rows.length < VERSIONS_PER_PAGE) {
      walk.reached = true;
      walk.done = true;
    }
  }
  return walk;
}

/** Take one listed version into the walk, loading it only if it was served. */
async function stepTo(
  args: RetiredHistoryArgs,
  ref: ComponentHistoryRef,
  known: Folded | undefined,
  row: { versionNo: number | null; status: string },
  walk: Walk
): Promise<void> {
  const versionNo = row.versionNo;
  if (typeof versionNo !== "number") return;
  if (known !== undefined && versionNo <= known.through) {
    walk.reached = true;
    walk.done = true;
    return;
  }
  walk.newest ??= versionNo;
  walk.cursor = versionNo;
  if (args.lifecycle && row.status !== "published") return;
  if (walk.served.length === MAX_SERVED_SNAPSHOTS) {
    walk.done = true;
    return;
  }
  const version = await args.history.get(ref, versionNo);
  walk.served.push(exposedIn(version.snapshot, args.componentField));
}

/**
 * What the walk and the memo know together. The memo's part counts only when
 * the walk reached it: a walk its bound stopped has a gap between the two.
 */
function foldWalk(walk: Walk, known: Folded | undefined): Folded {
  const readable = walk.served.filter(
    (ids): ids is RetiredExposures => ids !== null
  );
  const joined = walk.reached && known !== undefined ? known : undefined;
  return {
    through: walk.newest ?? known?.through ?? 0,
    ever: union(joined === undefined ? readable : [...readable, joined.ever]),
    current: readable[0] ?? joined?.current,
  };
}

/** Every id any of these exposes, once each, in the order first seen. */
function union(all: readonly RetiredExposures[]): RetiredExposures {
  return {
    properties: [...new Set(all.flatMap(ids => ids.properties))],
    slots: [...new Set(all.flatMap(ids => ids.slots))],
  };
}

/** Every id served once and not served now. */
function retiredOf(folded: Folded): RetiredExposures {
  const current = folded.current;
  if (current === undefined) return NONE;
  return {
    properties: folded.ever.properties.filter(
      id => !current.properties.includes(id)
    ),
    slots: folded.ever.slots.filter(id => !current.slots.includes(id)),
  };
}

/** The ids a version's snapshot exposes, or null when it holds no definition. */
function exposedIn(snapshot: unknown, field: string): RetiredExposures | null {
  const row = typeof snapshot === "string" ? parsed(snapshot) : snapshot;
  if (!isPlainRecord(row)) return null;
  const document = asDocument(row[field]);
  return document === null ? null : exposureIdsOf(document);
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
  readonly logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * The component's retired ids, the table's and history's together, with any
 * the table lacks recorded.
 *
 * Raises when either read fails, so a caller about to mint never goes ahead on
 * a partial answer. A record that fails is logged, and the derived ids are
 * still answered: they are retired whether or not the table holds them yet,
 * and the next repair records them.
 */
export async function reconcileRetired(
  args: ReconcileArgs,
  componentId: string
): Promise<RetiredExposures> {
  const derived = await deriveRetired(args, componentId);
  if (!derived.complete) {
    args.logger.warn(
      `[page-builder] the history of component "${componentId}" was not read ` +
        "to its start, so a field it retired before the part read may be " +
        "missing from its retired ids.",
      { componentId }
    );
  }
  const held = (await args.store.of([componentId])).get(componentId) ?? NONE;
  const missing: RetiredExposures = {
    properties: derived.retired.properties.filter(
      id => !held.properties.includes(id)
    ),
    slots: derived.retired.slots.filter(id => !held.slots.includes(id)),
  };
  if (missing.properties.length > 0 || missing.slots.length > 0) {
    try {
      await args.store.retire(componentId, missing);
    } catch (error) {
      args.logger.error(
        `[page-builder] the fields component "${componentId}" retired could ` +
          "not be recorded; they stay reserved, and the next read records them.",
        { componentId, retired: missing, error }
      );
    }
  }
  return {
    properties: [...held.properties, ...missing.properties],
    slots: [...held.slots, ...missing.slots],
  };
}
