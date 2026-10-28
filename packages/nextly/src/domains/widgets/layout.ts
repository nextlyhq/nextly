/**
 * A reader's own arrangement of the dashboard: what it stores, and what it
 * refuses to store.
 *
 * ## One ordered list of cards, each at a size
 *
 * A stored arrangement is a list of placements whose ARRAY ORDER is the order
 * the cards are drawn in, each sized `{ w, h }` in grid units (`grid-size.ts`):
 * `w` columns of twelve and `h` rows. Cards fill the grid left to right and
 * wrap, and nothing about a card's size is stored but those two numbers.
 *
 * ## A row of an earlier format is no saved arrangement
 *
 * 🔴 Nothing is converted. A row this core wrote in an earlier format is read
 * as though its reader had no row at all: they are handed the current default
 * and follow it, and nothing of the row is carried over -- no card, size,
 * setting, removal or skipped Get started step. Only the row's version number
 * is read. The read never writes, so the row stays exactly as it was until its
 * owner's next write of any kind replaces it with a row of the current format,
 * holding only what that write says, as it would create a row for someone who
 * had none. A read that wrote would race the version guard and a second tab,
 * turning reads into conflicts.
 *
 * ## The stored layout is a THIRD reader of the widget contract
 *
 * The registry and the plugin channel are the other two. This one holds data
 * THIS core wrote, about widgets it did not, which is why its validation is
 * SHAPE ONLY. Whether a `widgetId` names a widget that exists, or a size lies
 * within the widget's current bounds, are questions about the live registry,
 * asked on every read rather than frozen here. Whether a size is one the grid
 * can draw at all is the grid's own rule, so it is the one field judged here.
 *
 * ## What a placement deliberately does NOT hold
 *
 * 🔴 No `requiredPermission`, and no other copy of anything the definition
 * owns. A placement stores an identity, a size and its settings. Every
 * question about whether this reader may SEE the widget is asked of the live
 * registry on every read, so a permission tightened after a layout was saved
 * takes effect at once.
 *
 * ## Why a placement id is not a widget id
 *
 * A placement is one card with its own identity, so one widget can appear
 * twice with different `config`. The DEFAULT set names each placement after its
 * widget, a stable id that keeps repeated reads identical, and each further
 * card of one widget by the id the site config names for it; a card added
 * later gets a generated id.
 *
 * @module domains/widgets/layout
 */

import { createHash } from "node:crypto";

import { NextlyError } from "../../errors/nextly-error";

import {
  GRID_COLUMNS,
  isGridSize,
  MAX_GRID_ROWS,
  MIN_GRID_ROWS,
} from "./grid-size";
import { MAX_PLACEMENTS } from "./layout-limits";
import { LAYOUT_SCHEMA_VERSION } from "./layout-payload";

// The payload's version, writer and size check live in the import-free
// `layout-payload.ts`, so the browser asks the endpoint's own question about
// what fits. Re-exported, so this module's importers are unchanged.
export {
  DASHBOARD_FULL_MESSAGE,
  LAYOUT_SCHEMA_VERSION,
  MAX_LAYOUT_BYTES,
  layoutSizeProblem,
  serializeLayout,
} from "./layout-payload";

/**
 * The versions this core wrote before the current one: the flat first format,
 * the columns format after it, and the list of named widths.
 *
 * 🔴 Named, rather than "anything below the current version". A row with no
 * version, or one naming a version this core never wrote, is not an earlier
 * format to reset: it is a row nothing here understands, and it stays on the
 * unreadable path, with its operator record and the reader's confirmation
 * before a save replaces it.
 */
const EARLIER_LAYOUT_VERSIONS: ReadonlySet<unknown> = new Set([1, 2, 3]);

/** One card, at one position in the list, for one reader. */
export interface WidgetPlacement {
  /** Opaque and unique WITHIN a layout. Not a widget id, except by default. */
  id: string;
  /** Which registry entry this draws. Resolved live on every read. */
  widgetId: string;
  /**
   * How many grid columns the card spans, 1 to 12. KEPT as stored even when it
   * lies outside the widget's current bounds: the admin draws the nearest size
   * inside them, and the stored size stays until its owner saves.
   */
  w: number;
  /** How many grid rows the card spans, kept as stored as `w` is. */
  h: number;
  /**
   * Removed cards are RETURNED and kept, settings and size included, so a
   * reader can put one back where it was.
   */
  removed: boolean;
  /** Per-placement settings. Opaque to core; the widget's own vocabulary. */
  config?: Record<string, unknown>;
}

