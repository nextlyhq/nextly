/**
 * Which Layouts name a component, asked LIVE rather than from an index.
 *
 * The second of the two questions "is this component in use" turns out to be,
 * and the reason it is not the same question as the first.
 *
 * ## Why live, when pages are indexed
 *
 * Two properties decide it, and neither is a preference.
 *
 * Deleting a component a Layout names is REFUSED rather than warned about,
 * because a Layout wraps every page assigned to it — a site-wide failure rather
 * than the one visible, recoverable placeholder an ordinary page shows. A
 * refusal is an answer the author cannot ignore, so it has to be one this can
 * stand behind.
 *
 * A refusal has to be exact AT THE MOMENT IT REFUSES. An index is eventually
 * consistent by construction — its maintenance is post-commit and its own
 * hook's docblock says so — and a stale one here either blocks a delete that
 * was safe or permits one that was not. The page count has no such duty: it is
 * drawn beside a tile and fed to a detach job, over a population far too large
 * to scan per render, which is what the index is FOR.
 *
 * So the two are not one question answered twice. They are two questions whose
 * blast radius differs, and `collections/layouts.ts` reached the same place
 * from the other end: what this needs "belongs with the resolver that will be
 * the first thing to read these references".
 *
 * ## The one assumption in it, and why the bound refuses
 *
 * A site has a handful of Layouts where it has many pages, which is what makes
 * scanning them affordable. That is a SIZING ASSUMPTION rather than a
 * guarantee, and unlike an index there is no write amplification to signal the
 * day it stops holding. So the scan is bounded and REPORTS the bound: a
 * truncated scan that answered `references: []` would say "no Layout uses
 * this", which is precisely the answer that permits the delete this exists to
 * refuse.
 *
 * @module layout-component-usage
 */

/** Where one Layout names the component. */
export interface LayoutComponentReference {
  /** The Layout's own id. */
  layoutId: string;
  /** Its title, for a refusal an author can act on. Empty when unreadable. */
  title: string;
  /** Which area of the Layout names it. Empty when unreadable. */
  area: string;
  /**
   * Which stored form of the Layout names it.
   *
   * EVERY form is collected. A draft Layout, and a published Layout's pending
   * edit, are both on no page yet — and deleting the component either names
   * breaks the Layout the moment somebody publishes it, by which time the cause
   * is a deletion nobody remembers.
   */
  variant: "published" | "draft";
}

/** What a scan of the Layouts found, and whether it saw all of them. */
export interface LayoutComponentUsage {
  references: readonly LayoutComponentReference[];
  /**
   * Whether every Layout was examined.
   *
   * False means `references` is a PREFIX. A caller deciding whether a delete
   * is safe must refuse on `false` rather than read the list as complete: an
   * empty prefix and a component no Layout names are the same value, and only
   * this separates them.
   */
  complete: boolean;
}

/**
 * One Layout, in every form that can name a component.
 *
 * A Layout is not one document. Its main row holds the form the site currently
 * stores, and a published Layout edited since keeps those changes in a separate
 * pending edit — so a component can be named by one and not the other. Both
 * travel together because deleting a component either names breaks the Layout:
 * the stored form immediately, the pending one on the next publish.
 *
 * They are carried as one record rather than as separate items so that the
 * scan's bound counts LAYOUTS. A budget spent per form would run out twice as
 * fast on a site whose Layouts have unpublished edits, and report a scan as
 * truncated over a population it had in fact finished.
 */
export interface LayoutRecord {
  /** The main row, in whichever lifecycle state it is stored. */
  stored: unknown;
  /** Which lifecycle state `stored` is in. */
  variant: "published" | "draft";
  /**
   * Its unpublished pending edit, or `null` when it has none.
   *
   * Typed `unknown` rather than a union with `null`, which says the same thing
   * and collapses to `unknown` anyway — a stored document has no shape this
   * module is entitled to assume, so `null` is a value the reader agrees to
   * send rather than a type the checker enforces.
   *
   * REQUIRED rather than optional, so a reader that has not looked for a
   * pending edit cannot omit the field and have that read as "there is none".
   */
  pending: unknown;
}

/** One page of stored Layouts, as this reads them. */
export interface LayoutPage {
  items: readonly LayoutRecord[];
  hasNext: boolean;
}

