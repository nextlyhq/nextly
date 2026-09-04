/**
 * A card per collection, derived from the sources the install actually has.
 *
 * ## Why these are GENERATED rather than registered
 *
 * A collection is created while the process is running — the Schema Builder
 * makes one without a restart — so a widget declared for it at boot describes
 * an install that has since changed. These are derived at REQUEST time from the
 * registered sources, the same read `refreshCollectionSources` already performs
 * per batch, so a collection added a minute ago has its cards and a collection
 * deleted a minute ago does not.
 *
 * Django's admin takes the same position for the same reason: it builds a
 * per-model view set at request time rather than freezing one at import.
 *
 * ## Why they are OFFERED and never placed
 *
 * They do not appear on anybody's dashboard until a reader adds one. An install
 * with forty collections would otherwise open onto eighty cards, and the reader
 * who wanted three has to remove seventy-seven. Payload shipped the auto-placing
 * version and withdrew it: one card per collection produced duplicates with no
 * clean opt-out, and the arrangement had no way to say "I have seen this and I
 * do not want it".
 *
 * The picker is what makes "not placed" workable. Without a list naming the
 * unplaced widgets these would be reachable from nothing.
 *
 * ## Why they are derived from SOURCES rather than from collections
 *
 * A widget and the source it queries must agree about three things: that the
 * source exists, which ops it answers, and which permission gates it. Reading
 * the collection registry a second time here would answer all three again, and
 * the copies would drift — a source that stopped supporting `count` would leave
 * a metric card whose every request is refused. Taking them from the registered
 * source means there is nothing to disagree with.
 *
 * @module domains/widgets/collection-widgets
 */

import { refreshCollectionSources } from "./collection-sources";
import { isValidWidgetId, type WidgetDefinition } from "./definition";
import { listSources, type WidgetSource } from "./sources";

/** How many rows a generated list asks for. The renderer draws at most five. */
const LIST_ROWS = 5;

/**
 * How many rows a generated table asks for.
 *
 * The same as a list's, and asked separately rather than shared, because the
 * two renderers cap independently -- a table's rows are wider, so its own limit
 * is lower than a list's and may move without dragging the list with it.
 */
const TABLE_ROWS = 5;

/**
 * The id of a generated widget, from the source it draws.
 *
 * Namespaced under `collection/` so it cannot collide with core's own `core/`
 * cards, and suffixed by what it draws so one collection can have both. Derived
 * from the source id rather than from a slug passed alongside it, for the same
 * reason every other field here is.
 */
function widgetId(
  source: WidgetSource,
  kind: "count" | "recent" | "table" | "stats"
): string | undefined {
  // 🔴 An underscore is legal in a collection slug (`SLUG_PATTERN` permits it)
  // and illegal in a widget id, so `customer_notes` produced an id the registry
  // refuses and BOTH its cards were silently dropped -- a supported class of
  // collection that never got the feature, with nothing to say why. Mapped to a
  // hyphen, which is the id vocabulary's own separator.
  //
  // The mapping is not injective: `a_b` and `a-b` both become `a-b`. That is
  // handled where the whole set is known, in `collectionWidgets`, because a
  // collision is a property of the INSTALL rather than of either collection --
  // deciding it here would need one of the two to win arbitrarily.
  const slug = source.id.slice("collection:".length).replaceAll("_", "-");
  const id = `collection/${slug}-${kind}`;
  // ASKED rather than assumed. A widget id is `namespace/name` in lowercase
  // slug form -- two segments, so the kind is a suffix rather than a third
  // segment -- and a collection slug that cannot produce one is skipped instead
  // of minting an id the registry would refuse. The predicate is the registry's
  // own, so this cannot drift away from what it accepts.
  return isValidWidgetId(id) ? id : undefined;
}

/**
 * The metric card for a source: how many entries the collection holds.
 *
 * `status: "all"`, deliberately. A count that silently excluded drafts would
 * disagree with the number the collection's own list view shows, and the reader
 * has no way to tell which of the two is answering a narrower question.
 */
