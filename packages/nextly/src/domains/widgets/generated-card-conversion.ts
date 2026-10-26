/**
 * The saved per-collection cards core once generated, as the widgets offered
 * per collection, for one reader.
 *
 * Core once generated a family of cards for each collection
 * (`collection/<slug>-<kind>`). Each kind now has a widget offered per
 * collection that answers it, set to the collection:
 *
 * | Saved card            | Becomes        |
 * | --------------------- | -------------- |
 * | count, stats (health) | Count          |
 * | recent, table         | Recent entries |
 * | timeline              | Over time      |
 * | breakdown             | Breakdown      |
 *
 * A converted card stores its collection, so it is the card a reader adds
 * from the add panel today. What else the old card showed is the successor's
 * own behaviour at the card's width: a health card's split and a table card's
 * columns from medium size, a table when drawn large, and thirty days of
 * entries per interval. The one exception is a breakdown, which also stores
 * `groupBy: "status"`: left to its default, Breakdown divides by whatever the
 * collection divides by, which can change. The defaults this relies on are
 * pinned by the module's tests, so a change to one is a decision, not drift.
 *
 * 🔴 A card converts only when the conversion is exact. Otherwise it stays as
 * stored, and the reader's next save cannot make a lossy conversion permanent:
 *
 * - Only an id core GENERATES TODAY is a retired core card. A plugin may
 *   register a generated-looking id, and while that plugin is disabled its
 *   card's id is declared by nobody; a deleted collection's card, or one whose
 *   id two collections spell, has no generated card either. None is converted.
 * - A timeline converts only while core's card counts by the date field Over
 *   time draws: on a collection without timestamps it counted by another.
 *
 * ## Why per reader, and not in the stored-row decode
 *
 * The generated id spells the slug with `_` read as `-`, so
 * `collection/a-b-count` can stand for `a_b` or `a-b`. Only the install's
 * collections can say which, and which of them THIS reader may read decides
 * what they may be told. The decode is a pure function of the stored text
 * (`readStoredLayout`), so this runs after it, on the read and the write
 * alike, and stores nothing: a save stores the converted form only as any save
 * stores what the reader holds.
 *
 * ## What a card becomes
 *
 * - One collection the reader may read matches: its successor, set to it.
 * - Several match, read while the install's collections are not yet known:
 *   its successor set to none, which draws "not available". Naming either
 *   would draw one collection's data under a card that may have been the
 *   other's.
 * - A widget is DECLARED under the id (a plugin may take a generated-looking
 *   id, and its card is then the plugin's): not converted.
 * - Only collections this reader may NOT read match: not converted. The card
 *   stays as stored, withheld from this reader as it was before, and kept by
 *   their saves; it converts the day they may read the collection. Converting
 *   it would hand them the slug of a collection they may not read.
 *
 * Cards that become the same successor for the same collection merge (the
 * first one's position, the widest width the successor allows, removed only if
 * all were), with a card of the successor the layout already holds for it
 * among them, through the one merge `applyRetirements` performs.
 *
 * @module domains/widgets/generated-card-conversion
 */

import { widthFacts, type CanonicalWidget } from "./canonical";
import { CORE_WIDGETS } from "./core-widgets";
import type {
  WidgetPlacement,
  WidgetRetirement,
  WidgetRetirements,
} from "./layout";
import type { WidgetWidth } from "./widths";

/** The widget saved count and health cards become. */
const COUNT_WIDGET_ID = "core/count";

/**
 * The widget each kind of generated card becomes, by the kind its id ends in.
 * Every successor is offered per collection and reads the collection its
 * Collection setting, `collection`, names.
 */
const SUCCESSORS = {
  count: COUNT_WIDGET_ID,
  stats: COUNT_WIDGET_ID,
  recent: "core/recent-entries",
  table: "core/recent-entries",
  timeline: "core/over-time",
  breakdown: "core/breakdown",
} as const;

type GeneratedKind = keyof typeof SUCCESSORS;

/** The date field a widget's query reads, or `undefined` when it names none. */
function dateFieldOf(widget: { query?: unknown } | undefined): unknown {
  const query = widget?.query;
  return typeof query === "object" && query !== null
    ? (query as { dateField?: unknown }).dateField
    : undefined;
}

