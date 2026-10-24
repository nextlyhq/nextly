/**
 * Cards set to a collection, and which of them one reader may be shown.
 *
 * A widget offered per collection (Count) is one widget every reader may see,
 * and each CARD of it reads the collection its Collection setting names. A card
 * set to a collection this reader may not read names that collection in its
 * settings, so handing it over would tell the reader of a collection they may
 * not know about; and its reads are refused anyway. Such a card is withheld,
 * exactly as a card of a widget they may not see is: left out of what they are
 * handed, and carried in place by their saves, so it returns the day they may
 * read the collection. A save may not ADD one: the layout write refuses a
 * submitted card set to a collection the reader may not read.
 *
 * 🔴 "May not read" covers a collection that does not exist as well. Telling
 * the two apart -- withholding one, drawing the other as not available -- would
 * let a reader learn whether a collection exists by saving a card set to a
 * guessed name and reading the layout back. Both are withheld, and both are
 * refused on a write, the same way.
 *
 * The collection a card reads is its EFFECTIVE Collection setting, read through
 * `resolveWidgetSettings`: a card with no stored value reads the setting's
 * declared default, and is judged by it.
 *
 * @module domains/widgets/collection-cards
 */

import type { WidgetPlacement } from "./layout";
import { resolveWidgetSettings, type AnyWidgetSetting } from "./settings";

/** A widget with a Collection setting: its settings, and that setting's name. */
interface CollectionWidget {
  settings: readonly AnyWidgetSetting[];
  name: string;
}

/**
 * Each widget's Collection setting, by widget id: a widget declares at most
 * one (`settings.ts` refuses a second).
 */
export function collectionWidgets(
  widgets: readonly { id: string; settings?: readonly AnyWidgetSetting[] }[]
): ReadonlyMap<string, CollectionWidget> {
  const found = new Map<string, CollectionWidget>();
  for (const widget of widgets) {
    const setting = widget.settings?.find(
      candidate => candidate.type === "collection"
    );
    if (widget.settings !== undefined && setting !== undefined) {
      found.set(widget.id, { settings: widget.settings, name: setting.name });
    }
  }
  return found;
}

/**
 * Whether a card is set to a collection this reader may not read (whether or
 * not it exists), for a reader who may read `readable`.
 */
export function unreadableCollectionCard(
  widgets: ReadonlyMap<string, CollectionWidget>,
  readable: ReadonlySet<string>
): (placement: WidgetPlacement) => boolean {
  return placement => {
    const widget = widgets.get(placement.widgetId);
    if (widget === undefined) return false;
    const collection = resolveWidgetSettings(widget.settings, placement.config)[
      widget.name
    ];
    return typeof collection === "string" && !readable.has(collection);
  };
}