function countWidget(source: WidgetSource): WidgetDefinition | undefined {
  if (!source.supports.includes("count")) return undefined;
  const id = widgetId(source, "count");
  if (id === undefined) return undefined;
  return {
    id,
    title: source.label,
    description: `How many entries ${source.label} holds`,
    archetype: "metric",
    defaultSize: "sm",
    query: { source: source.id, op: "count", status: "all" },
  };
}

/**
 * The lifecycle states a health card counts, and what each one is called.
 *
 * 🔴 One entry produces BOTH the cell's query and the cell's link, because the
 * card's promise is that the number and the page behind it are the same
 * question. Built separately they agree on the day they are written: a card
 * reading "14 drafts" that opens a list of everything is not visibly broken --
 * the reader sees a list, counts nothing, and carries on believing the number.
 */
const HEALTH_STATES = [
  { key: "published", label: "Published", status: "published" },
  { key: "draft", label: "Draft", status: "draft" },
] as const;

/**
 * Where a cell's number navigates: the collection's list, filtered the same way.
 *
 * `?where=` is the entry list's OWN url filter, already read by
 * `buildEntryWhereFilter`, rather than a parameter invented for this card. A
 * second filtering vocabulary would have to be kept in step with the first, and
 * the failure would be a link that lands on an unfiltered list showing a
 * different number than the card promised.
 */
function healthWhere(status: string): Record<string, unknown> {
  return { status: { equals: status } };
}

function healthHref(slug: string, status?: string): string {
  const path = `/admin/collections/${slug}`;
  if (status === undefined) return path;
  const where = JSON.stringify(healthWhere(status));
  return `${path}?${new URLSearchParams({ where }).toString()}`;
}

/**
 * The health card for a source: how its entries are split by lifecycle state.
 *
 * Generated only for a collection that DECLARES a status, and the refusal
 * matters: without one there is a single number to draw, which is the `metric`
 * card this source already has. A one-cell health card would be that card again
 * under a second name, and a reader placing both would see the same figure
 * twice and reasonably assume they measured different things.
 *
 * The total is first and unfiltered, so the parts have something to be parts
 * OF -- "12 published, 3 draft" invites the reader to add them up and hope that
 * is everything, which is true today and stops being true the moment a third
 * state exists.
 */
function statsWidget(source: WidgetSource): WidgetDefinition | undefined {
  if (!source.supports.includes("count")) return undefined;
  // 🔴 The CAPABILITY, not a field called "status". A collection with lifecycle
  // disabled may declare an ordinary user field of that name -- the schema
  // permits it -- and the two are indistinguishable in `fields`. Reading the
  // name would generate a lifecycle card for it whose `status` selector the
  // query then ignores, so Total, Published and Draft would all report the
  // same row count while the links filtered an unrelated user field.
  if (source.lifecycleStatus !== true) return undefined;
  const id = widgetId(source, "stats");
  if (id === undefined) return undefined;
  const slug = source.id.slice("collection:".length);

  return {
    id,
    title: `${source.label} health`,
    description: `How ${source.label} splits across its lifecycle states`,
    archetype: "stats",
    defaultSize: "md",
    cells: [
      {
        key: "total",
        label: "Total",
        query: { source: source.id, op: "count", status: "all" },
        link: { label: `All ${source.label}`, href: healthHref(slug) },
      },
      ...HEALTH_STATES.map(state => ({
        key: state.key,
        label: state.label,
        // 🔴 The same PREDICATE the link carries, not the lifecycle selector.
        // `status: "published"` is release-aware -- it reveals a document a due
        // release will publish and hides one it will take down -- while the
        // entry list the link opens filters the stored column. The two answer
        // differently exactly while a release is due and not yet materialised,
        // so the card would show a number the destination does not contain.
        // Asking both sides the stored-column question is what makes the number
        // checkable against the page it opens.
        query: {
          source: source.id,
          op: "count" as const,
          status: "all" as const,
          where: healthWhere(state.status),
        },
        link: {
          label: `${state.label} ${source.label}`,
          href: healthHref(slug, state.status),
        },
      })),
    ],
  };
}

