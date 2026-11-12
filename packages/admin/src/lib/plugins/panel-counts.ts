/**
 * The numbers a standalone plugin's panel shows beside its items, as the
 * server answers them, and how each is drawn and spoken.
 *
 * The server reads them from the panel it published for the plugin
 * (`GET /api/admin-meta/plugin-panel-numbers`), each keyed by its item's place
 * among the plugin's published top-level menu items: the order of
 * `PluginMetadata.menu`. That place is the item's identity here too: it is
 * marked on each item before the panel filters and sorts them
 * (`withPanelPlaces`), so two items linking to one page keep their own
 * numbers.
 *
 * @module lib/plugins/panel-counts
 */
import type { PluginMenuItemMeta } from "@admin/types/branding";

/** The number one item shows, and whether it is a floor ("99+"). */
export interface PanelItemNumber {
  readonly value: number;
  readonly atLeast: boolean;
}

/** Whether any of a plugin's published items declares a number. */
export function declaresNumbers(
  menu: readonly PluginMenuItemMeta[] | undefined
): boolean {
  return (menu ?? []).some(
    item => item.count !== undefined || item.badge !== undefined
  );
}

/** One number of the answer, if it is one. */
function numberIn(
  entry: unknown
): { index: number; number: PanelItemNumber } | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { index, value, atLeast } = entry as Record<string, unknown>;
  const whole = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (!whole(index) || !whole(value)) return undefined;
  return { index, number: { value, atLeast: atLeast === true } };
}

/** Where an item's place among the published menu is kept on it. */
const PANEL_PLACE = "panelPlace";

/**
 * The plugin's published top-level items, each marked with its place among
 * them, the key the server answers its number under. Marked on the item
 * itself, an own property, so a copy the panel makes of it while filtering
 * (a branch with its children narrowed) carries the mark.
 */
export function withPanelPlaces(
  menu: readonly PluginMenuItemMeta[]
): PluginMenuItemMeta[] {
  return menu.map((item, place) => ({ ...item, [PANEL_PLACE]: place }));
}

/** The place `withPanelPlaces` marked on an item, if it was marked. */
export function panelPlaceOf(item: PluginMenuItemMeta): number | undefined {
  // Read by key, since the mark is not part of the item's declared shape.
  const place: unknown = Reflect.get(item, PANEL_PLACE);
  return typeof place === "number" ? place : undefined;
}

/**
 * Each item's number from the server's answer, by the item's place among the
 * published menu. An entry that is not a number, or whose place holds no
 * item declaring one, is dropped.
 */
export function panelNumbersByPlace(
  menu: readonly PluginMenuItemMeta[],
  answer: unknown
): ReadonlyMap<number, PanelItemNumber> {
  const entries = (answer as { numbers?: unknown } | null)?.numbers;
  const numbers = new Map<number, PanelItemNumber>();
  if (!Array.isArray(entries)) return numbers;
  for (const entry of entries) {
    const read = numberIn(entry);
    const item = read === undefined ? undefined : menu[read.index];
    if (read === undefined || item === undefined) continue;
    if (item.count === undefined && item.badge === undefined) continue;
    numbers.set(read.index, read.number);
  }
  return numbers;
}

/** The number as drawn: "12", or "99+" for a floor. */
export function itemNumberText(number: PanelItemNumber): string {
  return number.atLeast ? `${number.value}+` : String(number.value);
}

/** The number as assistive technology reads it: "12", or "99 or more". */
export function itemNumberSpoken(number: PanelItemNumber): string {
  return number.atLeast ? `${number.value} or more` : String(number.value);
}