/** The date field Over time draws, by its declaration in core. */
const OVER_TIME_DATE_FIELD = dateFieldOf(
  CORE_WIDGETS.find(widget => widget.id === SUCCESSORS.timeline)
);

/** The card core generates under an id today: only its query is read. */
export interface GeneratedCard {
  query?: unknown;
}

/**
 * Kinds whose conversion is exact only when today's generated card says so; a
 * kind absent here converts whenever core generates the id. A timeline whose
 * card counts by another date field than Over time's stays as stored.
 */
const EXACT_WHEN: Partial<
  Record<GeneratedKind, (today: GeneratedCard) => boolean>
> = {
  timeline: today => dateFieldOf(today) === OVER_TIME_DATE_FIELD,
};

/**
 * Settings a kind's successor is set to beside its collection, where the
 * successor's default would not mean what the card did. A breakdown divided by
 * status, which core generated only for a collection with a lifecycle;
 * Breakdown's own default follows whatever the collection divides by.
 */
const KEPT_SETTINGS: Partial<Record<GeneratedKind, Record<string, unknown>>> = {
  breakdown: { groupBy: "status" },
};

/**
 * A generated card's id, capturing the slug as the id spells it and the kind.
 * The kind is matched at the end, so a slug that itself ends in a kind's name
 * (`posts-count-recent`) still parses as that slug's card of the last kind.
 */
const GENERATED_CARD = new RegExp(
  `^collection/([a-z0-9-]+)-(${Object.keys(SUCCESSORS).join("|")})$`
);

/**
 * The facts of today's generated cards that a conversion's exactness reads,
 * as scope-token inputs: each card whose kind converts only when
 * `EXACT_WHEN` says so, with its query.
 *
 * 🔴 A timeline's date field can change with no widget id changing, turning a
 * card the reader was handed converted back into one stored as it was. A save
 * from that snapshot would write the lossy conversion, so it must be refused
 * as stale. A card appearing or going already moves the token by its id.
 */
export function conversionFacts(
  generated: readonly { id: string; query?: unknown }[]
): string[] {
  return generated.flatMap(card => {
    const kind = GENERATED_CARD.exec(card.id)?.[2] as GeneratedKind | undefined;
    return kind !== undefined && EXACT_WHEN[kind] !== undefined
      ? [`${card.id}=${stableJson(card.query ?? null)}`]
      : [];
  });
}

/** The widths a successor allows by its own declaration in core. */
function declaredWidths(successor: string): readonly WidgetWidth[] {
  const definition = CORE_WIDGETS.find(widget => widget.id === successor);
  return widthFacts(definition ?? { id: successor }).allowedWidths;
}

/** How the collections a generated id may stand for resolve for one reader. */
type GeneratedCardCollection =
  /** One readable collection: the card is set to it. */
  | { kind: "one"; collection: string }
  /** Several readable collections, or none left in the install: set to none. */
  | { kind: "none" }
  /** Only collections this reader may not read: not converted for them. */
  | { kind: "withheld" };

/** A collection slug as a generated id spells it. */
function asIdSlug(slug: string): string {
  return slug.replaceAll("_", "-");
}

/**
 * What the collection a generated id names resolves to, for a reader who may
 * read `readable` in an install holding `existing`. With `existing` unknown
 * (the registry not yet read), nothing reads as deleted.
 */
export function resolveGeneratedCardCollection(
  idSlug: string,
  readable: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined
): GeneratedCardCollection {
  const spells = (slug: string) => asIdSlug(slug) === idSlug;
  const mine = [...readable].filter(spells);
  const anywhere =
    existing === undefined ? undefined : [...existing].filter(spells);
  if (mine.length > 0) {
    // 🔴 Ambiguous only among the collections this reader may read. Counting
    // an unreadable one that spells the same id would set the card to none
    // where it would otherwise be set to the readable one, telling the reader
    // that a collection they may not read exists.
    const ambiguous = mine.length > 1;
    return ambiguous ? { kind: "none" } : { kind: "one", collection: mine[0] };
  }
  // Nothing this reader may read. A collection still in the install that
  // matches is one they may not read: withheld, never named.
  if (anywhere === undefined) return { kind: "withheld" };
  return anywhere.length > 0 ? { kind: "withheld" } : { kind: "none" };
}

