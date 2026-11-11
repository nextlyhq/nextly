/**
 * The numbers a standalone plugin's panel shows beside its items, as the
 * server answers them, and how each is drawn and spoken.
 *
 * The server reads them from the panel it published for the plugin
 * (`GET /api/admin-meta/plugin-panel-numbers`), each keyed by its item's place
 * among the plugin's published top-level menu items: the order of
 * `PluginMetadata.menu`. Here each is filed under its item's address, which
 * is what the panel draws its items by after it has filtered and sorted them.
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

/**
 * Each item's number from the server's answer, by the address of the item at
 * the place it is keyed by. An entry that is not a number, or whose place
 * holds no item declaring one, is dropped.
 */
export function panelNumbersByAddress(
  menu: readonly PluginMenuItemMeta[],
  answer: unknown
): ReadonlyMap<string, PanelItemNumber> {
  const entries = (answer as { numbers?: unknown } | null)?.numbers;
  const numbers = new Map<string, PanelItemNumber>();
  if (!Array.isArray(entries)) return numbers;
  for (const entry of entries) {
    const read = numberIn(entry);
    const item = read === undefined ? undefined : menu[read.index];
    if (read === undefined || item === undefined) continue;
    if (item.count === undefined && item.badge === undefined) continue;
    numbers.set(item.to, read.number);
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
