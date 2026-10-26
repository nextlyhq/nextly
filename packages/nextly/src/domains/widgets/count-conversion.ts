/**
 * The saved per-collection count and health cards, as Count cards, for one
 * reader.
 *
 * Core once generated a count card and a health card for each collection
 * (`collection/<slug>-count`, `collection/<slug>-stats`). Count
 * (`core/count`, set to a collection) answers both, so a saved card of either
 * becomes a Count card set to its collection.
 *
 * ## Why per reader, and not in the stored-row decode
 *
 * The generated id spells the slug with `_` read as `-`, so `collection/a-b-count`
 * can stand for `a_b` or `a-b`. Only the install's collections can say which,
 * and which of them THIS reader may read decides what they may be told. The
 * decode is a pure function of the stored text (`readStoredLayout`), so this
 * runs after it, on the read and the write alike, and stores nothing: a save
 * stores the converted form only as any save stores what the reader holds.
 *
 * ## What a card becomes
 *
 * - One collection the reader may read matches: a Count card set to it.
 * - Several match: a Count card set to none, which draws "not available".
 *   Naming either would draw one collection's number under a card that may
 *   have been the other's.
 * - None in the install matches (the collection was deleted): a Count card
 *   set to none, so the card is kept, drawn as not available.
 * - A widget is DECLARED under the id (a plugin may take a generated-looking
 *   id, and its card is then the plugin's): not converted.
 * - Only collections this reader may NOT read match: not converted. The card
 *   stays as stored, withheld from this reader as it was before, and kept by
 *   their saves; it converts the day they may read the collection. Converting
 *   it would hand them the slug of a collection they may not read.
 *
 * Cards that become Count cards for the same collection merge (the first one's
 * position, the widest width Count allows, removed only if all were), with a
 * Count card the layout already holds for it among them, through the one merge
 * `applyRetirements` performs.
 *
 * @module domains/widgets/count-conversion
 */

import { CORE_WIDGETS } from "./core-widgets";
import type {
  WidgetPlacement,
  WidgetRetirement,
  WidgetRetirements,
} from "./layout";
import { allowedWidths, type WidgetWidth } from "./widths";

/** The widget saved count and health cards become. */
export const COUNT_WIDGET_ID = "core/count";

/** A generated count or health card's id, capturing the slug as the id spells it. */
const GENERATED_COUNT_CARD = /^collection\/([a-z0-9-]+)-(?:count|stats)$/;

/**
 * The widths Count allows by its own declaration, for a caller with no
 * registered Count to read them from: the merged card's width is chosen by the
 * rule the dashboard draws Count with.
 */
const COUNT_ALLOWED_WIDTHS = (() => {
  const count = CORE_WIDGETS.find(widget => widget.id === COUNT_WIDGET_ID);
  return allowedWidths(count?.minSize, count?.maxSize);
})();

/** How the collections a generated id may stand for resolve for one reader. */
type CountCardCollection =
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
export function resolveCountCardCollection(
  idSlug: string,
  readable: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined
): CountCardCollection {
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

/**
 * The saved count and health cards' conversion for one reader, as retirements
 * `applyRetirements` takes: `readable` is the collections this reader may
 * read, `existing` every collection the install holds
 * (`registeredCollectionSlugs`, which counts one without a source as held),
 * `declared` the ids a declared widget answers to, whose cards stay its, and
 * `countWidths` the widths the REGISTERED Count allows (a plugin may extend
 * or override it), defaulting to its own declaration's.
 */
export function countCardConversion(
  readable: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined,
  declared: ReadonlySet<string> = new Set(),
  countWidths: readonly WidgetWidth[] = COUNT_ALLOWED_WIDTHS
): WidgetRetirements {
  // The identity a Count card ALREADY in the layout merges by, so a converted
  // card joins the Count card set to the same collection.
  const asCount: WidgetRetirement = {
    successor: COUNT_WIDGET_ID,
    identity: countIdentity,
    allowedWidths: countWidths,
  };
  return {
    get: widgetId => {
      if (declared.has(widgetId)) return undefined;
      const idSlug = GENERATED_COUNT_CARD.exec(widgetId)?.[1];
      if (idSlug === undefined) return undefined;
      const resolved = resolveCountCardCollection(idSlug, readable, existing);
      if (resolved.kind === "withheld") return undefined;
      if (resolved.kind === "one") {
        return {
          ...asCount,
          settings: () => ({ collection: resolved.collection }),
        };
      }
      // Set to none, and merged only with the cards of the same id slug, so
      // two unresolved collections never become one card.
      return {
        ...asCount,
        settings: () => undefined,
        identity: () => `\u0000unresolved:${idSlug}`,
      };
    },
    values: () => [asCount],
  };
}