/**
 * Whether a source can answer a RECENT-ENTRIES query, and what it needs to.
 *
 * 🔴 One decision, asked by both cards that draw one. The list and the table
 * put the same question to a source -- can it be listed, does a field name its
 * rows, is there an `updatedAt` for "recent" to mean anything -- and asking it
 * twice lets the two disagree about which collections support the same query.
 * A collection would then get a table and no list, or the reverse, from a
 * change to one function that nothing points at the other.
 *
 * `undefined` for a source this cannot draw HONESTLY, and each condition is a
 * refusal rather than a fallback:
 *
 * - no field names the entries, so every row would read as an identifier. The
 *   renderers already refuse a widget that selects nothing rather than guessing
 *   a key out of a document they know nothing about; generating one that
 *   selects the wrong key defeats that by answering the question badly instead
 *   of declining it.
 * - no `updatedAt`, so "recently" has nothing to sort by. Sorting by id would
 *   produce a card whose title is a claim its rows do not support.
 */
interface RecentEntries {
  /** The field that names a row, from the source's own resolution. */
  label: string;
  /** Every field name the source carries, for asking what else it has. */
  names: ReadonlySet<string>;
}

function recentEntries(source: WidgetSource): RecentEntries | undefined {
  if (!source.supports.includes("list")) return undefined;
  // The source's own answer, which already went through the shared rule with
  // the author's `admin.useAsTitle` AND the full field list. Resolving it again
  // from `fields` alone would ignore the nomination and pick a conventional
  // name instead, so a collection whose author chose `headline` would be
  // labelled by something else -- two answers to one question, and the
  // dashboard holding the worse one.
  const label = source.titleField;
  if (label === undefined) return undefined;
  const names = new Set(source.fields.map(field => field.name));
  if (!names.has("updatedAt")) return undefined;
  return { label, names };
}

/**
 * The list card for a source: the entries touched most recently.
 *
 * Returns `undefined` for a collection this cannot draw HONESTLY, and both
 * conditions are refusals rather than fallbacks:
 *
 * - no field names the entries, so every row would read as an identifier. The
 *   `list` renderer already refuses a widget that selects nothing rather than
 *   guessing a key out of a document it knows nothing about; generating one
 *   that selects the wrong key would defeat that by answering the question
 *   badly instead of declining it.
 * - no `updatedAt`, so "recently" has nothing to sort by. Sorting by id would
 *   produce a card whose title is a claim its rows do not support.
 */
function recentWidget(source: WidgetSource): WidgetDefinition | undefined {
  const recent = recentEntries(source);
  if (recent === undefined) return undefined;
  const { label } = recent;
  const id = widgetId(source, "recent");
  if (id === undefined) return undefined;

  return {
    id,
    title: `Recent ${source.label}`,
    description: `The ${source.label} entries changed most recently`,
    archetype: "list",
    defaultSize: "md",
    query: {
      source: source.id,
      op: "list",
      status: "all",
      // The row label first, then the muted line under it -- the order the
      // `list` renderer reads `select` in.
      select: [label, "updatedAt"],
      sort: "-updatedAt",
      limit: LIST_ROWS,
    },
  };
}

/**
 * The table card for a source: the same recent entries, across named columns.
 *
 * ## Why this is offered BESIDE the list rather than replacing it
 *
 * They answer different questions. A list is a column of titles with one muted
 * line under each, which suits a narrow card in a three-column dashboard. A
 * table aligns its values, so a reader compares them down a column -- which
 * status is draft, what changed most recently -- and that is what makes a
 * dashboard of collections scannable rather than a wall of separate boxes.
 * Neither is placed; a reader picks the one their dashboard wants.
 *
 * Its eligibility is `recentEntries`, the same decision the list card asks, so
 * a collection cannot end up with one of the two and not the other.
 *
 * ## Why the columns are ASKED of the source
 *
 * `status` and `updatedAt` are per-collection facts, not constants. The schema
 * pipeline injects a `status` column only for a collection declaring
 * `status: true`, and the timestamps only when it has not turned them off, so
 * the source lists exactly the ones that exist. Selecting a column the rows do
 * not carry is refused by the read path -- a refusal about a field nothing
 * declared, on a card the reader did not misconfigure.
 *
 * The result is three columns for a collection with a status and two without,
 * rather than a fixed shape padded with blanks. `defaultSize` is `lg` for the
 * same reason the renderer caps its rows: a table narrower than its content
 * scrolls inside a card, and a table that scrolls is one nobody reads.
 */