/**
 * How the stored Layouts are read, injected so this needs no Direct API.
 *
 * ONE enumeration covering every lifecycle state, rather than a pass per state.
 * A published Layout holding unpublished changes keeps its main row published,
 * so a draft-scoped read excludes precisely the Layout whose pending edit has
 * to be inspected — the state a per-state scan is least able to see is the one
 * it most needs.
 */
export interface LayoutReader {
  (args: { page: number }): Promise<LayoutPage>;
}

/**
 * How many Layouts one scan will read before reporting that it stopped.
 *
 * Generous rather than tuned: this is a runaway guard on a loop, not a claim
 * about how many Layouts a site should have. Reaching it is evidence about the
 * INSTALLATION — that Layouts have grown into a population wanting an index of
 * their own — rather than about the component being asked about.
 */
export const MAX_LAYOUTS_SCANNED = 1000;

/**
 * Every Layout that names `componentId`, and whether every Layout was seen.
 *
 * Total by construction. Layouts arrive from storage and nothing here is
 * guaranteed to have validated them — `areas` is a repeater, stored as one
 * JSON column — so a shape this cannot read contributes nothing rather than
 * raising. It reads defensively for the same reason the index's own document
 * reader does.
 */
export async function layoutReferencesOf(args: {
  read: LayoutReader;
  componentId: string;
}): Promise<LayoutComponentUsage> {
  // An empty id matches nothing and is not a component, so scanning for it
  // would spend the whole budget to answer "no". Answered as COMPLETE because
  // it genuinely is: nothing can name an id that is not one.
  if (args.componentId === "") return { references: [], complete: true };

  const references: LayoutComponentReference[] = [];
  let scanned = 0;
  let page = 1;

  for (;;) {
    const answered = await args.read({ page });
    for (const record of answered.items) {
      scanned += 1;
      if (scanned > MAX_LAYOUTS_SCANNED) {
        return { references, complete: false };
      }
      references.push(
        ...referencesIn(record.stored, args.componentId, record.variant)
      );
      if (record.pending !== null) {
        // A pending edit is unpublished whatever state its main row is in, so
        // it reads as a draft reference wherever it is reported.
        references.push(
          ...referencesIn(record.pending, args.componentId, "draft")
        );
      }
    }
    if (!answered.hasNext) break;
    page += 1;
  }

  return { references, complete: true };
}

/** Where one stored Layout names the component, if it does. */
function referencesIn(
  item: unknown,
  componentId: string,
  variant: "published" | "draft"
): LayoutComponentReference[] {
  const named = layoutIdentityOf(item);
  if (named === null) return [];

  const areas = (item as Record<string, unknown>).areas;
  if (!Array.isArray(areas)) return [];

  const found: LayoutComponentReference[] = [];
  for (const row of areas) {
    const area = areaNaming(row, componentId);
    if (area === null) continue;
    found.push({ ...named, area, variant });
  }
  return found;
}

/**
 * How a Layout is named in a refusal, or null when it cannot be.
 *
 * A Layout whose id cannot be read cannot be NAMED, and a refusal an author
 * cannot act on is worse than the delete it prevents — so it contributes
 * nothing rather than an anonymous entry.
 */
function layoutIdentityOf(
  item: unknown
): { layoutId: string; title: string } | null {
  if (!isRecord(item)) return null;
  const layoutId = typeof item.id === "string" ? item.id : "";
  if (layoutId === "") return null;
  return {
    layoutId,
    title: typeof item.title === "string" ? item.title : "",
  };
}

/**
 * The area this repeater row places `componentId` in, or null when the row
 * does not name that component at all.
 *
 * Matching and locating are ONE question here, because a row that matches
 * always has an area to report — empty when the stored value is not a string,
 * which is a row that still names the component and still has to be refused.
 * Separating them would let a caller act on a match while holding no place to
 * send the author.
 */
function areaNaming(row: unknown, componentId: string): string | null {
  if (!isRecord(row)) return null;
  if (componentIdOf(row.component) !== componentId) return null;
  return typeof row.area === "string" ? row.area : "";
}

/**
 * The component a repeater row names, whichever shape the read returned.
 *
 * A relationship comes back as the bare id at `depth: 0` and as the populated
 * document above it, and this module does not control the depth its caller
 * reads at. Handling one shape only would answer "no Layout names this" on
 * every installation whose caller populated — the direction that permits the
 * delete.
 */
function componentIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
