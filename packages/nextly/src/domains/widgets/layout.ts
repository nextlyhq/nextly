/**
 * A reader's own arrangement of the dashboard: what it stores, and what it
 * refuses to store.
 *
 * ## One ordered list of cards, each at a width
 *
 * A stored arrangement is a list of placements whose ARRAY ORDER is the order
 * the cards are drawn in, each at one of five widths (`widths.ts`). There is no
 * column and no page-wide column count: cards fill rows left to right and wrap.
 *
 * Arrangements saved in the two earlier formats are CONVERTED when read and
 * never written back by the read: the flat first format, and the columns
 * format after it. A converted row is stored in the current format at its
 * owner's next save, and until then the row stays exactly as it was. A read
 * that wrote would race the version guard and a second tab, turning reads into
 * conflicts.
 *
 * ## The stored layout is a THIRD reader of the widget contract
 *
 * The registry and the plugin channel are the other two. This one holds data
 * THIS core wrote, about widgets it did not, which is why its validation is
 * SHAPE ONLY. Whether a `widgetId` names a widget that exists, or a width is
 * one the widget allows, are questions about the live registry, asked on every
 * read rather than frozen here. The width itself is core's own vocabulary, so
 * it is the one field checked against a closed list.
 *
 * ## What a placement deliberately does NOT hold
 *
 * 🔴 No `requiredPermission`, and no other copy of anything the definition
 * owns. A placement stores an identity, a width and its settings. Every
 * question about whether this reader may SEE the widget is asked of the live
 * registry on every read, so a permission tightened after a layout was saved
 * takes effect at once.
 *
 * ## Why a placement id is not a widget id
 *
 * A placement is one card with its own identity, so one widget can appear
 * twice with different `config`. The DEFAULT set names each placement after its
 * widget, because that is the one arrangement where the two are one-to-one and
 * a stable id keeps repeated reads identical; a card added later gets a
 * generated id.
 *
 * @module domains/widgets/layout
 */

import { createHash } from "node:crypto";

import { NextlyError } from "../../errors/nextly-error";

import { MAX_PLACEMENTS } from "./layout-limits";
import { LAYOUT_SCHEMA_VERSION } from "./layout-payload";
import {
  WIDGET_WIDTHS as WIDGET_WIDTH_ORDER,
  isWidgetWidth,
  widthFromSize,
  type WidgetWidth,
} from "./widths";

// The payload's version, writer and size check live in the import-free
// `layout-payload.ts`, so the browser asks the endpoint's own question about
// what fits. Re-exported, so this module's importers are unchanged.
export {
  LAYOUT_SCHEMA_VERSION,
  MAX_LAYOUT_BYTES,
  layoutSizeProblem,
  serializeLayout,
} from "./layout-payload";

/**
 * How many columns the flat first format was dealt across when it was read as
 * columns. A fact of that conversion, kept as its own constant so it cannot
 * move with anything the dashboard does today.
 */
const FIRST_FORMAT_COLUMNS = 3;

