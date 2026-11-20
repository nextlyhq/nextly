/**
 * Whether a chip would show blank with the workbench's test data: no value
 * and no fallback. As the renderer reads a chip, an absent value, null and an
 * empty string are no value, while false and 0 are values and show. A chip
 * that stands for an address shows only a complete one: anything else the
 * renderer drops, as it drops an empty value.
 *
 * Inside a list, nothing shows when the list has no items, since none of its
 * blocks run; and `item` is each of the list's items in turn, so a chip of
 * its fields shows blank when any item lacks the value.
 *
 * @module components/features/settings/EmailTemplateForm/written/chip-values
 */
import { addressProblem, type AddressKind } from "./addresses";

/** A chip as the check needs it: its variable path and its fallback. */
interface ChipValue {
  variable: string;
  fallback?: string;
}

/** The value at a dotted `path` inside `data`, or undefined. */
function valueAt(data: unknown, path: readonly string[]): unknown {
  let at = data;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** Whether `value` shows: anything but empty, or for an address a complete one. */
function shows(value: unknown, address: AddressKind | undefined): boolean {
  if (address) {
    return typeof value === "string" && addressProblem(value, address) === null;
  }
  return !isEmpty(value);
}

/** Whether a value is absent, null or empty: what a fallback stands in for. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Whether one value of `chip` shows nothing. Its fallback stands in only for
 * an empty value: a value that is there but is no complete address is passed
 * on as it is, and the renderer drops it, fallback or not.
 */
function valueShowsBlank(
  value: unknown,
  chip: ChipValue,
  address: AddressKind | undefined
): boolean {
  if (!isEmpty(value)) return !shows(value, address);
  return !(chip.fallback !== undefined && shows(chip.fallback, address));
}

/**
 * Whether `chip` shows nothing with `data`. `list` is the path of the list the
 * chip sits in, if any, whose items `item` stands for; `address` is set when
 * the chip stands for an address.
 */
export function chipShowsBlank(
  chip: ChipValue,
  data: unknown,
  list?: string,
  address?: AddressKind
): boolean {
  const items = list === undefined ? undefined : valueAt(data, list.split("."));
  // A list with no items never reaches its blocks: nothing there shows,
  // whatever value or fallback a chip has.
  if (list !== undefined && (!Array.isArray(items) || items.length === 0)) {
    return true;
  }
  const [head, ...rest] = chip.variable.split(".");
  if (Array.isArray(items) && head === "item") {
    return items.some(item =>
      valueShowsBlank(valueAt(item, rest), chip, address)
    );
  }
  return valueShowsBlank(valueAt(data, [head, ...rest]), chip, address);
}
