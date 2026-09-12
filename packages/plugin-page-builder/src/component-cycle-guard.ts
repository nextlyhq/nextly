/**
 * Refusing a component write that would make the library reference itself.
 *
 * A component may place other components, so the library is a directed graph.
 * Closing a loop in it is not a crash — the resolver detects one, draws what it
 * reached, and leaves a single unresolved node where the loop closes — but that
 * is a gap in the middle of otherwise-correct content, on every page placing
 * anything on the loop.
 *
 * ## Why this refuses where the readiness notice reports
 *
 * `component-readiness-hook.ts` is the other write-time rule in this plugin and
 * it never refuses. Its reasons do not transfer. It runs post-commit, where a
 * throw is filed as a side-effect warning rather than as a refusal; and the
 * state it reports — a page published before its components — is an ordinary
 * step an author is about to leave anyway.
 *
 * Neither holds here. `beforeChange` runs while the write can still be
 * refused, and a loop is not a step towards anything. The asymmetry that
 * decides it is WHO SEES THE DAMAGE: an author publishing a page early is shown
 * their own page with a hole in it, so the mistake and the person who can fix
 * it are in the same place. An author saving a component that closes a loop is
 * shown nothing at all — the gap appears afterwards, on pages other people own.
 * A notice there is a warning nobody is positioned to act on.
 *
 * ## Why a live walk rather than the usage index
 *
 * `nx_pb_component_usage` holds component-to-component edges and looks like the
 * adjacency table this wants. Its maintenance runs POST-COMMIT and can
 * undercount — a document that still references something reading as
 * referencing nothing — and an undercount here is a MISSED cycle, so the index
 * is permissive in exactly the concurrent case this guard exists for. It can be
 * an optimisation once that is closed; it cannot be the boundary.
 *
 * ## What this does NOT close, stated rather than implied
 *
 * A write that runs NO USER HOOKS. `skipHooks: true` is a documented import
 * option, and the transaction writers set `runHooks: !skipHooks` over the whole
 * collection-level and field-level phase — so the high-performance import path
 * can store a component referencing itself without this handler being called at
 * all, and ordinary document validation does not look across rows. Nothing a
 * plugin can register closes that: the invariant needs a write boundary that is
 * not skippable, which is a core capability rather than a hook. Recorded as
 * `finding:cycle-guard-is-skippable-by-import` with what it would take.
 *
 * Two saves closing a loop between them AT THE SAME MOMENT. This walk runs
 * before its own write commits and takes no lock the other write contends for,
 * and a plugin hook has no transaction to enlist in — the same window
 * `layout-component-guard.ts` records for its own scan. What it removes is the
 * ordinary case, which is a save made against a library read that has since
 * gone stale; what remains is a true simultaneity, and closing that needs a
 * boundary the two writes share.
 *
 * A later hook REPLACING the document after this has approved it. This is a
 * collection-level `beforeChange` handler, and core is not finished
 * transforming at that point: `runBeforeChange` applies a stored hook's result
 * after the code hooks, and the mutation service then runs the field-level
 * `beforeChange` phase over "the final stored value". Either can write a
 * document this never saw. No plugin can be last — `HOOK_TYPES` declares no
 * phase after that field pass — so what this covers is the document as
 * submitted, and closing the rest needs a core phase that runs once every
 * transform has produced the value being written.
 *
 * A LOCALIZED component store. These reads name no locale, so they answer in
 * the default language; a component whose French document references what its
 * default one does not would not be seen. Covering it means reading every
 * configured locale, which multiplies the reads per save by the locale count,
 * and that cost is worth deciding deliberately rather than absorbing here.
 *
 * @module component-cycle-guard
 */
import {
  componentReach,
  componentReachIn,
  componentReferencesFrom,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ClassUsageDirectApi } from "./class-usage-runtime";

/**
 * How many DISTINCT components one walk will read before giving up.
 *
 * A bound on the reads, which nothing else supplies: the walk follows only what
 * the saved document reaches, and that is normally a handful, but a library is
 * sized at three thousand entries and nothing stops one component reaching a
 * large share of them. Each is read twice (below), so this is the number of
 * components rather than of requests.
 *
 * Exceeding it REFUSES, because a prefix of the graph that did not meet the
 * subject is exactly what a graph with no loop looks like. That is the
 * expensive direction of the fail-closed choice and it is deliberate: the other
 * one admits the loop this exists to stop.
 */
