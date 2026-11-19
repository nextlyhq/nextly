/**
 * Which sections of the block panel are open: each tab's sections fold on
 * their own, and stay as the author left them across selections and visits.
 *
 * Kept per tab and section NAME (`style:Spacing`), not per block, because an
 * author working on spacing selects one block after another and means to keep
 * Spacing open on each. "Expand all" and "Collapse all" store one entry for
 * the tab (`style:*`) and drop the tab's own, so they reach sections the panel
 * has not drawn yet.
 *
 * Held with the shell's other preferences (`panel-folds-context` lends them
 * to the panel).
 *
 * @module panel-folds
 */
/** The open or closed state of each section the author has folded. */
export type SectionFolds = Readonly<Record<string, boolean>>;

/** The most sections remembered; the oldest are dropped past it. */
export const MAX_SECTION_FOLDS = 200;

/** The longest key remembered: a tab, a colon and a section's name. */
const MAX_FOLD_KEY_LENGTH = 120;

/** The key one section's fold is kept under. */
function foldKey(tab: string, label: string): string {
  return `${tab}:${label}`;
}

/** The key a whole tab's Expand all or Collapse all is kept under. */
function allKey(tab: string): string {
  return `${tab}:*`;
}

/** What a section's opening falls back to when nothing is remembered. */
export interface SectionDefault {
  /** Whether it holds a value for what is being edited. */
  readonly holdsValue: boolean;
  /** Whether it is the tab's first section. */
  readonly first: boolean;
}

/**
 * Whether a section is open: as the author last left it, else as they last
 * left the whole tab, else open when it holds a value or is the tab's first.
 */
export function sectionOpens(
  folds: SectionFolds,
  tab: string,
  label: string,
  fallback: SectionDefault
): boolean {
  return (
    folds[foldKey(tab, label)] ??
    folds[allKey(tab)] ??
    (fallback.holdsValue || fallback.first)
  );
}

/** The folds with the oldest dropped past {@link MAX_SECTION_FOLDS}. */
function bounded(folds: Record<string, boolean>): SectionFolds {
  const keys = Object.keys(folds);
  if (keys.length <= MAX_SECTION_FOLDS) return folds;
  return Object.fromEntries(
    keys.slice(keys.length - MAX_SECTION_FOLDS).map(key => [key, folds[key]])
  );
}

/** The folds with one section set open or closed, kept newest last. */
export function withSectionFold(
  folds: SectionFolds,
  tab: string,
  label: string,
  open: boolean
): SectionFolds {
  const key = foldKey(tab, label);
  const { [key]: _previous, ...rest } = folds;
  return bounded({ ...rest, [key]: open });
}

/** The folds with every section of a tab open or closed. */
export function withTabFold(
  folds: SectionFolds,
  tab: string,
  open: boolean
): SectionFolds {
  const prefix = `${tab}:`;
  const rest = Object.fromEntries(
    Object.entries(folds).filter(([key]) => !key.startsWith(prefix))
  );
  return bounded({ ...rest, [allKey(tab)]: open });
}

/**
 * Stored folds as the panel may read them: a record of booleans under keys a
 * section could have, bounded, and nothing else.
 */
export function readSectionFolds(stored: unknown): SectionFolds {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }
  const kept: Record<string, boolean> = {};
  for (const [key, open] of Object.entries(stored)) {
    if (typeof open !== "boolean") continue;
    if (key.length > MAX_FOLD_KEY_LENGTH || !key.includes(":")) continue;
    kept[key] = open;
  }
  return bounded(kept);
}
