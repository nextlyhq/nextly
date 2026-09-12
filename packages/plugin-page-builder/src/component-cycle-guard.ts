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
  componentUsageIn,
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
  // Nothing addressable. Left alone rather than refused: a create whose id the
  // store has not minted yet is not a row anything can reference, so no chain
  // can lead back to it.
  if (self === null) return;

  const places = placesOf(context, options);
  // Not a document this can read. Whether the value is a legal one is the
  // field's own validation to answer, and refusing here would report a shape
  // problem as a reference problem.
  if (places === "not-a-document") return;

  // AFTER the two checks above, so a write that cannot change the reference
  // graph is not refused for being in a transaction. A bulk rename, a metadata
  // edit or a status change carries no document, and a bulk create with no id
  // has nothing to close a loop onto — none of them needs a graph read, so none
  // of them is refused.
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

  // Each lifecycle form on its OWN, never as one graph. A component's published
  // and draft documents are alternatives: only one of them is what a reader
  // receives at any moment. Unioning their edges invents chains that exist in
  // neither — published B naming C while DRAFT C names A yields A → B → C → A
  // out of two references that are never live together — and refuses a save
  // that closes nothing.
  for (const draft of [false, true]) {
    const graph = await placementsReachedFrom(places, options, nextly, draft);
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
        `${verdict.path.join(" → ")}. Remove that placement and save again.`
    );
  }
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
  nextly: CycleGuardDirectApi,
  draft: boolean
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

    const named = await readComponent(id, options, nextly, draft);
    // A component nobody supplied places nothing further, and the resolver
    // draws it as missing. That is not a loop.
    if (named === "absent") {
      graph.set(id, []);
      continue;
    }
    if (named === undefined) continue;
    graph.set(id, named);
    pending.push(...named);
  }
  return graph;
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
): Promise<readonly string[] | "absent" | undefined> {
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
    if (NextlyError.isNotFound(error)) return "absent";
    // Anything else establishes nothing, which is not the same as a row that is
    // not there.
    return undefined;
  }
  if (row === null || row === undefined) return "absent";
  if (!isRowFor(row, id)) return undefined;
  return usageIn(row, options);
}

/**
 * Whether a returned row is the component that was asked for.
 *
 * A row carrying no `id` KEY is accepted: field-level access can drop it from a
 * presentation, and the read was still addressed by id. A row that HAS the key
 * answered with an identity, and the only identity that satisfies this is the
 * one requested — anything else is a redirected or replaced response, which
 * cannot stand in for the component whose references are being judged.
 */
function isRowFor(row: unknown, id: string): boolean {
  if (typeof row !== "object" || row === null) return false;
  const record = row as Record<string, unknown>;
  if (!Object.hasOwn(record, "id")) return true;
  return record.id === id;
}

/** The ids a stored row's document places, under the site's cap. */
function usageIn(
  row: unknown,
  options: CycleGuardOptions
): readonly string[] | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const document = (row as Record<string, unknown>)[options.documentField];
  if (typeof document !== "object" || document === null) return [];
  const nodes = (document as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const usage = componentUsageIn(nodes, options.limits.maxNodes);
  return usage.complete ? usage.ids : undefined;
}

/**
 * What the document being SAVED places, `undefined` where the cap could not
 * read it whole, and `"not-a-document"` where the write carries no document at
 * all.
 *
 * The incoming value rather than the stored one, which is the point of asking
 * at write time: the stored copy is the version being replaced, and it is the
 * new placements that can close a loop.
 */
function placesOf(
  context: unknown,
  options: CycleGuardOptions
): readonly string[] | undefined | "not-a-document" {
  const data = fieldOf(context, "data");
  if (data === undefined) return "not-a-document";
  if (!Object.hasOwn(data, options.documentField)) return "not-a-document";
  const document = data[options.documentField];
  if (typeof document !== "object" || document === null) {
    return "not-a-document";
  }
  const nodes = (document as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return "not-a-document";
  const usage = componentUsageIn(nodes, options.limits.maxNodes);
  return usage.complete ? usage.ids : undefined;
}

/**
 * The id this write will be stored under, or `null` when the write does not
 * name one.
 *
 * An UPDATE carries the stored row as `originalData`, which is where the id
 * comes from: the incoming data is a patch and need not repeat it. A CREATE has
 * no stored row, and an id only where the caller supplied one — a create whose
 * id the store mints later is not a row anything can already reference, so
 * there is no chain for it to close.
 */
function subjectOf(context: unknown): string | null {
  const original = fieldOf(context, "originalData");
  const fromStored = original === undefined ? null : idIn(original);
  if (fromStored !== null) return fromStored;
  const data = fieldOf(context, "data");
  return data === undefined ? null : idIn(data);
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