/** One card, at one position in the list, for one reader. */
export interface WidgetPlacement {
  /** Opaque and unique WITHIN a layout. Not a widget id, except by default. */
  id: string;
  /** Which registry entry this draws. Resolved live on every read. */
  widgetId: string;
  /**
   * How wide the card is. KEPT as stored even when the widget no longer
   * allows it: the admin draws the nearest width it does allow, and the stored
   * choice comes back if the widget allows it again.
   */
  width: WidgetWidth;
  /**
   * Removed cards are RETURNED and kept, settings and width included, so a
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

/**
 * What placing a widget in the DEFAULT arrangement reads from its declaration.
 *
 * Three fields, and deliberately not `WidgetDefinition`: a widget reaches the
 * dashboard by channels whose shapes differ, and the default needs none of the
 * fields they disagree about.
 */
export interface PlaceableWidget {
  id: string;
  defaultOrder?: number;
  /** The width a new card starts at. A widget that says nothing is full. */
  defaultWidth?: WidgetWidth;
}

/**
 * What a retired widget's cards become.
 *
 * 🔴 ONE map of these, applied on EVERY read whatever the row's format, the
 * current one included. So a widget can be retired after rows were already
 * saved in the current format and still reach them, and a row with nothing to
 * map comes back unchanged.
 */
export interface WidgetRetirement {
  /** The widget a retired card becomes. */
  successor: string;
  /**
   * WHICH card of the successor a card becomes, read off the card in its
   * successor form: for a successor that shows one collection, that
   * collection. Two cards merge only when they become the same successor with
   * the same identity, so Posts count and Products health stay two cards.
   * Absent, a successor has one identity, and its cards all merge.
   */
  identity?: (placement: WidgetPlacement) => string | undefined;
  /**
   * The successor's settings, from the retired card's. Absent, the retired
   * card's settings are carried as they are.
   */
  settings?: (
    placement: WidgetPlacement
  ) => Record<string, unknown> | undefined;
  /**
   * The widths the successor allows, used to pick a merged card's width: the
   * largest of the merged cards' widths that the successor allows. Declared
   * here rather than read from the live registry, so the conversion stays a
   * function of the stored text and this map. Absent, every width.
   */
  allowedWidths?: readonly WidgetWidth[];
}

/** Retired widget ids, each with what its cards become. */
export type WidgetRetirements = ReadonlyMap<string, WidgetRetirement>;

/** The widgets this release has retired. None yet. */
export const RETIRED_WIDGETS: WidgetRetirements = new Map();

function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `undefined`, or a string with real text in it. */
function optionalTextProblem(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string"
    ? undefined
    : `"${field}", when given, must be a string`;
}

type PlacementRule = (placement: Record<string, unknown>) => string | undefined;

/** The rules every placement's identity and settings satisfy, in any format. */
const COMMON_RULES: readonly PlacementRule[] = [
  p => (isUsableText(p.id) ? undefined : 'a placement needs a non-empty "id"'),
  p =>
    isUsableText(p.widgetId)
      ? undefined
      : 'a placement needs a non-empty "widgetId"',
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
 * The rules a placement of the CURRENT format satisfies, as a LIST rather than
 * a ladder (one function per field, so no single function trips the
 * complexity gate, and each answers in words the sender of a refused PUT can
 * act on).
 *
 * A body in an earlier format fails here: it has no `width` and no `removed`.
 * That is the refusal of an earlier format the endpoint promises, reached by
 * the same rules a stored row is read with, so the two cannot disagree.
 */
const PLACEMENT_RULES: readonly PlacementRule[] = [
  ...COMMON_RULES,
  p =>
    isWidgetWidth(p.width)
      ? undefined
      : '"width" must be one of quarter, third, half, twoThirds or full',
  p =>
    typeof p.removed === "boolean" ? undefined : '"removed" must be a boolean',
];

/**
 * The rules a placement of the COLUMNS format satisfied (and the flat format
 * before it, which had the same fields less `column`). Kept only to read those
 * rows: nothing writes them any more.
 *
 * `size` and `height` are checked as STRINGS, never against a vocabulary: a
 * size was seeded from a widget's declaration, which may have come from a
 * plugin built against a newer core, and a closed check would have taken the
 * reader's whole saved dashboard down over one card.
 */
const COLUMNS_FORMAT_RULES: readonly PlacementRule[] = [
  ...COMMON_RULES,
  // `Number.isFinite`, not `typeof === "number"`: NaN and both infinities are
  // numbers JSON cannot carry.
  p =>
    Number.isFinite(p.order) ? undefined : '"order" must be a finite number',
  p =>
    typeof p.hidden === "boolean" ? undefined : '"hidden" must be a boolean',
  p =>
    p.column === undefined || Number.isFinite(p.column)
      ? undefined
      : '"column", when given, must be a finite number',
  p => optionalTextProblem(p.size, "size"),
  p => optionalTextProblem(p.height, "height"),
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
    width: value.width as WidgetWidth,
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
  return readWith(value, PLACEMENT_RULES).map(toPlacement);
}

function readWith(
  value: unknown,
  rules: readonly PlacementRule[]
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw NextlyError.invalidInput({
      message: 'Invalid dashboard layout: "placements" must be an array.',
    });
  }
  return value.map((entry, index) => {
    const problem = firstProblem(entry, rules);
    if (problem !== undefined) {
      throw NextlyError.invalidInput({
        message: `Invalid dashboard layout: placements[${index}] ${problem}.`,
      });
    }
    return entry as Record<string, unknown>;
  });
}

/** A placement of the columns format, as that format stored it. */
interface ColumnsFormatPlacement {
  id: string;
  widgetId: string;
  column: number;
  order: number;
  hidden: boolean;
  size?: string;
  config?: Record<string, unknown>;
}

function toColumnsFormatPlacement(
  value: Record<string, unknown>
): ColumnsFormatPlacement {
  return {
    id: value.id as string,
    widgetId: value.widgetId as string,
    // Absent was read as the first column by the format itself.
    column:
      typeof value.column === "number"
        ? Math.max(0, Math.trunc(value.column))
        : 0,
    order: value.order as number,
    hidden: value.hidden as boolean,
    ...(value.size === undefined ? {} : { size: value.size as string }),
    ...(value.config === undefined
      ? {}
      : { config: value.config as Record<string, unknown> }),
  };
}

/**
 * A flat first-format row, read as the columns format read it.
 *
 * Kept step for step, so the conversion that follows sees exactly what every
 * earlier release saw: sorted by `order`, dealt round-robin across three
 * columns, each placement's own `order` kept.
 */
function firstFormatAsColumns(value: unknown): ColumnsFormatPlacement[] {
  return readWith(value, COLUMNS_FORMAT_RULES)
    .map(toColumnsFormatPlacement)
    .sort((a, b) => a.order - b.order)
    .map((placement, index) => ({
      ...placement,
      column: index % FIRST_FORMAT_COLUMNS,
    }));
}

/**
 * A columns-format arrangement, as one ordered list.
 *
 * 🔴 ROW-MAJOR: by `order`, then by `column` -- across the tops of the
 * columns, then the next row down. That is the order positions were announced
 * in, and it keeps the top card of every column near the top. Stable, so equal
 * positions keep their stored order.
 *
 * Each card keeps its id, its settings and its removed state (`hidden`), and
 * its stored size becomes its width. A missing or unknown size becomes full,
 * which is how the admin drew it; the widget's CURRENT default is never
 * consulted, so the same row converts the same way in every release. `column`,
 * `order` and `height` go: the array order replaces the first two, and height
 * follows content.
 */
function columnsToList(
  placements: readonly ColumnsFormatPlacement[]
): WidgetPlacement[] {
  return [...placements]
    .sort((a, b) => a.order - b.order || a.column - b.column)
    .map(placement => ({
      id: placement.id,
      widgetId: placement.widgetId,
      width: widthFromSize(placement.size),
      removed: placement.hidden,
      ...(placement.config === undefined ? {} : { config: placement.config }),
    }));
}

/** One card on its way through the retirement map. */
interface RetiringCard {
  placement: WidgetPlacement;
  /** The merge group it belongs to, when it is or becomes a successor card. */
  key?: string;
  /** Whether it was retired, rather than already a successor card. */
  retired: boolean;
  /** The successor's allowed widths, for a retired card. */
  allowedWidths?: readonly WidgetWidth[];
}

/** A card's merge key: its successor and which card of it. */
function mergeKey(
  successor: string,
  identity: WidgetRetirement["identity"],
  placement: WidgetPlacement
): string {
  return `${successor}\u0000${identity?.(placement) ?? ""}`;
}

/** A card in the form one retirement turns it into. */
function retired(
  placement: WidgetPlacement,
  retirement: WidgetRetirement
): WidgetPlacement {
  const config = retirement.settings
    ? retirement.settings(placement)
    : placement.config;
  const { config: _replaced, ...rest } = placement;
  return {
    ...rest,
    widgetId: retirement.successor,
    ...(config === undefined ? {} : { config }),
  };
}

/**
 * The retirements a widget goes through, in order, to reach one that is not
 * retired: more than one when its successor was itself retired later. Stops at
 * a widget it has already passed, so a map that loops cannot loop the read.
 */
function retirementChain(
  widgetId: string,
  retirements: WidgetRetirements
): WidgetRetirement[] {
  const chain: WidgetRetirement[] = [];
  const passed = new Set<string>([widgetId]);
  let next = retirements.get(widgetId);
  while (next !== undefined) {
    chain.push(next);
    if (passed.has(next.successor)) break;
    passed.add(next.successor);
    next = retirements.get(next.successor);
  }
  return chain;
}

/** Each card, retired cards in their successor form, with its merge group. */
function retiringCards(
  placements: readonly WidgetPlacement[],
  retirements: WidgetRetirements
): RetiringCard[] {
  // How each successor tells its cards apart, so a card ALREADY of that
  // widget joins the same groups as the cards retired into it.
  const identityOf = new Map<string, WidgetRetirement["identity"]>();
  for (const retirement of retirements.values()) {
    identityOf.set(retirement.successor, retirement.identity);
  }
  return placements.map(placement => {
    const chain = retirementChain(placement.widgetId, retirements);
    if (chain.length > 0) {
      // Each step in turn, so a widget retired again since reaches the widget
      // that exists now, with every step's settings mapping applied.
      const converted = chain.reduce(retired, placement);
      const last = chain[chain.length - 1];
      return {
        placement: converted,
        key: mergeKey(last.successor, last.identity, converted),
        retired: true,
        ...(last.allowedWidths ? { allowedWidths: last.allowedWidths } : {}),
      };
    }
    if (identityOf.has(placement.widgetId)) {
      return {
        placement,
        key: mergeKey(
          placement.widgetId,
          identityOf.get(placement.widgetId),
          placement
        ),
        retired: false,
      };
    }
    return { placement, retired: false };
  });
}

/**
 * The widest of `widths` that `allowed` holds, or the widest of all.
 *
 * Choosing only among the CARRIED widths, never inventing one: when the
 * successor allows none of them, the merged card keeps the reader's widest
 * choice, the way {@link WidgetPlacement.width} keeps any width its widget
 * stops allowing. The admin draws it at the nearest allowed width, and the
 * choice returns if the successor allows it again.
 */
function widestAllowed(
  widths: readonly WidgetWidth[],
  allowed: readonly WidgetWidth[] | undefined
): WidgetWidth {
  const rank = (width: WidgetWidth) => WIDGET_WIDTH_ORDER.indexOf(width);
  const candidates = allowed
    ? widths.filter(width => allowed.includes(width))
    : widths;
  const pool = candidates.length > 0 ? candidates : widths;
  return pool.reduce((best, width) =>
    rank(width) > rank(best) ? width : best
  );
}

/**
 * The one card a merge group leaves, or `undefined` for a group of one.
 *
 * A successor card the layout already held keeps its id, position, width and
 * settings, and the retired cards merge into it. Otherwise the first card in
 * the order keeps its id, position and settings, and takes the largest of the
 * group's widths that the successor allows. Either way the card is removed only
 * if every card in the group was.
 */
function mergedCard(group: readonly RetiringCard[]): RetiringCard {
  const kept = group.find(card => !card.retired) ?? group[0];
  // Over the cards IN the merge: the kept one and the retired ones. Another
  // successor card the layout already held stays as it was, so its state is
  // no part of this card's.
  const removed = group
    .filter(card => card === kept || card.retired)
    .every(card => card.placement.removed);
  if (!kept.retired) {
    return { ...kept, placement: { ...kept.placement, removed } };
  }
  const width = widestAllowed(
    group.map(card => card.placement.width),
    kept.allowedWidths
  );
  return { ...kept, placement: { ...kept.placement, width, removed } };
}

/**
 * Replaces every retired widget with its successor, merging the cards that
 * become the same card.
 *
 * Each retired card keeps its id, position, width, removed state and
 * settings, under its successor (settings through the retirement's own
 * mapping, where it has one). Cards merge only when they become the same
 * successor with the same identity -- for a successor showing one collection,
 * the same collection -- and a successor card the layout already held takes
 * part in that merge as the card that is kept. That is the one way a
 * conversion makes fewer cards than it read; every field has one winner, so
 * any two implementations agree. Every other card is left where it is.
 *
 * Returns the same array when nothing is retired, so a row in the current
 * format with nothing to map comes back exactly as it was.
 */
export function applyRetirements(
  placements: WidgetPlacement[],
  retirements: WidgetRetirements
): WidgetPlacement[] {
  if (!placements.some(placement => retirements.has(placement.widgetId))) {
    return placements;
  }
  const cards = retiringCards(placements, retirements);
  const groups = new Map<string, RetiringCard[]>();
  for (const card of cards) {
    if (card.key === undefined) continue;
    const group = groups.get(card.key) ?? [];
    group.push(card);
    groups.set(card.key, group);
  }
  // A group's kept card stands in its own place; the rest of the group goes.
  const keptBy = new Map<RetiringCard, RetiringCard>();
  for (const group of groups.values()) {
    if (!group.some(card => card.retired)) continue;
    const kept = group.find(card => !card.retired) ?? group[0];
    keptBy.set(kept, mergedCard(group));
  }
  return cards.flatMap(card => {
    if (card.key === undefined) return [card.placement];
    const group = groups.get(card.key) ?? [];
    if (!group.some(member => member.retired)) return [card.placement];
    const merged = keptBy.get(card);
    if (merged) return [merged.placement];
    // Only RETIRED cards go into a merge. A successor card the layout already
    // held, other than the one that takes the merge, stays as it was.
    return card.retired ? [] : [card.placement];
  });
}

/**
 * Decodes one stored `layout` column, converting an earlier format.
 *
 * THROWS on anything it cannot read, rather than quietly resetting to the
 * default. A saved arrangement vanishing with no signal is the worse failure:
 * the caller decides what to do with the throw. The service logs it, the
 * dashboard draws the default, the person is told, and the row is left
 * untouched until they choose to replace it.
 *
 * The conversion is a pure function of the stored text and the retirement
 * map, so reading one row twice gives identical cards and ids.
 */
export function readStoredLayout(
  raw: string,
  retirements: WidgetRetirements = RETIRED_WIDGETS
): StoredLayout {
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

  // The ONE version check, legitimate because this core wrote the value. A
  // version above ours came from a NEWER core and holds fields we would drop
  // on the next write; one we never had is not a shape to guess at.
  const placements = placementsOfVersion(decoded);
  const converted = applyRetirements(placements, retirements);

  // 🔴 REPORTS a repeat rather than resolving one. Resolving across the whole
  // row would let a card this caller may not know exists claim an id and push a
  // card they CAN see onto a different one, so the id they are handed would
  // depend on a card that was filtered so they could not learn of it.
  const { rekeyed } = resolvePlacementIds(converted);
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    placements: converted,
    // `=== true` rather than truthiness: anything else this core did not
    // write is the ordinary, arranged row. The flat first format predates the
    // field, and every row of it was arranged.
    ...(decoded.unarranged === true && decoded.schemaVersion !== 1
      ? { unarranged: true as const }
      : {}),
    ...(rekeyed.length === 0 ? {} : { duplicatePlacementIds: rekeyed }),
  };
}