function tableWidget(source: WidgetSource): WidgetDefinition | undefined {
  const recent = recentEntries(source);
  if (recent === undefined) return undefined;
  const { label, names } = recent;
  const id = widgetId(source, "table");
  if (id === undefined) return undefined;

  return {
    id,
    title: `${source.label} table`,
    description: `Recent ${source.label} entries across their columns`,
    archetype: "table",
    defaultSize: "lg",
    query: {
      source: source.id,
      op: "list",
      status: "all",
      // Read left to right by the renderer, so the row's own name leads and the
      // timestamp the sort is on closes. `status` sits between them when the
      // collection has one.
      select: [label, ...(names.has("status") ? ["status"] : []), "updatedAt"],
      sort: "-updatedAt",
      limit: TABLE_ROWS,
    },
  };
}

/**
 * Every generated card the given sources support, in source order.
 *
 * Pure, so the derivation can be asserted without a container: the refresh
 * below is the only part that needs one.
 */
export function collectionWidgets(
  sources: readonly WidgetSource[]
): WidgetDefinition[] {
  const widgets: WidgetDefinition[] = [];
  // 🔴 Two collections can derive ONE id — `a_b` and `a-b` both reduce to
  // `a-b`. Neither has a claim over the other, and a card drawn for one while
  // its query reads the other is the worst outcome available, so a collision
  // costs BOTH collections their cards rather than silently picking a winner.
  // Collected first, dropped second, so the decision does not depend on
  // iteration order.
  const claimed = new Map<string, number>();
  const candidates: WidgetDefinition[] = [];
  for (const source of sources) {
    if (source.kind !== "collection") continue;
    for (const widget of [
      countWidget(source),
      statsWidget(source),
      recentWidget(source),
      tableWidget(source),
    ]) {
      if (!widget) continue;
      claimed.set(widget.id, (claimed.get(widget.id) ?? 0) + 1);
      candidates.push(widget);
    }
  }
  for (const widget of candidates) {
    if (claimed.get(widget.id) === 1) widgets.push(widget);
  }
  return widgets;
}

/**
 * The generated set, pinned where every other boot-time widget store is.
 *
 * On `globalThis` so it survives the module re-evaluation Next.js and Turbopack
 * perform, matching `__nextly_contributedWidgets` beside it.
 */
const globalForGenerated = globalThis as unknown as {
  __nextly_generatedWidgets?: WidgetDefinition[];
};

/** Replace the generated set. */
export function setGeneratedWidgets(
  widgets: readonly WidgetDefinition[]
): void {
  globalForGenerated.__nextly_generatedWidgets = [...widgets];
}

/** The generated set, or none when nothing has derived one yet. */
export function generatedWidgets(): WidgetDefinition[] {
  return [...(globalForGenerated.__nextly_generatedWidgets ?? [])];
}

/**
 * Re-derive the generated set from the install's current collections.
 *
 * Refreshes the SOURCES first, because the widgets are derived from them: a
 * collection created since the last request has no source yet, so deriving
 * without this produces a set one request out of date.
 */
export async function refreshCollectionWidgets(): Promise<void> {
  await refreshCollectionSources();
  setGeneratedWidgets(collectionWidgets(listSources()));
}

