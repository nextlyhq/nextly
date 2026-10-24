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
 * read the collection.
 *
 * A card set to a collection that no longer exists is not withheld: there is
 * nothing to disclose, and it draws "not available", as R-16 asks of a card
 * whose collection is gone.
 *
 * @module domains/widgets/collection-cards
 */

import type { WidgetPlacement } from "./layout";

/**
 * The name of each widget's Collection setting, by widget id: a widget declares
 * at most one (`settings.ts` refuses a second).
 */
export function collectionSettingNames(
  widgets: readonly { id: string; settings?: readonly unknown[] }[]
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const widget of widgets) {
    const setting = widget.settings?.find(
      (candidate): candidate is { name: string } =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { type?: unknown }).type === "collection" &&
        typeof (candidate as { name?: unknown }).name === "string"
    );
    if (setting !== undefined) names.set(widget.id, setting.name);
  }
  return names;
}

/**
 * Whether a card is set to a collection this reader may not read, for a reader
 * who may read `readable` in an install holding `existing`. With `existing`
 * unknown (the registry not yet read), any collection outside `readable` is
 * withheld: a card is never handed over on the strength of an unanswered read.
 */
export function unreadableCollectionCard(
  settingNames: ReadonlyMap<string, string>,
  readable: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined
): (placement: WidgetPlacement) => boolean {
  return placement => {
    const name = settingNames.get(placement.widgetId);
    if (name === undefined) return false;
    const collection = placement.config?.[name];
    if (typeof collection !== "string" || readable.has(collection)) {
      return false;
    }
    return existing === undefined || existing.has(collection);
  };
}