const MOST_COMPONENTS_READ = 100;

/** The Direct API surface this needs, aliased rather than described again. */
export type CycleGuardDirectApi = ClassUsageDirectApi;

/** The plugin context this needs, named structurally. */
export interface CycleGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** What one registration needs to know. */
export interface CycleGuardOptions {
  ctx: CycleGuardContext;
  /** The RESOLVED slug components are stored under; a host may rename it. */
  componentsCollection: string;
  /** The field on that collection holding the component's document. */
  documentField: string;
  /** The site's caps, so the walk reads a document under the same bound the canvas does. */
  limits: DocumentLimits;
}

/**
 * Refuse a component write that closes a reference cycle.
 *
 * Registered on the components collection by name rather than on the wildcard:
 * this asks one question about one collection, and a wildcard registration
 * would walk the component graph on every write the site performs.
 */
export function registerComponentCycleGuard(options: CycleGuardOptions): void {
  options.ctx.hooks.on("beforeChange", options.componentsCollection, context =>
    refuseACycle(options, context)
  );
}

/** One write, refused or allowed to proceed. */
async function refuseACycle(
  options: CycleGuardOptions,
  context: unknown
): Promise<void> {
  const self = subjectOf(context);
  // Nothing addressable. Left alone rather than refused: a CREATE has no stored
  // row, and the id it will be stored under is minted by the write itself — so
  // it is not a row anything can already reference and no chain can lead back
  // to it. See {@link subjectOf} for why a supplied id is not that id.
  if (self === null) return;

  // Carries no document AND promotes nothing, so it cannot move an edge. A bulk
  // rename or a metadata edit is this. Whether a malformed value is a legal one
  // is the field's own validation to answer, and refusing here would report a
  // shape problem as a reference problem.
  //
  // The status this write will persist decides BOTH which forms it reaches and
  // whether a document-less write is graph-neutral.
  const submitted = submittedDocument(context, options);
  const next = nextStatusOf(context);
  if (submitted === "not-a-document" && next === undefined) return;

  // AFTER the checks above, so a write that cannot change the reference graph is
  // not refused for being in a transaction. None of them needs a graph read, so
  // none of them is refused.
  //
  // For a write that DOES need one, the transaction is a refusal rather than a
  // skip: the Direct API takes no executor, so a read here checks out a second
  // connection and waits on the one the open transaction holds — while that
  // transaction waits on this hook. Skipping instead would let exactly the
  // writes this exists for through, on the path that writes many at once.
  if (insideACallerTransaction(context)) {
    throw refusal(
      `This component cannot be saved in a bulk operation, because whether it ` +
        `would end up referencing itself cannot be checked safely there. Save ` +
        `it on its own and the check will run.`
    );
  }

  const nextly = directApiOf(context);
  // No Direct API to ask with. A guard that refused every write it could not
  // evaluate would make the collection unwritable on any path that shapes its
  // context differently, and this is a data-integrity guard rather than an
  // authorisation one.
  if (nextly === null) return;

  // A status-only publish carries no document of its own and is NOT graph-
  // neutral: core promotes the whole pending working draft into the live row
  // (`draft-published-split.integration.test.ts`, "promotes the whole working
  // draft to the live row when the publish omits its fields"). What goes live is
  // that draft, so that is the document to judge — a cycle written into a draft
  // before this guard existed, or through a write that skipped it, would
  // otherwise reach the live library on a publish this never inspected.
  const promoted =
    submitted === "not-a-document"
      ? await pendingDocument(self, options, nextly)
      : ({ kind: "document", document: submitted.document } as const);
  // No pending document to promote after all. Nothing changes and nothing is
  // judged, rather than a refusal for a row this could not find.
  if (promoted.kind === "absent") return;
  if (promoted.kind === "unreadable") {
    throw refusal(
      `This component cannot be saved: its own stored document could not be ` +
        `read, so whether it would end up referencing itself could not be ` +
        `established.`
    );
  }
  const document = promoted.document;

  await refuseIfReached({
    options,
    nextly,
    self,
    document,
    forms: formsChangedBy(next),
  });
}