/** The placements of a decoded row, in the current format, by its version. */
function placementsOfVersion(
  decoded: Record<string, unknown>
): WidgetPlacement[] {
  switch (decoded.schemaVersion) {
    case 1:
      return columnsToList(firstFormatAsColumns(decoded.placements));
    case 2:
      return columnsToList(
        readWith(decoded.placements, COLUMNS_FORMAT_RULES).map(
          toColumnsFormatPlacement
        )
      );
    case LAYOUT_SCHEMA_VERSION:
      return readPlacements(decoded.placements);
    default:
      throw NextlyError.internal({
        logContext: {
          reason: "stored dashboard layout names an unknown schema version",
          found: String(decoded.schemaVersion),
          expected: LAYOUT_SCHEMA_VERSION,
        },
      });
  }
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
 * the default plus removed flags, so following the default cannot bring back a
 * card the reader deliberately took away.
 */
export function layoutIsArranged(stored: StoredLayout): boolean {
  return stored.unarranged !== true;
}

/**
 * The default arrangement with a reader's removals applied.
 *
 * For a row that still follows the default: positions, widths and the set of
 * cards all come from `defaults`, and the stored row contributes only which
 * widgets its reader removed.
 *
 * Keyed by WIDGET, across the whole stored row and whatever its visibility, so
 * a removal of a card the reader has since lost access to is still honoured
 * the day access returns. `undefined` is a reader with no row.
 */
export function dismissalsApplied(
  defaults: readonly WidgetPlacement[],
  stored: StoredLayout | undefined
): WidgetPlacement[] {
  const dismissed = new Set(
    (stored?.placements ?? [])
      .filter(placement => placement.removed)
      .map(placement => placement.widgetId)
  );
  return defaults.map(placement =>
    dismissed.has(placement.widgetId)
      ? { ...placement, removed: true }
      : placement
  );
}

/**
 * The declared order: a widget with no `defaultOrder` sits after every widget
 * that states one.
 *
 * 🔴 Equal orders compare EQUAL, so the declaration order then stands (the
 * sort is stable). Any tie-break here would rearrange every default dashboard
 * holding widgets that state no order.
 */
function byDeclaredOrder(a: PlaceableWidget, b: PlaceableWidget): number {
  const aOrder = a.defaultOrder ?? Number.POSITIVE_INFINITY;
  const bOrder = b.defaultOrder ?? Number.POSITIVE_INFINITY;
  if (aOrder === bOrder) return 0;
  return aOrder < bOrder ? -1 : 1;
}

/**
 * The one default dashboard: what a reader who has never arranged anything
 * sees. Computed on every read and never stored, so a later change to it
 * reaches everyone still following it.
 *
 * The placement id is the widget id here, and only here, so repeated reads of
 * an unsaved dashboard return identical ids.
 *
 * 🔴 NOT capped here. The submission limit belongs to what a CALLER may send,
 * and this materialization is caller-independent; capping it let widgets a
 * caller cannot see consume the allowance. The cap is applied to the visible
 * partition instead.
 */
export function defaultPlacements(
  widgets: readonly PlaceableWidget[]
): WidgetPlacement[] {
  return [...widgets].sort(byDeclaredOrder).map(widget => ({
    id: widget.id,
    widgetId: widget.id,
    // The width travels WITH the placement: the first save stores it, so a
    // later change to the widget's default does not resize a saved card.
    width: widget.defaultWidth ?? "full",
    removed: false,
  }));
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
 */
export function partitionPlacements(
  placements: readonly WidgetPlacement[],
  visibleWidgetIds: ReadonlySet<string>
): { visible: WidgetPlacement[]; invisible: WidgetPlacement[] } {
  const visible: WidgetPlacement[] = [];
  const invisible: WidgetPlacement[] = [];
  for (const placement of placements) {
    if (visibleWidgetIds.has(placement.widgetId)) visible.push(placement);
    else invisible.push(placement);
  }
  return {
    visible: resolvePlacementIds(visible).placements,
    invisible: resolvePlacementIds(invisible).placements,
  };
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
 * following), in order; `visibleWidgetIds` says which of its cards the caller
 * was shown.
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
  visibleWidgetIds: ReadonlySet<string>
): WidgetPlacement[] {
  const room = Math.max(0, MAX_STORED_PLACEMENTS - submitted.length);
  // Each carried card, with the id of the visible card it followed.
  const carried: Array<{ after: string | null; placement: WidgetPlacement }> =
    [];
  let after: string | null = null;
  for (const placement of stored) {
    if (visibleWidgetIds.has(placement.widgetId)) {
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
  heldActionGates: Iterable<string>
): string {
  return (
    createHash("sha256")
      // Sorted, so the token depends on the SETS and not on registration order.
      // The gates are prefixed so a slug can never read as an id.
      .update(
        [
          ...[...widgetIds].sort(),
          ...[...heldActionGates].sort().map(slug => `holds:${slug}`),
        ].join("\n")
      )
      .digest("base64url")
      .slice(0, 16)
  );
}