/** Which Count card a card is: the collection it is set to. */
function countIdentity(placement: WidgetPlacement): string | undefined {
  const collection = placement.config?.collection;
  return typeof collection === "string" ? collection : undefined;
}

/** `value` as JSON with every object's keys sorted, so equal settings spell alike. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Which Recent entries, Over time or Breakdown card a card is: its whole
 * settings. These widgets allow several cards for one collection, told apart
 * by a filter, sort, range or grouping, so a converted card (its collection
 * alone) merges only into a card set to that collection with no other
 * setting. Merged into a filtered list, the reader would lose the plain one
 * they had.
 */
function settingsIdentity(placement: WidgetPlacement): string | undefined {
  return placement.config === undefined
    ? undefined
    : stableJson(placement.config);
}

/**
 * Each successor's widths as registered, from the install's canonical widgets.
 *
 * 🔴 The canonical set, not the reader's visible cards: a reader who may not
 * see Count still has hidden saved count cards, carried by their saves. Read
 * from their own visible set, those cards would convert to core's declared
 * widths rather than the registered Count's, and keep that narrower width
 * when the reader is later granted Count.
 */
export function registeredWidths(
  canonical: readonly CanonicalWidget[]
): (successor: string) => readonly WidgetWidth[] | undefined {
  return successor => {
    const widget = canonical.find(entry => entry.id === successor);
    return widget === undefined ? undefined : widthFacts(widget).allowedWidths;
  };
}

/**
 * The saved generated cards' conversion for one reader, as retirements
 * `applyRetirements` takes: `readable` is the collections this reader may
 * read, `existing` every collection the install holds
 * (`registeredCollectionSlugs`, which counts one without a source as held),
 * `declared` the ids a declared widget answers to, whose cards stay its, and
 * `widthsOf` the widths each successor allows AS REGISTERED (a plugin may
 * extend or override one), falling back to its declaration in core, and
 * `generated` the card core generates under an id today, which decides
 * whether a card is a retired core card at all, and whether a timeline's
 * conversion is exact (`EXACT_WHEN`).
 */
export function generatedCardConversion(
  readable: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined,
  declared: ReadonlySet<string> = new Set(),
  widthsOf: (successor: string) => readonly WidgetWidth[] | undefined = () =>
    undefined,
  generated: (widgetId: string) => GeneratedCard | undefined = () => undefined
): WidgetRetirements {
  // One retirement per successor, carrying the identity a card of it ALREADY
  // in the layout merges by, so a converted card joins it.
  const into = new Map<string, WidgetRetirement>(
    [...new Set(Object.values(SUCCESSORS))].map(successor => [
      successor,
      {
        successor,
        identity:
          successor === COUNT_WIDGET_ID ? countIdentity : settingsIdentity,
        allowedWidths: widthsOf(successor) ?? declaredWidths(successor),
      },
    ])
  );
  return {
    get: widgetId => {
      if (declared.has(widgetId)) return undefined;
      const parsed = GENERATED_CARD.exec(widgetId);
      if (parsed === null) return undefined;
      const [, idSlug, matched] = parsed;
      const kind = matched as GeneratedKind;
      const retirement = into.get(SUCCESSORS[kind]);
      if (retirement === undefined) return undefined;
      // Only a card core generates under this id today is a retired core
      // card, and only an exact conversion is made; anything else stays as
      // stored (the module note).
      const today = generated(widgetId);
      if (today === undefined) return undefined;
      const exact = EXACT_WHEN[kind];
      if (exact !== undefined && !exact(today)) return undefined;
      const resolved = resolveGeneratedCardCollection(
        idSlug,
        readable,
        existing
      );
      if (resolved.kind === "withheld") return undefined;
      if (resolved.kind === "one") {
        return {
          ...retirement,
          settings: () => ({
            collection: resolved.collection,
            ...KEPT_SETTINGS[kind],
          }),
        };
      }
      // Set to none, and merged only with the cards of the same id slug and
      // successor, so two unresolved collections never become one card.
      return {
        ...retirement,
        settings: () => undefined,
        identity: () => `\u0000unresolved:${idSlug}`,
      };
    },
    values: () => into.values(),
  };
}