/** Walk each named form, and refuse on the first that does not come back clean. */
async function refuseIfReached(args: {
  options: CycleGuardOptions;
  nextly: CycleGuardDirectApi;
  self: string;
  document: unknown;
  forms: readonly boolean[];
}): Promise<void> {
  const { options, nextly, self, document, forms } = args;
  for (const draft of forms) {
    // One reader per FORM. A component's published and draft documents are
    // different documents, so a cache shared across the two would answer the
    // second walk with the first one's reading.
    const read = documentReader(options, nextly, draft);
    const places = await reachableFrom(document, options, read);
    const graph = await placementsReachedFrom(places, options, read);
    const verdict = componentReach({
      places,
      self,
      placedBy: id => graph.get(id),
    });
    if (verdict.kind === "none") continue;
    if (verdict.kind === "unknown") {
      throw refusal(
        `This component cannot be saved: the components it uses could not all ` +
          `be read, so whether it would end up referencing itself could not be ` +
          `established.`
      );
    }
    throw refusal(
      `This component cannot be saved because it would reference itself: ` +
        `${namedPath(verdict.path, places, self)}. Remove that placement and ` +
        `save again.`
    );
  }
}

/**
 * The loop as the SAVING AUTHOR may be told it.
 *
 * The walk reads with `overrideAccess: true`, because a component this author
 * cannot see still renders and a chain through it still closes. The MESSAGE
 * cannot inherit that: printing every id in a system-level path tells a caller
 * who may update A the identifier of a component they are denied read access to,
 * for the price of one save they already know will fail.
 *
 * What survives is what the author demonstrably already holds — the subject, and
 * the ids their own submitted document places. They wrote those. Everything
 * reached BEYOND them came from a read made as the system, and collapses to a
 * single `…` however many components it spans, so the shape of the private part
 * of the graph is not reported either.
 *
 * The actionable half is kept by construction: the placement to remove is the
 * first hop, and the first hop is always one of their own.
 */
function namedPath(
  path: readonly string[],
  places: readonly string[] | undefined,
  self: string
): string {
  const own = new Set([self, ...(places ?? [])]);
  const shown: string[] = [];
  for (const id of path) {
    if (own.has(id)) {
      shown.push(id);
      continue;
    }
    // One ellipsis per RUN, so a chain through six private components reads as
    // one gap rather than counting them out.
    if (shown[shown.length - 1] !== "…") shown.push("…");
  }
  return shown.join(" → ");
}

/**
 * Which lifecycle forms this write actually changes, as `draft` flags.
 *
 * Each form on its OWN, never as one graph. A component's published and draft
 * documents are alternatives: only one of them is what a reader receives at any
 * moment. Unioning their edges invents chains that exist in neither — published
 * B naming C while DRAFT C names A yields A → B → C → A out of two references
 * that are never live together — and refuses a save that closes nothing.
 *
 * And only the forms this write REACHES, which is the second half of the same
 * rule. Core decides that from whether the payload names a status, and the two
 * cases are disjoint on it (`collection-mutation-service.ts` calls the predicate
 * `namesNoStatus`):
 *
 * - **No status named.** The incoming document is stored as a working draft and
 *   THE LIVE ROW IS LEFT UNTOUCHED. Judging the incoming placements against the
 *   live graph as well refuses a save that closes nothing: live B naming A while
 *   B's own draft is empty makes A → live B → A out of an edge the preview
 *   never has and a document the live row never receives.
 * - **`status: "published"`.** Core writes the live row and promotes any pending
 *   draft into it, consuming the draft — so both forms end up holding that
 *   document and both are judged.
 * - **`status: "draft"`, an UNPUBLISH.** Core writes the live row and consumes
 *   the draft the same way, but the row is no longer publicly resolvable, so the
 *   component leaves the public graph rather than joining it with new edges. A
 *   reader following a chain into it gets a missing-component placeholder, not a
 *   loop. Judging the published graph here refuses an unpublish that closes
 *   nothing: published B naming A, with B's own draft empty, yields
 *   A → published B → A out of a document no public read can reach.
 *
 * Where the split is NOT in force for this collection a status-less write goes
 * straight to the live row, and this would then judge the wrong form. It does
 * not, and no second predicate is needed for it: with no working drafts to
 * overlay, a `draft: true` read answers with the live row for every component,
 * so the preview graph IS the live graph and judging one judges both.
 */