/** The decoded contents of one `nextly_widget_layout.layout` column. */
export interface StoredLayout {
  schemaVersion: number;
  /** The cards, in the order they are drawn. */
  placements: WidgetPlacement[];
  /**
   * Ids this row holds more than once, absent when it is sound.
   *
   * 🔴 Metadata ABOUT the read, not content of the row, and never serialized.
   * It reports what was FOUND rather than what was fixed, because the fixing
   * happens later, per caller, in `partitionPlacements`; this is the one view
   * of the whole row, and it never leaves the server.
   */
  duplicatePlacementIds?: readonly string[];
  /**
   * Present, and `true`, only on a row no reader ever ARRANGED.
   *
   * 🔴 A row existing and a reader having taken charge of their dashboard are
   * different facts. Removing one card from the dashboard itself writes a row
   * without arranging anything, and that reader must keep following the
   * default rather than be frozen out of every widget declared afterwards.
   * Stored as the rare-case negative: absent is the ordinary, arranged row.
   *
   * Read it through {@link layoutIsArranged}, never directly.
   */
  unarranged?: true;
}

function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PlacementRule = (placement: Record<string, unknown>) => string | undefined;

/**
 * The rules a placement satisfies, as a LIST rather than a ladder (one
 * function per field, so no single function trips the complexity gate, and
 * each answers in words the sender of a refused PUT can act on).
 *
 * A body in an earlier format fails here: it has no `w` and no `h`. That is
 * the refusal of an earlier format the endpoint promises, reached by the same
 * rules a stored row is read with, so the two cannot disagree.
 */
const PLACEMENT_RULES: readonly PlacementRule[] = [
  p => (isUsableText(p.id) ? undefined : 'a placement needs a non-empty "id"'),
  p =>
    isUsableText(p.widgetId)
      ? undefined
      : 'a placement needs a non-empty "widgetId"',
  // The grid's own rule, asked through the one function that states it. Only
  // whether the grid can draw the size: the widget's bounds are the registry's.
  p =>
    isGridSize({ w: p.w, h: p.h })
      ? undefined
      : `"w" and "h" must be whole numbers the grid can draw, "w" from 1 to ${GRID_COLUMNS} and "h" from ${MIN_GRID_ROWS} to ${MAX_GRID_ROWS}`,
  p =>
    typeof p.removed === "boolean" ? undefined : '"removed" must be a boolean',
  p =>
    p.config === undefined || isPlainObject(p.config)
      ? undefined
      : '"config", when given, must be an object',
  p =>
    p.config !== undefined && exceedsDepth(p.config, MAX_CONFIG_DEPTH)
      ? `"config" may nest at most ${MAX_CONFIG_DEPTH} levels`
      : undefined,
];

/**
 * Whether a value nests deeper than `limit`.
 *
 * Iterative rather than recursive, deliberately: a recursive walk overflows the
 * stack on exactly the input this exists to reject.
 */
function exceedsDepth(value: unknown, limit: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop() as {
      value: unknown;
      depth: number;
    };
    if (current === null || typeof current !== "object") continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(current)
      ? current
      : Object.values(current)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return false;
}