/**
 * The generated cards a given reader may be told about.
 *
 * 🔴 FILTERED, and by the permission rather than by anything the client does.
 * A generated card's id, title and query all name a COLLECTION, so publishing
 * the whole set discloses the slug and the existence of every collection in the
 * install to any authenticated reader — including the ones the layout endpoint
 * and the query endpoint deliberately hide from them. That the admin would not
 * draw the card is not a control: the payload is JSON, and reading it is the
 * bypass.
 *
 * 🔴 And a card whose id a CONTRIBUTION already claims is dropped. The admin
 * reads this array as the registration channel, and `mergeCollision` gives a
 * registration authority over the title, archetype, query, size and permission
 * of a colliding contribution — so publishing a generated card under an id a
 * plugin declared would replace that plugin's card with core's guess in the
 * grid, while the server's canonical set kept the plugin's. The two would draw
 * and place different declarations. `canonicalWidgets` already resolves this
 * collision in the contribution's favour; this is the same answer, not a second
 * one.
 *
 * 🔴 A generated card carries NO `requiredPermission`, and the server is what
 * gates it. The permission the client could check is `read-<slug>` read off the
 * flat `/me/permissions` list, and that list does not hold a grant that exists
 * only in a collection's code-defined `access.read` — so a reader the server
 * approved had both cards discarded by the grid, for a query it would have
 * answered. One gate, on the side that can see every rule.
 *
 * 🔴 `allow` is asked about the COLLECTION, and the difference is an API key. `callerHoldsPermission` judges a
 * key on its stamped grant alone, while `canReadEntity` — which the widget query
 * endpoint uses — also evaluates the collection's code-defined `access.read`. A
 * key stamped `read-secret` that those rules reject is refused by the query and
 * would have been told the collection exists by this payload. The two must
 * answer the same question, so this one asks the query path's.
 *
 * Asked once per distinct collection by the caller, which batches those
 * decisions — asking here per widget would fire two checks for every one.
 */
export function readableGeneratedWidgets(
  allow: (collectionSlug: string) => boolean,
  declaredIds: ReadonlySet<string>
): WidgetDefinition[] {
  return generatedWidgets().filter(widget => {
    if (declaredIds.has(widget.id)) return false;
    const slug = generatedCollectionSlug(widget);
    // A generated card that names no collection cannot be checked against one,
    // so it is withheld rather than published. This is unreachable today --
    // every card here is built from a `collection:` source -- and the branch is
    // free: it decides from a value already in hand, and refusing is the only
    // safe answer for a card whose subject cannot be identified.
    return slug !== undefined && allow(slug);
  });
}

/**
 * The collection a generated card is about, taken from the query it will run.
 *
 * From `query.source` rather than by unpicking the widget id, because the
 * source is what the read is actually performed against — the id is a display
 * identity that happens to be derived from the same slug, and checking access
 * against a name rather than against the thing being read is how the two come
 * apart.
 */
function collectionOf(source: unknown): string | undefined {
  if (typeof source !== "string") return undefined;
  const prefix = "collection:";
  return source.startsWith(prefix) ? source.slice(prefix.length) : undefined;
}

export function generatedCollectionSlug(
  widget: WidgetDefinition
): string | undefined {
  // 🔴 Read from the CELLS as well as the top-level query. A `stats` card has
  // no `query` of its own, so deriving from that field alone answered
  // `undefined` for every health card -- and `readableGeneratedWidgets`
  // withholds a card whose subject it cannot identify, which is the correct
  // refusal applied to a wrong answer. The cards were generated, registered,
  // and then silently never published.
  const sources = widget.query
    ? [widget.query.source]
    : (widget.cells ?? []).map(cell => cell.query.source);
  if (sources.length === 0) return undefined;

  const slugs = sources.map(collectionOf);
  // Every cell must name the SAME collection. A card reading two of them cannot
  // be gated by one permission, so it is refused rather than checked against
  // whichever slug happened to come first -- the access decision and the rows
  // would then be about different collections.
  const [first] = slugs;
  if (first === undefined) return undefined;
  return slugs.every(slug => slug === first) ? first : undefined;
}
