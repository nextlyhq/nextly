/**
 * How big a dashboard card is: `{ w, h }` on a grid twelve columns wide, with
 * rows of one fixed height, and the bounds a widget's declaration puts on it.
 *
 * 🔴 The one size vocabulary. A widget's declaration, the site config's card
 * entries, a stored placement, the admin's grid and the size a widget's own
 * component is handed all say a size in these units and nothing else; there
 * is no named width or height to translate to or from. Every reader of a size
 * goes through the functions here, so a size cannot be judged one way where it
 * is declared and another where it is stored.
 *
 * Imports nothing, so the admin reaches it through `nextly/config` without the
 * server behind it.
 *
 * @module domains/widgets/grid-size
 */

/** The grid's width in columns. A card's `w` is from 1 to this. */
export const GRID_COLUMNS = 12;

/**
 * The fewest rows a card may span. One row cannot hold the frame's padding,
 * header and gap, so no size is shorter than this.
 */
export const MIN_GRID_ROWS = 2;

/** A card's size in grid units: `w` columns by `h` rows, both whole numbers. */
export interface GridSize {
  w: number;
  h: number;
}

/**
 * A widget's size as its declaration states it: the size a new card starts
 * at, and optionally the smallest and largest it may be resized to.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export interface WidgetSizeDeclaration {
  default: GridSize;
  /** The smallest size; the default when absent. */
  min?: GridSize;
  /** The largest size; the full width at the default's height when absent. */
  max?: GridSize;
}

/**
 * A widget's size bounds with every end filled in: what the registry holds and
 * the admin reads, so neither fills a missing end its own way.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export interface WidgetSizeBounds {
  default: GridSize;
  min: GridSize;
  max: GridSize;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWhole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** Whether a value is a size the grid can draw: whole `w` 1–12 and `h` 2 or more. */
export function isGridSize(value: unknown): value is GridSize {
  return (
    isRecord(value) &&
    isWhole(value.w) &&
    value.w >= 1 &&
    value.w <= GRID_COLUMNS &&
    isWhole(value.h) &&
    value.h >= MIN_GRID_ROWS
  );
}

/** What is wrong with one size, or `undefined` when the grid can draw it. */
function gridSizeProblem(value: unknown, name: string): string | undefined {
  if (!isRecord(value)) return `${name} must be { w, h }`;
  if (!isWhole(value.w) || value.w < 1 || value.w > GRID_COLUMNS) {
    return `${name}.w must be a whole number from 1 to ${GRID_COLUMNS}, got ${String(value.w)}`;
  }
  if (!isWhole(value.h) || value.h < MIN_GRID_ROWS) {
    return `${name}.h must be a whole number of ${MIN_GRID_ROWS} or more, got ${String(value.h)}`;
  }
  return undefined;
}

/** Whether `a` is at most `b` in both directions. */
const fitsWithin = (a: GridSize, b: GridSize): boolean =>
  a.w <= b.w && a.h <= b.h;

/**
 * Every problem with a size declaration, as a startup check reports it, in
 * the declaration's own words: each size the grid could not draw, then a
 * minimum above the default or a default above the maximum. Empty when the
 * declaration can be used.
 */
export function sizeDeclarationProblems(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["size must be { default: { w, h }, min?, max? }"];
  }
  const problems: string[] = [];
  const shape = (key: "default" | "min" | "max") => {
    if (key !== "default" && value[key] === undefined) return;
    const problem = gridSizeProblem(value[key], `size.${key}`);
    if (problem !== undefined) problems.push(problem);
  };
  shape("default");
  shape("min");
  shape("max");
  // The order between them is judged only once every stated size is one the
  // grid can draw; otherwise the same mistake would be reported twice.
  if (problems.length > 0) return problems;
  const bounds = sizeBounds(value as unknown as WidgetSizeDeclaration);
  if (!fitsWithin(bounds.min, bounds.default)) {
    problems.push("size.min must not be larger than size.default");
  }
  if (!fitsWithin(bounds.default, bounds.max)) {
    problems.push("size.default must not be larger than size.max");
  }
  return problems;
}

/**
 * A declaration's bounds with every end filled in: the minimum defaults to the
 * default, and the maximum to the full width at the default's height.
 */
export function sizeBounds(declared: WidgetSizeDeclaration): WidgetSizeBounds {
  return {
    default: { ...declared.default },
    min: { ...(declared.min ?? declared.default) },
    max: { ...(declared.max ?? { w: GRID_COLUMNS, h: declared.default.h }) },
  };
}

const between = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * The nearest size within the bounds: each direction moved only as far as it
 * must. A stored size outside a widget's current bounds is drawn at this and
 * kept as stored until its owner saves.
 */
export function clampSize(size: GridSize, bounds: WidgetSizeBounds): GridSize {
  return {
    w: between(size.w, bounds.min.w, bounds.max.w),
    h: between(size.h, bounds.min.h, bounds.max.h),
  };
}

/** Whether a size lies within the bounds. */
export function sizeWithinBounds(
  size: GridSize,
  bounds: WidgetSizeBounds
): boolean {
  return fitsWithin(bounds.min, size) && fitsWithin(size, bounds.max);
}

/**
 * Bounds narrowed by a site's override: a new default, minimum or maximum,
 * each held inside the widget's own bounds. An override narrows a widget's
 * sizes and never widens them, so a widget is never drawn at a size its
 * author did not allow. `undefined` when the override would widen them, or
 * leave no size between its ends, which a startup check names.
 */
export function narrowedSizeBounds(
  own: WidgetSizeBounds,
  override: Partial<WidgetSizeDeclaration>
): WidgetSizeBounds | undefined {
  const min = override.min ?? own.min;
  const max = override.max ?? own.max;
  if (!fitsWithin(own.min, min) || !fitsWithin(max, own.max)) return undefined;
  if (!fitsWithin(min, max)) return undefined;
  const fallback = clampSize(own.default, { default: own.default, min, max });
  const start = override.default ?? fallback;
  if (!fitsWithin(min, start) || !fitsWithin(start, max)) return undefined;
  return { default: { ...start }, min: { ...min }, max: { ...max } };
}