function firstProblem(
  value: unknown,
  rules: readonly PlacementRule[]
): string | undefined {
  if (!isPlainObject(value)) return "a placement must be an object";
  for (const rule of rules) {
    const problem = rule(value);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Why this value cannot be a placement, or `undefined`.
 *
 * Exported so the endpoint that accepts a PUT and the reader that decodes a
 * stored row ask the identical question: a shape one accepted and the other
 * refused would be a row that can be written and never read.
 */
export function placementProblem(value: unknown): string | undefined {
  return firstProblem(value, PLACEMENT_RULES);
}

/**
 * One pass over a set of placements, answering everything anyone asks about
 * their ids: whether one repeats, and the same placements with any repeat
 * resolved.
 *
 * 🔴 ONE analysis, because the refusal and the repair must agree. The endpoint
 * refuses a submission holding a repeat and a reader resolves one it finds
 * stored; asking that question in two places lets a later change accept a
 * collision one end tolerates and the other rewrites.
 *
 * `seed` is the set already claimed by placements this call is not looking at.
 * It is COPIED rather than mutated.
 *
 * Downstream readers assume the answer holds: the admin keys each card, its
 * drag item and its widget query by placement id, so a repeat would drag the
 * wrong card and let two cards answer each other's queries.
 */
export function resolvePlacementIds(
  placements: readonly WidgetPlacement[],
  seed: ReadonlySet<string> = new Set()
): {
  /** The first id already claimed when it was reached, if any. */
  duplicate?: string;
  /** The placements, with every repeat re-keyed. */
  placements: WidgetPlacement[];
  /** The ORIGINAL ids that had to be re-keyed, in the order met. */
  rekeyed: string[];
} {
  const taken = new Set(seed);
  const rekeyed: string[] = [];
  let duplicate: string | undefined;

  const resolved = placements.map(placement => {
    if (!taken.has(placement.id)) {
      taken.add(placement.id);
      return placement;
    }
    duplicate ??= placement.id;
    rekeyed.push(placement.id);
    const id = repairedPlacementId(placement.id, taken);
    taken.add(id);
    return { ...placement, id };
  });

  return {
    ...(duplicate === undefined ? {} : { duplicate }),
    placements: resolved,
    rekeyed,
  };
}

/**
 * The id a repeat is given: DERIVED from the one it repeats, never minted.
 *
 * 🔴 Stable across reads, which is what makes repairing on read safe at all. A
 * fresh random id would answer a different id on every GET, so a client that
 * round-trips what it was handed would submit an id the server no longer
 * recognises.
 */
function repairedPlacementId(
  original: string,
  taken: ReadonlySet<string>
): string {
  let ordinal = 2;
  let candidate = `${original}~${ordinal}`;
  while (taken.has(candidate)) {
    ordinal += 1;
    candidate = `${original}~${ordinal}`;
  }
  return candidate;
}

/** A placement, with only the fields this core stores, in a stable order. */
function toPlacement(value: Record<string, unknown>): WidgetPlacement {
  return {
    id: value.id as string,
    widgetId: value.widgetId as string,
    w: value.w as number,
    h: value.h as number,
    removed: value.removed as boolean,
    ...(value.config === undefined
      ? {}
      : { config: value.config as Record<string, unknown> }),
  };
}

/**
 * Reads a caller's or a stored row's placement array, or says why it cannot.
 *
 * Rebuilds each placement from the fields this core knows rather than passing
 * the decoded object through, so nothing a client chose to add is stored.
 */
export function readPlacements(value: unknown): WidgetPlacement[] {
  if (!Array.isArray(value)) {
    throw NextlyError.invalidInput({
      message: 'Invalid dashboard layout: "placements" must be an array.',
    });
  }
  return value.map((entry, index) => {
    const problem = placementProblem(entry);
    if (problem !== undefined) {
      throw NextlyError.invalidInput({
        message: `Invalid dashboard layout: placements[${index}] ${problem}.`,
      });
    }
    return toPlacement(entry as Record<string, unknown>);
  });
}

/**
 * Decodes one stored `layout` column: the arrangement it holds, or `undefined`
 * for a row of an earlier format, which is no saved arrangement (the module
 * note). Only an earlier row's version number is read, never its content.
 *
 * THROWS on anything else it cannot read, rather than quietly resetting to the
 * default. A saved arrangement vanishing with no signal is the worse failure:
 * the caller decides what to do with the throw. The service logs it, the
 * dashboard draws the default, the person is told, and the row is left
 * untouched until they choose to replace it.
 *
 * A pure function of the stored text, so reading one row twice gives
 * identical cards and ids.
 */
export function readStoredLayout(raw: string): StoredLayout | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw NextlyError.internal({
      ...(cause instanceof Error ? { cause } : {}),
      logContext: { reason: "stored dashboard layout is not valid JSON" },
    });
  }

  if (!isPlainObject(decoded)) {
    throw NextlyError.internal({
      logContext: { reason: "stored dashboard layout is not an object" },
    });
  }

  // The ONE version check, legitimate because this core wrote the value. An
  // earlier version is answered before anything else in the row is looked at,
  // so nothing of its content can reach a reader.
  if (EARLIER_LAYOUT_VERSIONS.has(decoded.schemaVersion)) return undefined;
  // A version above ours came from a NEWER core and holds fields we would drop
  // on the next write; one we never had is not a shape to guess at.
  if (decoded.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw NextlyError.internal({
      logContext: {
        reason: "stored dashboard layout names an unknown schema version",
        found: String(decoded.schemaVersion),
        expected: LAYOUT_SCHEMA_VERSION,
      },
    });
  }

  const placements = readPlacements(decoded.placements);
  // 🔴 REPORTS a repeat rather than resolving one. Resolving across the whole
  // row would let a card this caller may not know exists claim an id and push a
  // card they CAN see onto a different one, so the id they are handed would
  // depend on a card that was filtered so they could not learn of it.
  const { rekeyed } = resolvePlacementIds(placements);
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    placements,
    // `=== true` rather than truthiness: anything else this core did not
    // write is the ordinary, arranged row.
    ...(decoded.unarranged === true ? { unarranged: true as const } : {}),
    ...(rekeyed.length === 0 ? {} : { duplicatePlacementIds: rekeyed }),
  };
}