function formsChangedBy(next: string | undefined): readonly boolean[] {
  return next === "published" ? [false, true] : [true];
}

/**
 * The document a write that promotes will put live, for one carrying none.
 *
 * Read through the same overlay a preview does — core's own words for it are
 * "the overlay returns the draft (or the live row when none exists)" — so a
 * publish with no pending draft judges the live document it is re-publishing.
 * That costs one read and answers `none` for any library without a loop, which
 * is the cheap direction; the alternative is not noticing a promoted cycle.
 */
async function pendingDocument(
  self: string,
  options: CycleGuardOptions,
  nextly: CycleGuardDirectApi
): Promise<ReadDocument> {
  return readComponent(self, options, nextly, true);
}

/**
 * Whether this write names a status, and so reaches the live row.
 *
 * The VALUE rather than the key, which is what core reads: `intendedStatus` is
 * `finalData.status` and the transition is skipped where that is `undefined`, so
 * a payload carrying the key with no value is status-less to core and must be
 * status-less here.
 *
 * Read at this moment, which is the same limit the module header already records
 * for the document: a later `beforeChange` handler can add or remove `status`
 * after this has judged, and no plugin can be last.
 */
function nextStatusOf(context: unknown): string | undefined {
  const data = fieldOf(context, "data");
  if (data === undefined) return undefined;
  const status = data.status;
  return typeof status === "string" ? status : undefined;
}

/**
 * Every component reachable from these in ONE lifecycle form, and what each of
 * them places.
 *
 * Read as the SYSTEM. A component the saving author cannot see still renders on
 * the page, so a chain running through it is a chain that closes; read as the
 * author it would be invisible and the loop would be permitted.
 *
 * One FORM per walk, never both folded together — see the caller. The published
 * and draft documents of one component are alternatives, and a chain assembled
 * out of edges from each is a chain no reader ever receives.
 *
 * An id left OUT of the map is one this could not establish, which
 * {@link componentReach} reads as `unknown` rather than as placing nothing.
 * That is the whole mechanism for the bound and for an unreadable row: neither
 * needs a second rule here.
 */
async function placementsReachedFrom(
  places: readonly string[] | undefined,
  options: CycleGuardOptions,
  read: DocumentReader
): Promise<Map<string, readonly string[]>> {
  const graph = new Map<string, readonly string[]>();
  if (places === undefined) return graph;

  const pending = [...places];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.shift();
    if (id === undefined || seen.has(id)) continue;
    if (seen.size >= MOST_COMPONENTS_READ) return graph;
    seen.add(id);

    const read_ = await read(id);
    // A component nobody supplied places nothing further, and the resolver
    // draws it as missing. That is not a loop.
    if (read_.kind === "absent") {
      graph.set(id, []);
      continue;
    }
    if (read_.kind === "unreadable") continue;

    const named = await reachableFrom(read_.document, options, read);
    if (named === undefined) continue;
    graph.set(id, named);
    pending.push(...named);
  }
  return graph;
}

/**
 * Every component ONE document can reach, placements included.
 *
 * Three sources, and the third is the one no single-document scan has:
 *
 * 1. the ids its nodes carry;
 * 2. the ids its own VARIANTS can install on those nodes;
 * 3. the ids each of its placing NODES installs on the definition IT PLACES.
 *
 * The third needs the placed definition, because an override names an exposure
 * id and only that definition says which node and prop path the id writes to.
 * So this reads one level ahead — through the same cache the walk uses, so a
 * definition read here is not read again when the walk reaches it.
 *
 * `undefined` where any of it could not be established, which the walk reads as
 * unknown rather than as placing nothing.
 */
