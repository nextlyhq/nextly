/**
 * Which of a place's delivered entries a page draws: the one rule every place
 * part follows, whether a hook reads the list (blocks, tabs) or a page orders
 * its own parts by it (the document panel's sections).
 *
 * The server sends each place's lists once per reader, already ordered and
 * pruned of what the reader may not see. A contribution scoped to some
 * collections, or ruled by `visibleWhen`, still arrives on every page of its
 * place, and only the page can settle it: it knows who is looking, which
 * collection it shows, and the entry on screen. A contribution that cannot be
 * drawn there and replaces a built-in part gives that part back where it
 * stood, as the server does for one it does not send, so a replacement drawn
 * only for drafts leaves a published entry its own part.
 *
 * @module lib/plugins/place-entries
 */
import {
  rowMatches,
  type DeliveredAdminContribution,
  type DeliveredAdminEntry,
} from "nextly/config";

/** What the page knows that decides whether a contribution is drawn on it. */
export interface PlaceView {
  /** The place's context, or `null` while the page does not know its ids. */
  context: unknown;
  /** The entry the page shows, where it shows one. */
  entry?: Record<string, unknown>;
}

/** The collection a page shows, as its place's context names it, if any. */
function pageCollection(context: unknown): string | undefined {
  return typeof context === "object" &&
    context !== null &&
    "collection" in context &&
    typeof context.collection === "string"
    ? context.collection
    : undefined;
}

/** The Single a page shows, as its place's context names it, if any. */
function pageSingle(context: unknown): string | undefined {
  return typeof context === "object" &&
    context !== null &&
    "single" in context &&
    typeof context.single === "string"
    ? context.single
    : undefined;
}

/**
 * Whether a contribution can be drawn on this page: once the page knows its
 * ids, on a collection it is offered on, and where its rule matches the
 * entry. A rule is judged only where the page shows one entry; with none, a
 * contribution carrying a rule is not drawn, since nothing settles it. A
 * contribution scoped to collections, on a page that names none, is not.
 */
function drawableHere(
  item: DeliveredAdminContribution,
  { context, entry }: PlaceView
): boolean {
  return (
    offeredHere(item, context) &&
    (item.visibleWhen === undefined ||
      (entry !== undefined && rowMatches(item.visibleWhen, entry)))
  );
}

/**
 * Whether a contribution is offered on this page, before its rule is judged:
 * once the page knows its ids, on a collection or Single it is offered on.
 * Where a page starts a contribution's reads before its entry has arrived,
 * this is all it can judge, so a contribution with a rule is started anyway.
 */
export function offeredHere(
  item: DeliveredAdminContribution,
  context: unknown
): boolean {
  if (context === null || context === undefined) return false;
  if (item.collections !== undefined) {
    const collection = pageCollection(context);
    if (collection === undefined || !item.collections.includes(collection)) {
      return false;
    }
  }
  if (item.singles !== undefined) {
    const single = pageSingle(context);
    if (single === undefined || !item.singles.includes(single)) return false;
  }
  return true;
}

/** The document fields a delivered tab edits, where it names any. */
function tabFields(item: DeliveredAdminEntry): readonly string[] | undefined {
  return "builtIn" in item || item.kind !== "tab" ? undefined : item.fields;
}

/**
 * Whether a tab can be drawn on a document with these top-level fields: a tab
 * that edits fields only where the document has every one of them, and only on
 * an edit page, which names its fields (`fieldNames`). A tab that edits none
 * is left to the place's other rules.
 */
export function tabFitsDocument(
  item: DeliveredAdminEntry,
  fieldNames: readonly string[] | undefined
): boolean {
  const fields = tabFields(item);
  if (fields === undefined) return true;
  return (
    fieldNames !== undefined && fields.every(name => fieldNames.includes(name))
  );
}

/**
 * The document fields the tabs drawn on this edit page take over, which the
 * page then leaves out of its own content: they are drawn, and edited, in
 * their tab. Their values stay in the page's form, so its Save stores them.
 */
export function fieldsTakenByTabs(
  tabs: readonly DeliveredAdminEntry[],
  fieldNames: readonly string[]
): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const tab of tabs) {
    if (!tabFitsDocument(tab, fieldNames)) continue;
    for (const name of tabFields(tab) ?? []) taken.add(name);
  }
  return taken;
}

/**
 * The delivered entries this page draws, in the order delivered: the page's
 * built-in parts as `{ builtIn }`, and the contributions that can be drawn
 * here; one that cannot, and replaces a built-in part, gives that part back
 * in its place, and any other that cannot is left out.
 */
export function entriesDrawnHere(
  delivered: readonly DeliveredAdminEntry[],
  view: PlaceView
): DeliveredAdminEntry[] {
  return delivered.flatMap((item): DeliveredAdminEntry[] => {
    if ("builtIn" in item || drawableHere(item, view)) return [item];
    return item.replaces === undefined ? [] : [{ builtIn: item.replaces }];
  });
}

/**
 * The fields a plugin's switch keeps off this page (`withheldFields` in the
 * workspace metadata, keyed `collection:<slug>` or `single:<slug>`): fields
 * the plugin added to the page's type and has switched off there. The page
 * draws them nowhere, and their stored values are left as they are.
 */
export function fieldsWithheldHere(
  withheld: Readonly<Record<string, readonly string[]>> | undefined,
  context: unknown
): ReadonlySet<string> {
  if (withheld === undefined) return new Set();
  const collection = pageCollection(context);
  const single = pageSingle(context);
  const key =
    collection !== undefined
      ? `collection:${collection}`
      : single !== undefined
        ? `single:${single}`
        : undefined;
  return new Set(key === undefined ? [] : (withheld[key] ?? []));
}