/**
 * Whether a reader has taken charge of this arrangement.
 *
 * The ONE reading of {@link StoredLayout.unarranged}. An arranged row is a
 * snapshot the read path honours as written; an unarranged one still follows
 * the live default, so a widget declared after it was written reaches the
 * reader the way it reaches somebody with no row at all.
 *
 * 🔴 The invariant that keeps this safe: ANY write that can drop a placement
 * from the array must be an arranged one. An unarranged row is then only ever
 * the default plus the reader's choices about its cards (removed flags and
 * per-card settings), so following the default cannot bring back a card the
 * reader deliberately took away.
 */
export function layoutIsArranged(stored: StoredLayout): boolean {
  return stored.unarranged !== true;
}

/**
 * The default arrangement with a reader's choices about its cards applied.
 *
 * For a row that still follows the default: positions, sizes and the set of
 * cards all come from `defaults`, and the stored row contributes only what its
 * reader chose about each card -- that they removed it, and the settings they
 * gave it. A setting changed outside customise mode is written to such a row,
 * and reading only the removals back dropped it on every read. A setting the
 * default's own entry starts a card with gives way to one stored for it.
 *
 * Keyed by CARD, across the whole stored row and whatever its visibility, so
 * a removal or a setting on a card the reader has since lost access to is
 * still honoured the day access returns, and a removed card keeps its settings
 * for when it is put back. `undefined` is a reader with no row.
 *
 * 🔴 By placement id, so two cards of one widget the default places keep a
 * choice each: keyed by widget, the last card's choice was every card's. A
 * widget the default and the row each hold ONE card of is matched by widget
 * too, so a row whose card was stored under another id keeps its choice.
 */
export function dismissalsApplied(
  defaults: readonly WidgetPlacement[],
  stored: StoredLayout | undefined
): WidgetPlacement[] {
  const placements = stored?.placements ?? [];
  const byId = new Map(placements.map(placement => [placement.id, placement]));
  const soleCardOf = soleCardsByWidget(placements);
  const soleInDefault = soleCardsByWidget(defaults);
  return defaults.map(placement => {
    const choice =
      byId.get(placement.id) ??
      (soleInDefault.has(placement.widgetId)
        ? soleCardOf.get(placement.widgetId)
        : undefined);
    if (choice === undefined) return placement;
    return {
      ...placement,
      removed: choice.removed,
      ...(choice.config === undefined ? {} : { config: choice.config }),
    };
  });
}

/** Each widget that `placements` holds exactly one card of, with that card. */
function soleCardsByWidget(
  placements: readonly WidgetPlacement[]
): ReadonlyMap<string, WidgetPlacement> {
  const sole = new Map<string, WidgetPlacement>();
  const repeated = new Set<string>();
  for (const placement of placements) {
    if (sole.has(placement.widgetId)) repeated.add(placement.widgetId);
    else sole.set(placement.widgetId, placement);
  }
  for (const widgetId of repeated) sole.delete(widgetId);
  return sole;
}

