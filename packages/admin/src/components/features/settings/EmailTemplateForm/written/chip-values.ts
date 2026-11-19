/**
 * Whether a chip would show blank with the workbench's test data: no value
 * and no fallback. As the renderer reads a chip, an absent value, null and an
 * empty string are no value, while false and 0 are values and show.
 *
 * Inside a list, `item` is each of the list's items in turn, so a chip there
 * shows blank when any item lacks the value, or when there are no items.
 *
 * @module components/features/settings/EmailTemplateForm/written/chip-values
 */

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

/** Whether a value renders as nothing. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Whether `chip` shows nothing with `data`. `list` is the path of the list the
 * chip sits in, if any, whose items `item` stands for.
 */
export function chipShowsBlank(
  chip: ChipValue,
  data: unknown,
  list?: string
): boolean {
  // An empty fallback is no fallback: it shows nothing either.
  if (chip.fallback !== undefined && chip.fallback !== "") return false;
  const [head, ...rest] = chip.variable.split(".");
  if (list !== undefined && head === "item") {
    const items = valueAt(data, list.split("."));
    if (!Array.isArray(items) || items.length === 0) return true;
    return items.some(item => isBlank(valueAt(item, rest)));
  }
  return isBlank(valueAt(data, [head, ...rest]));
}
