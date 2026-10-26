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
 * declared default, and is judged by it. Only a value shaped like a slug names
 * a collection (`namedCollection`, the rule the card's query reads it by), so
 * a special default such as "*" names none and withholds nothing. The setting
 * comes from the canonical summary (`collectionSetting`), merged from both
 * channels as the admin merges them, so a widget a plugin contributes is
 * judged like a registered one.
 *
 * @module domains/widgets/collection-cards
 */

import type { WidgetPlacement } from "./layout";
import {
  namedCollection,
  resolveWidgetSettings,
  type AnyWidgetSetting,
} from "./settings";

/**
 * Each widget's Collection setting, by widget id: a widget declares at most
 * one (`settings.ts` refuses a second).
 */
export function collectionWidgets(
  widgets: readonly { id: string; collectionSetting?: AnyWidgetSetting }[]
): ReadonlyMap<string, AnyWidgetSetting> {
  const found = new Map<string, AnyWidgetSetting>();
  for (const widget of widgets) {
    if (widget.collectionSetting !== undefined) {
      found.set(widget.id, widget.collectionSetting);
    }
  }
  return found;
}

/**
 * Whether a card is set to a collection this reader may not read (whether or
 * not it exists), for a reader who may read `readable`.
 */
export function unreadableCollectionCard(
  widgets: ReadonlyMap<string, AnyWidgetSetting>,
  readable: ReadonlySet<string>
): (placement: WidgetPlacement) => boolean {
  return placement => {
    const setting = widgets.get(placement.widgetId);
    if (setting === undefined) return false;
    // Resolved alone: a Collection setting depends on no other setting, so
    // its effective value is the same as over the widget's whole list.
    const collection = resolveWidgetSettings([setting], placement.config)[
      setting.name
    ];
    const named = namedCollection(collection);
    return named !== undefined && !readable.has(named);
  };
}

/**
 * Each widget's Collection setting, whole, as scope-token inputs.
 *
 * Whole because every property of it can decide which collection a stored
 * card resolves to -- its name says which stored key it reads, its default
 * what an absent key reads -- so a plugin changing any of them can move a card
 * between withheld and shown with no widget id, gate or readable collection
 * changing, and a snapshot taken before must be refused. Hashing the whole
 * declaration needs no list of the properties that matter to stay current.
 */
export function collectionSettingsToken(
  widgets: readonly { id: string; collectionSetting?: AnyWidgetSetting }[]
): string[] {
  return [...collectionWidgets(widgets)].map(
    ([id, setting]) => `${id}=${JSON.stringify(setting)}`
  );
}

/**
 * A widget declaration as this reader is told it: its Collection setting's
 * declared default withheld when that default names a collection the reader
 * may not read. The same declaration when there is nothing to withhold.
 *
 * 🔴 The workspace payload ships declarations to every reader who may see the
 * widget, and a default is a collection slug: shipped as declared, it tells a
 * reader of a collection they may not read, whether or not they hold a card.
 * Withholding the cards that rely on it (`unreadableCollectionCard`) does not
 * reach the declaration.
 *
 * Only the default goes, not the declaration: the widget stays offered for
 * the collections the reader may read, and a card added without choosing one
 * is set to none, drawn as not available. The verdict is the layout's: the
 * same slug rule (`namedCollection`) and the same readable collections.
 */
export function collectionDefaultForReader<
  W extends { settings?: readonly AnyWidgetSetting[] },
>(widget: W, readable: ReadonlySet<string>): W {
  const settings = widget.settings;
  if (settings === undefined) return widget;
  let withheld = false;
  const told = settings.map(setting => {
    if (setting.type !== "collection") return setting;
    const named = namedCollection(setting.defaultValue);
    if (named === undefined || readable.has(named)) return setting;
    withheld = true;
    return Object.fromEntries(
      Object.entries(setting).filter(([key]) => key !== "defaultValue")
    ) as AnyWidgetSetting;
  });
  return withheld ? { ...widget, settings: told } : widget;
}