/**
 * Splits an arrangement by what this reader is allowed to know exists.
 *
 * BOTH halves are returned, each in the arrangement's order, and the second is
 * the point. A placement whose widget no longer resolves, or that this caller
 * may not see, is dropped from the response -- never drawn as an empty slot,
 * which would disclose that it is there.
 *
 * 🔴 But it must not be dropped from the ROW. The admin sends back what it was
 * given, so the `invisible` half is what the writer carries back in.
 *
 * Each half resolves its repeats AGAINST ITSELF, never against the other: what
 * a caller is handed then depends only on placements that caller can see.
 *
 * `withheld` hides one CARD of a widget the caller may see: a card set to
 * something the caller may not know about, as a card set to a collection they
 * may not read is. Such a card goes to the `invisible` half, exactly as a card
 * of a widget they may not see does.
 */
export function partitionPlacements(
  placements: readonly WidgetPlacement[],
  visibleWidgetIds: ReadonlySet<string>,
  withheld: (placement: WidgetPlacement) => boolean = () => false
): { visible: WidgetPlacement[]; invisible: WidgetPlacement[] } {
  const visible: WidgetPlacement[] = [];
  const invisible: WidgetPlacement[] = [];
  for (const placement of placements) {
    if (shownTo(placement, visibleWidgetIds, withheld)) visible.push(placement);
    else invisible.push(placement);
  }
  return {
    visible: resolvePlacementIds(visible).placements,
    invisible: resolvePlacementIds(invisible).placements,
  };
}

/** Whether a caller was shown this card: its widget, and not the card withheld. */
function shownTo(
  placement: WidgetPlacement,
  visibleWidgetIds: ReadonlySet<string>,
  withheld: (placement: WidgetPlacement) => boolean
): boolean {
  return visibleWidgetIds.has(placement.widgetId) && !withheld(placement);
}

/** A fresh, opaque placement id. Used when a copy of a widget is placed. */
export function newPlacementId(): string {
  return crypto.randomUUID();
}

/**
 * The array a write stores: what this caller submitted, with the cards they
 * were never shown carried back IN PLACE.
 *
 * 🔴 In place, not appended. A card the caller cannot see keeps its position
 * relative to the cards around it: it goes back after the card it followed in
 * the stored arrangement, wherever the caller has moved that card. Cards that
 * came before every visible card stay at the start; a card whose neighbour the
 * caller no longer sent goes to the end, in stored order. Appending all of
 * them instead would push every hidden card to the bottom on each save, so a
 * reader who regains access finds their arrangement rearranged by saves they
 * made without it.
 *
 * `stored` is the whole stored arrangement (or the default the caller was
 * following), in order; `visibleWidgetIds` and `withheld` say which of its
 * cards the caller was shown, as {@link partitionPlacements} decided it.
 *
 * 🔴 A carried placement whose id collides with a submitted one is RE-KEYED,
 * never refused: refusing would answer differently depending on whether a
 * hidden card holds that id, which is an oracle for a card this caller may not
 * know about.
 *
 * Bounded at {@link MAX_STORED_PLACEMENTS} by dropping the latest-positioned
 * carried cards, never by refusing the write: a refusal would depend on how
 * much hidden data there is.
 */