async function reachableFrom(
  document: unknown,
  options: CycleGuardOptions,
  read: DocumentReader
): Promise<readonly string[] | undefined> {
  // ONE walk for both the ids and the nodes that name them. A prefix of either
  // is a prefix of the answer, and the missing tail is exactly where an
  // unnoticed edge would be.
  const survey = componentReachIn(document, options.limits.maxNodes);
  if (!survey.complete) return undefined;

  const ids = new Set<string>(survey.ids);
  for (const placement of survey.placements) {
    const target = await read(placement.target);
    // A placement of something nobody supplied installs nothing: there is no
    // definition to write an exposure onto, and the resolver draws the node as
    // missing.
    if (target.kind === "absent") continue;
    if (target.kind === "unreadable") return undefined;
    for (const id of componentReferencesFrom(target.document, placement.node)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * One form of one component's stored document, or why it is not available.
 *
 * A discriminated result rather than the document with sentinels beside it: a
 * stored document is `unknown`, and a union with `unknown` in it collapses to
 * `unknown` — so every sentinel comparison would type-check against anything.
 */
type ReadDocument =
  | { readonly kind: "document"; readonly document: unknown }
  /** No such row. The resolver draws a placement of it as missing, not as a loop. */
  | { readonly kind: "absent" }
  /** Read, and not establishable as this component's document. */
  | { readonly kind: "unreadable" };

/** Reads one component's document, once per walk. */
type DocumentReader = (id: string) => Promise<ReadDocument>;

/**
 * Reads each component's document ONCE per walk.
 *
 * The cache is what keeps the placement pass affordable: computing a document's
 * edges reads every definition it places, and the walk then visits those same
 * definitions. Without it a library where many components place one shared
 * component would read that component once per placement.
 *
 * It also makes the answer consistent. A definition read twice in one walk could
 * come back differently — a concurrent write, a hook answering from a cache —
 * and a graph assembled from two readings of one component is a graph no reader
 * ever receives.
 */
function documentReader(
  options: CycleGuardOptions,
  nextly: CycleGuardDirectApi,
  draft: boolean
): DocumentReader {
  const held = new Map<string, ReadDocument>();
  return async id => {
    const seen = held.get(id);
    if (seen !== undefined) return seen;
    const read = await readComponent(id, options, nextly, draft);
    held.set(id, read);
    return read;
  };
}

/**
 * One form of one component: what it places, absent, or unreadable.
 *
 * A read that raises NOT FOUND is ABSENCE rather than failure. The Direct API
 * throws for a missing row unless errors are disabled, and a saved document
 * referencing a component somebody deleted is an ordinary state the renderer
 * draws as a missing-component placeholder. Read as unreadable it would make the
 * graph unknown and refuse every save of that component until the reference was
 * taken out by hand.
 *
 * The returned row must also BE the component asked for. A by-id read is not
 * guaranteed to answer with the row requested — a `beforeOperation` hook can
 * rewrite the id the query uses and an `afterRead` hook can replace the
 * response — so a redirected lookup for one component could answer with an
 * unrelated acyclic row, and the loop through the real one would be approved.
 */
async function readComponent(
  id: string,
  options: CycleGuardOptions,
  nextly: CycleGuardDirectApi,
  draft: boolean
): Promise<ReadDocument> {
  let row: unknown;
  try {
    row = await nextly.findByID({
      collection: options.componentsCollection,
      id,
      // Every lifecycle state. A draft-only component is one an author can
      // still place from the panel, so a chain through it is a real chain.
      status: "all",
      draft,
      // The document is read off the row itself; expanding relationships would
      // fetch every referenced row's whole content for a value this discards.
      depth: 0,
      overrideAccess: true,
    });
  } catch (error) {
    if (NextlyError.isNotFound(error)) return { kind: "absent" };
    // Anything else establishes nothing, which is not the same as a row that is
    // not there.
    return { kind: "unreadable" };
  }
  if (row === null || row === undefined) return { kind: "absent" };
  if (!isRowFor(row, id)) return { kind: "unreadable" };
  if (typeof row !== "object") return { kind: "unreadable" };
  // The DOCUMENT, not the ids it names. What a document reaches depends on the
  // definitions it places, so the caller resolves that with every read in hand.
  return {
    kind: "document",
    document: (row as Record<string, unknown>)[options.documentField],
  };
}

/**
 * Whether a returned row is the component that was asked for.
 *
 * Equality on the id, and nothing else satisfies it — a row carrying NO `id` at
 * all included. The looser rule this replaced accepted a key-less row on the
 * grounds that the read was addressed by id anyway, and that is the case an
 * `afterRead` hook can manufacture: a lookup for B retargeted to an acyclic C
 * whose response omits `id` would be read as B's placements, and the chain
 * through the real B approved.
 *
 * The same package already decided this, in the same direction, for the same
 * reason. `recordOf` in `class-usage-runtime.ts` requires `record.id ===
 * subject.entityKey` and says why in its own docblock: a read hook can retarget
 * the query and another can rewrite the answer, so a response that cannot be
 * confirmed as the subject's is refused rather than used. Two rules for one
 * question is how they come to disagree.
 *
 * The cost is the one that docblock names: a components collection whose
 * `afterRead` strips or rewrites `id` cannot have this guard evaluated, and
 * every save on it is refused for an unreadable graph. That is a loud,
 * diagnosable refusal rather than a silently approved cycle.
 */
function isRowFor(row: unknown, id: string): boolean {
  if (typeof row !== "object" || row === null) return false;
  return (row as Record<string, unknown>).id === id;
}

/**
 * The document this write carries, or `"not-a-document"` where it carries none.
 *
 * The incoming value rather than the stored one, which is the point of asking at
 * write time: the stored copy is the version being replaced, and it is the new
 * placements that can close a loop.
 *
 * The DOCUMENT rather than the ids it names, because what a document reaches
 * depends on the definitions it places — see {@link reachableFrom}.
 */
function submittedDocument(
  context: unknown,
  options: CycleGuardOptions
): { readonly document: unknown } | "not-a-document" {
  const data = fieldOf(context, "data");
  if (data === undefined) return "not-a-document";
  if (!Object.hasOwn(data, options.documentField)) return "not-a-document";
  const document = data[options.documentField];
  if (typeof document !== "object" || document === null) {
    return "not-a-document";
  }
  const nodes = (document as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return "not-a-document";
  // Wrapped, because a bare `unknown` in a union with the sentinel collapses to
  // `unknown` and every comparison against it would then type-check.
  return { document };
}

/**
 * The id this write will be stored under, or `null` when there is no such id
 * yet.
 *
 * The STORED row only. An update carries it as `originalData`, and the incoming
 * data is a patch that need not repeat it.
 *
 * `data.id` is deliberately NOT a fallback, and that is not an omission. A
 * client-supplied id is never the identity a row is stored under: every write
 * path spreads `stripImmutableSystemFields(finalData, "collection")` over a
 * freshly generated `id`, and `id` is declared `writableByClient: false`, so the
 * value is discarded on create and on update alike. Judging a create against it
 * refuses a real chain that happens to run through whatever the caller typed,
 * while the row being written gets an id nothing references — a refusal whose
 * reported path names a component the author never placed.
 *
 * So a CREATE is left alone entirely. Nothing can already reference an id the
 * write is about to mint, so no chain can lead back to it and there is no cycle
 * a create can close.
 */
function subjectOf(context: unknown): string | null {
  const original = fieldOf(context, "originalData");
  return original === undefined ? null : idIn(original);
}

/** A usable id on a record, or null. */
function idIn(record: Record<string, unknown>): string | null {
  const id = record.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** One record-valued field of the hook context. */
function fieldOf(
  context: unknown,
  name: string
): Record<string, unknown> | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const value = (context as Record<string, unknown>)[name];
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

/** Whether this hook is running inside a transaction its caller owns. */
function insideACallerTransaction(context: unknown): boolean {
  return (
    typeof context === "object" &&
    context !== null &&
    (context as { executor?: unknown }).executor !== undefined
  );
}

/** The Direct API the request carries, or null. */
function directApiOf(context: unknown): CycleGuardDirectApi | null {
  const req = fieldOf(context, "req");
  if (req === undefined) return null;
  const nextly = req.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as CycleGuardDirectApi)
    : null;
}

/**
 * A refusal an author actually sees.
 *
 * A typed CONFLICT rather than a bare `Error`: the mutation service files an
 * untyped throw as a code-less failure and the envelope rebuilds it as an
 * internal error, so the author would be shown the generic unexpected-error
 * message and none of the chain named here.
 */
function refusal(message: string): Error {
  return NextlyError.conflict({ message });
}