export function mergePreservingHidden(
  submitted: readonly WidgetPlacement[],
  stored: readonly WidgetPlacement[],
  visibleWidgetIds: ReadonlySet<string>,
  withheld: (placement: WidgetPlacement) => boolean = () => false
): WidgetPlacement[] {
  const room = Math.max(0, MAX_STORED_PLACEMENTS - submitted.length);
  // Each carried card, with the id of the visible card it followed.
  const carried: Array<{ after: string | null; placement: WidgetPlacement }> =
    [];
  let after: string | null = null;
  for (const placement of stored) {
    if (shownTo(placement, visibleWidgetIds, withheld)) {
      after = placement.id;
    } else if (carried.length < room) {
      carried.push({ after, placement });
    }
  }

  const taken = new Set(submitted.map(placement => placement.id));
  const rekeyed = resolvePlacementIds(
    carried.map(entry => entry.placement),
    taken
  ).placements;
  const byAnchor = new Map<string | null, WidgetPlacement[]>();
  carried.forEach((entry, index) => {
    const anchor =
      entry.after === null || taken.has(entry.after) ? entry.after : undefined;
    const key = anchor === undefined ? ORPHANED : anchor;
    const group = byAnchor.get(key) ?? [];
    group.push(rekeyed[index]);
    byAnchor.set(key, group);
  });

  const merged = [...(byAnchor.get(null) ?? [])];
  for (const placement of submitted) {
    merged.push(placement, ...(byAnchor.get(placement.id) ?? []));
    // A carried card goes after its neighbour's FIRST appearance only.
    byAnchor.delete(placement.id);
  }
  return [...merged, ...(byAnchor.get(ORPHANED) ?? [])];
}

/** The group of carried cards whose neighbour the caller no longer sent. */
const ORPHANED = "\u0000orphaned";

/**
 * How many placements one layout may hold. `layout-payload.ts` says why, beside
 * the byte limit it shares a reason with; it is declared in the import-free
 * `layout-limits.ts` because the browser reads it too.
 */
export { MAX_PLACEMENTS } from "./layout-limits";

/**
 * The ceiling on the row as STORED, carried placements included: twice a full
 * arrangement, so no reader reaches it by arranging their dashboard -- only by
 * accumulating cards they lost access to, which is the case being bounded.
 */
export const MAX_STORED_PLACEMENTS = MAX_PLACEMENTS * 2;

/**
 * How deep a `config` object may nest. `JSON.parse` accepts a structure
 * thousands of levels deep and `JSON.stringify` throws on the same value, so an
 * unbounded depth turned a write into an internal error on the way back out.
 */
export const MAX_CONFIG_DEPTH = 16;

/**
 * A short, stable stand-in for "what this caller could see": which widgets,
 * and which of the shortcuts inside them.
 *
 * 🔴 The row's `version` guards the ROW, and that is only half of what shaped
 * the snapshot the client holds. A permission grant, a role change or a plugin
 * registering elsewhere changes what a caller may see without touching the
 * row, so `version` still matches while the snapshot is stale -- and a card
 * that became visible in between would be in neither the submission nor the
 * carried set, and lost. Echoing this token back makes that a conflict.
 *
 * Over the ACTION GATES the reader holds as well as the widget ids, because the
 * token also tells the admin its workspace payload is stale.
 *
 * A hash rather than the lists, because the id list names every widget the
 * caller may see. Truncated to 16 base64url characters: a change detector
 * between two reads by ONE caller, not a security boundary.
 */
export function visibilityToken(
  widgetIds: readonly string[],
  heldActionGates: Iterable<string>,
  // The collections the reader may read, where what they are handed depends
  // on them by name: a card set to a collection, or a saved card resolved to
  // one. Renaming `a_b` to `a-b` leaves every widget id as it was and changes
  // these, so a snapshot taken before is refused rather than written back.
  readableCollections: Iterable<string> = [],
  // Each Collection setting, as `id=declaration`: a plugin changing one, its
  // name or its default, moves a stored card between withheld and shown.
  collectionSettings: Iterable<string> = [],
  // The default's cards a reader following it was not handed because their
  // widgets' own rules would not show them: a verdict that changes between a
  // read and the first save moves a card between carried and dropped.
  notShown: Iterable<string> = []
): string {
  return (
    createHash("sha256")
      // Sorted, so the token depends on the SETS and not on registration order.
      // Gates and collections are prefixed so a slug can never read as an id.
      .update(
        [
          ...[...widgetIds].sort(),
          ...[...heldActionGates].sort().map(slug => `holds:${slug}`),
          ...[...readableCollections].sort().map(slug => `reads:${slug}`),
          ...[...collectionSettings].sort().map(entry => `settings:${entry}`),
          ...[...notShown].sort().map(id => `hides:${id}`),
        ].join("\n")
      )
      .digest("base64url")
      .slice(0, 16)
  );
}
