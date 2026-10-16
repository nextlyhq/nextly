/**
 * Refusing a component save that would make the library reference itself.
 *
 * A component may place other components, so the library is a directed graph.
 * Closing a loop in it is not a crash — the resolver detects one, draws what it
 * reached, and leaves a single unresolved node where the loop closes — but that
 * is a gap in the middle of otherwise-correct content, on every page placing
 * anything on the loop.
 *
 * ## Why it refuses, rather than reporting
 *
 * The asymmetry that decides it is WHO SEES THE DAMAGE. An author publishing a
 * page before its components is shown their own page with a hole in it, so the
 * mistake and the person who can fix it are in the same place. An author saving
 * a component that closes a loop is shown nothing at all — the gap appears
 * afterwards, on pages other people own. A notice there is a warning nobody is
 * positioned to act on.
 *
 * ## Where it runs
 *
 * In the blocks field's validation, which every write path runs — the editor,
 * the API, a batch, and an import that skips hooks. A hook would not do: an
 * import that skips hooks never calls one, and a hook has no read on the
 * write's own transaction, so two rows of one batch could each pass against a
 * library without the other.
 *
 * Validation hands it the write's id and a read of stored component documents
 * on that write's connection (`PluginFieldWrite.readStored`), so the library
 * this judges is the one the write sees: rows the same batch wrote are in it,
 * and no read hook or access rule hides a component that still renders.
 *
 * ## Why a live walk rather than the usage index
 *
 * `nx_pb_component_usage` holds component-to-component edges and looks like the
 * adjacency table this wants. Its maintenance runs POST-COMMIT and can
 * undercount — a document that still references something reading as
 * referencing nothing — and an undercount here is a MISSED cycle, so the index
 * is permissive in exactly the concurrent case this exists for. It can be an
 * optimisation once that is closed; it cannot be the boundary.
 *
 * ## What this does NOT close, stated rather than implied
 *
 * Two saves closing a loop between them AT THE SAME MOMENT, in two separate
 * transactions. Each reads the library as committed before the other, and
 * nothing serializes them; closing that needs a lock the two writes share.
 *
 * A `beforeChange` hook REPLACING the document after validation has judged it.
 * Core validates before that phase, so what this covers is the document as
 * validated.
 *
 * A LOCALIZED component store. The read is refused for a localized field, so
 * such a store answers "unreadable" and every save of it is refused — loudly,
 * rather than judging the default language alone.
 *
 * @module component-cycle-guard
 */
import {
  componentReach,
  componentReachIn,
  componentReferencesFrom,
  resolveComponentInstances,
  variantNamesIn,
  type ComponentReach,
  type DocumentLimits,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import {
  composeWithReads,
  documentReader,
  heldLibrary,
  hostPlacing,
  STOPPED_SHORT,
  type ComponentSource,
  type DocumentReader,
  type HeldLibrary,
} from "./composition-reading";

/**
 * What composing the subject established, as three facts rather than two.
 *
 * `indeterminate` is the one a boolean loses: a composition that could not be
 * finished — a definition the reader could not supply, a budget spent — has
 * shown nothing, and reading it as `none` would let an unreadable library clear
 * a loop the walk had already proven.
 */
type CompositionVerdict = "cycle" | "none" | "indeterminate";

/** Where the components live, as the write path addresses them. */
export interface ComponentStoreAddress {
  /** The RESOLVED slug components are stored under; a host may rename it. */
  readonly collection: string;
  /** The field on that collection holding the component's document. */
  readonly field: string;
}

/**
 * Component documents read through a write's own connection.
 *
 * A read that fails for any reason establishes nothing, which is not the same
 * as a row that is not there — so it answers `unreadable`, and the walk refuses
 * rather than reading the gap as "places nothing".
 */
export function storedComponentSource(
  write: PluginFieldWrite,
  store: ComponentStoreAddress
): ComponentSource {
  return async (id, draft) => {
    try {
      const read = await write.readStored({
        collection: store.collection,
        id,
        field: store.field,
        form: draft ? "draft" : "published",
      });
      return read.kind === "absent"
        ? { kind: "absent" }
        : { kind: "document", document: read.value };
    } catch {
      return { kind: "unreadable" };
    }
  };
}

/** The judgement's own settings: the caps every walk and composition read under. */
interface CycleGuardOptions {
  readonly limits: DocumentLimits;
}

/** What one save asks: which component, what it stores, and how it is read. */
export interface CycleQuestion {
  /** The id the component is stored under. */
  readonly self: string;
  /** The document this write stores. */
  readonly document: unknown;
  /** The status the write names, which decides the lifecycle forms it changes. */
  readonly nextStatus: string | undefined;
  readonly source: ComponentSource;
  /** The site's caps, so the walk reads a document under the same bound the canvas does. */
  readonly limits: DocumentLimits;
  /**
   * The save's ONE allowance, shared with every other composition the save
   * performs, so the bound is on the save rather than on each check.
   */
  readonly work: WorkAllowance;
}

/**
 * The sentence refusing this save, or `null` when it closes no loop.
 *
 * A document that is not a forest names nothing, so it closes nothing: whether
 * it is a legal value is the field's own validation to answer, and refusing here
 * would report a shape problem as a reference problem.
 */
export async function componentCycleRefusal(
  question: CycleQuestion
): Promise<string | null> {
  const { self, document, source, limits, work } = question;
  if (!isForest(document)) return null;
  try {
    // Decided from the document in hand, before any read: the one loop that
    // takes no library to see costs nothing to refuse.
    const options: CycleGuardOptions = { limits };
    refuseASelfReference({ document }, self, options, work);
    await refuseIfReached({
      options,
      source,
      self,
      document,
      forms: formsChangedBy(question.nextStatus),
      work,
    });
    return null;
  } catch (error) {
    if (error instanceof CycleRefusal) return error.message;
    throw error;
  }
}

/** Whether a value carries a forest the composition can walk. */
function isForest(document: unknown): boolean {
  return (
    typeof document === "object" &&
    document !== null &&
    Array.isArray((document as { nodes?: unknown }).nodes)
  );
}

/**
 * Refuse a submitted document that closes a loop on the subject by itself.
 *
 * Separate from the walk because it needs no library at all, so it runs before
 * the first read: a document that names itself is refused for the price of the
 * document already in hand.
 *
 * The chain is the subject twice over, so there is nothing to redact: both ids
 * are the one the author is saving.
 */
function refuseASelfReference(
  submitted: { readonly document: unknown } | "absent",
  self: string,
  options: CycleGuardOptions,
  work: WorkAllowance
): void {
  if (submitted === "absent") return;
  // The ID survey only says where to LOOK. It reads a stored id off every node,
  // and the renderer does not expand a condition-gated instance at all — so a
  // component holding a gated self-placeholder composes with no loop in it, and
  // refusing on the survey alone makes that component unsavable.
  if (!namesItself(submitted.document, self, options)) return;

  // So the composition decides here too, over a library holding ONLY the subject.
  const composed = composesOnItself(submitted.document, self, options, work);
  if (composed === "none") return;

  // The chain needs no walk: the survey found the subject naming itself, so the
  // chain to name is the subject twice over.
  const walked: WalkOutcome = {
    reach: { kind: "cycle", path: [self, self] },
    own: [],
  };
  if (composed === "cycle") throw cycleRefusal(walked, self);
  // Not cleared either. The survey found the document naming itself, so a
  // composition that could not finish has not shown that the placement resolves.
  throw indeterminateRefusal(walked, self, work);
}

/**
 * What composing this document over ITSELF alone establishes.
 *
 * Deliberately a narrower question than {@link composesACycle}, and the narrowing
 * is what makes it answerable with no library at all. Every other component is
 * simply ABSENT, which the resolver draws as a placeholder — so a chain that runs
 * out through some other component is not found here; it is left to the walk
 * that can actually read it. With no reader there is nothing to fail, so an
 * unrelated placement beside a gated self-placeholder never becomes a refusal.
 *
 * Every selection is composed — the default one and each declared variant —
 * against the save's allowance. A limit reached inside the subject's OWN forest,
 * or an allowance spent before every selection was composed, answers
 * `indeterminate`: the survey has already found the document naming itself, and
 * a composition that could not finish has not shown that the placement resolves.
 */
function composesOnItself(
  document: unknown,
  self: string,
  options: CycleGuardOptions,
  work: WorkAllowance
): CompositionVerdict {
  const selections = everySelection(document);
  if (selections === null) return "indeterminate";

  const alone = {
    has: (id: string) => id === self,
    get: (id: string) => (id === self ? document : undefined),
  };
  for (const variant of selections) {
    // An optimisation, and stated as one because no outcome can hold it: a
    // composition asked for once the allowance is spent comes back stopped short
    // anyway. What it saves is the envelope planning each further call pays
    // before its first entry is refused.
    if (work.left <= 0) return "indeterminate";
    const composed = composeSubject(self, variant, alone, options, work);
    if (composed.reached === "cycle") return "cycle";
    // A component this could not supply reports `missing`, which is not a
    // stopping reason, so a stop here is a limit on the subject's own forest or
    // on the allowance — never an absent neighbour.
    if (composed.reached === "stopped") return "indeterminate";
  }
  return "none";
}

/** Walk each named form, and refuse on the first that does not come back clean. */
async function refuseIfReached(args: {
  options: CycleGuardOptions;
  source: ComponentSource;
  self: string;
  document: unknown;
  forms: readonly boolean[];
  work: WorkAllowance;
}): Promise<void> {
  const { options, source, self, document, forms, work } = args;
  for (const draft of forms) {
    // One reader per FORM. A component's published and draft documents are
    // different documents, so a cache shared across the two would answer the
    // second walk with the first one's reading.
    const read = documentReader(source, draft);
    const walked = await walkFrom(document, self, options, read);
    if (walked.reach.kind === "unknown") throw unreadableRefusal();

    // The walk answers about IDS and never decides. It is an approximation in
    // BOTH directions: short by one level wherever overrides flow down through
    // nesting, and long by a stored edge wherever an override re-points one away
    // from the loop. So the composition rules and the walk only supplies the
    // chain to name — which is the one thing the composition cannot report.
    const composed = await composesACycle(document, self, options, read, work);
    if (composed === "cycle") throw cycleRefusal(walked, self);

    // Composing could not be FINISHED, which is not a report that there is no
    // loop — and the walk's `none` cannot stand in for one, because the walk is
    // exactly the approximation that misses a loop only composition shows. A
    // nested override can send the resolver to a definition the walk never
    // needed, so the two do not even read the same rows.
    //
    // Refused whatever the walk said: this state is a failed read, a limit the
    // composition reached, or the save's allowance spent, and none of them is
    // evidence that no loop exists. A definition the RENDERER declines is not
    // this case — that resolves to a placeholder a reader sees, so it composes
    // as `none` and stays savable.
    if (composed === "indeterminate") {
      throw indeterminateRefusal(walked, self, work);
    }
  }
}

/** The refusal for a graph this could not establish, worded once. */
function unreadableRefusal(): Error {
  return refusal(UNESTABLISHED);
}

const UNESTABLISHED =
  `This component cannot be saved: the components it uses could not all be ` +
  `read, so whether it would end up referencing itself could not be ` +
  `established.`;

/**
 * The refusal for a save whose compositions spent its allowance.
 *
 * Its own wording because its remedy is the author's to take, which a failed
 * read is not: fewer variants, or less placed inside the component, is work they
 * can do.
 */
const OUTGROWN =
  `This component cannot be saved: composing it under each of its variants ` +
  `takes more work than one save allows, so whether it would end up ` +
  `referencing itself could not be established. Offer fewer variants, or ` +
  `place fewer or smaller components inside it.`;

/**
 * The refusal for a composition that could not be finished.
 *
 * Says only what is known, and the two halves are different claims. The
 * composition established nothing, so it cannot be reported as a loop. But where
 * the WALK found a chain over stored ids, that chain is the one thing an author
 * can act on — and withholding it to keep the message short leaves them re-saving
 * and getting the same refusal with nowhere to start.
 *
 * Offered as a lead rather than as the verdict, deliberately: a walk's chain can
 * be a stored edge an override re-points, which is why it does not decide.
 */
function indeterminateRefusal(
  walked: WalkOutcome,
  self: string,
  work: WorkAllowance
): Error {
  // Which unestablished state this is, because only one has a remedy the author
  // controls. A spent allowance is that one, whatever else also stopped.
  const reason = work.left <= 0 ? OUTGROWN : UNESTABLISHED;
  if (walked.reach.kind !== "cycle") return refusal(reason);
  return refusal(
    `${reason} Its stored placements do lead back to it — ` +
      `${namedPath(walked.reach.path, walked.own, self)} — so start there.`
  );
}

/**
 * The refusal for a loop, named as precisely as the two answers allow.
 *
 * The walk's chain where it found one, because a person can act on
 * `Hero → Banner → Hero` and cannot act on "somewhere in here". Where only the
 * composition found it there is no chain to give: `resolveComponentInstances`
 * reports `{ instanceId, componentId, reason }` and not the path that reached
 * it.
 */
function cycleRefusal(walked: WalkOutcome, self: string): Error {
  if (walked.reach.kind === "cycle") {
    return refusal(
      `This component cannot be saved because it would reference itself: ` +
        `${namedPath(walked.reach.path, walked.own, self)}. Remove that ` +
        `placement and save again.`
    );
  }
  return refusal(
    `This component cannot be saved because it would reference itself once ` +
      `its placements are composed. Remove the placement that leads back to ` +
      `it and save again.`
  );
}

/** The walk's verdict, with the ids used to decide which of them to name. */
interface WalkOutcome {
  readonly reach: ComponentReach;
  /**
   * The ids the SUBMITTED document names, and only those.
   *
   * The redaction allowlist, so it must not be the walk's enriched reach. That
   * list grows by reading other definitions as the system — a
   * placement's selected variant can install an id that lives in a definition
   * this author cannot open — and naming such an id in a refusal hands out an
   * identifier the author could not otherwise obtain. What the author already
   * holds is what their own document says, their own variants included.
   */
  readonly own: readonly string[];
}

/** Whether a surveyed document names the subject, decided without any read. */
function selfNamedIn(
  survey: { readonly ids: readonly string[] },
  self: string
): boolean {
  // Completeness is NOT required, and the asymmetry is the point: a truncated
  // survey makes an ABSENT id uncertain and a PRESENT one no less present. The
  // walk it feeds already refuses an unread forest for the absent direction, so
  // demanding completeness here only threw away evidence — and threw it away on
  // the step that runs before the library is read at all.
  return survey.ids.includes(self);
}

/**
 * Whether the submitted document closes a loop on the subject by itself.
 *
 * Answerable with no library at all, which is why it is asked before the first
 * read.
 */
function namesItself(
  document: unknown,
  self: string,
  options: CycleGuardOptions
): boolean {
  return selfNamedIn(componentReachIn(document, options.limits.maxNodes), self);
}

/**
 * What the id walk makes of this document, for the chain it can name.
 *
 * A document that names ITSELF is taken from the document alone, before any
 * library read. The placement lookahead below reads one row per distinct target
 * and the walk then reads the graph behind them — up to the whole budget — and
 * none of those rows can change an edge the document already closes on itself.
 * The composition confirming this costs no read either: the subject is the one
 * document already in hand, so the loop closes in the first round.
 */
async function walkFrom(
  document: unknown,
  self: string,
  options: CycleGuardOptions,
  read: DocumentReader
): Promise<WalkOutcome> {
  const survey = componentReachIn(document, options.limits.maxNodes);
  const own = survey.ids;
  if (selfNamedIn(survey, self)) {
    return { reach: { kind: "cycle", path: [self, self] }, own };
  }

  const places = await reachableFrom(document, options, read);
  const graph = await placementsReachedFrom(places, options, read);
  return {
    reach: componentReach({ places, self, placedBy: id => graph.get(id) }),
    own,
  };
}

/**
 * Whether a loop is what a READER would receive, which decides every refusal.
 *
 * The walk answers a question about IDS, and reachability is not a property of
 * ids. It is wrong in both directions:
 *
 * - **Short.** Overrides flow DOWN through nesting: a placement can re-point a
 *   node two levels below it, so the loop exists in the composed tree while no
 *   pair of documents names the other twice.
 * - **Long.** The same mechanism removes edges. Where a placement re-points a
 *   nested reference away from the loop, the stored edge the walk follows is one
 *   no reader ever resolves — and refusing on it refuses a supported shape.
 *
 * So this asks `resolveComponentInstances`, the function the RENDERER uses. Its
 * answer and the reader's experience cannot diverge, because they are the same
 * computation over the same inputs.
 *
 * ONE COMPOSITION PER SELECTION, never their union. A definition's variants are
 * alternatives in exactly the way its draft and published forms are, and
 * `componentReferencesIn` unions them deliberately — its own words are "a
 * SUPERSET of what any one reader receives". Confirming against the union would
 * refuse a loop that exists under no selection; confirming against only the
 * no-variant placement would clear one that exists under a variant, which is
 * measured behaviour and not a hypothetical.
 *
 * Three answers rather than two. "Composed clean" and "could not finish
 * composing" are different facts, and folding them together would make a
 * library this cannot read into a way to save a loop into one.
 */
async function composesACycle(
  document: unknown,
  self: string,
  options: CycleGuardOptions,
  read: DocumentReader,
  work: WorkAllowance
): Promise<CompositionVerdict> {
  const selections = everySelection(document);
  // The variants could not be enumerated. Not an answer either way.
  if (selections === null) return "indeterminate";

  // The subject under its own id, so a chain leading back to it meets the
  // document being SAVED rather than the copy the store still holds. Shared
  // across the selections: a definition read for one is the same document under
  // the next, and the resolver follows only what a selection references, so
  // entries no selection reaches cost nothing but the read already paid for.
  const library = heldLibrary(new Map([[self, document]]));

  let indeterminate = false;
  for (const variant of selections) {
    // A selection left uncomposed is not one that composed clean. Answered here
    // as an optimisation: once the allowance is spent every further selection
    // stops short on its first entry, so the verdict is the same either way and
    // only the planning for each is saved.
    if (work.left <= 0) return "indeterminate";
    const one = await composesUnder(
      variant,
      self,
      options,
      read,
      library,
      work
    );
    if (one === "cycle") return "cycle";
    if (one === "indeterminate") indeterminate = true;
  }
  return indeterminate ? "indeterminate" : "none";
}

/**
 * How much composing ONE save will do before it declines to answer, counted in
 * the definition entries the resolver clones or prepares.
 *
 * A budget rather than a rule about which variants matter. Whether a selection
 * can change a composition is a question only the whole resolver answers, so
 * every selection is composed and the work itself is what is bounded. The
 * resolver charges each entry as it examines it — the subject's own forest, the
 * definitions it places, and expansions it attempts and abandons — so a one-node
 * component placing a large definition pays for that definition under every
 * variant it offers.
 *
 * Spending it REFUSES, for the reason the read budget does: a prefix of the
 * selections that found no loop is exactly what a component with no loop looks
 * like.
 */
export const MOST_COMPOSED_NODES = 250_000;

/**
 * Every selection a reader can receive, or `null` where they cannot be listed.
 *
 * No variant is skipped. Which ones could matter is not decidable short of
 * composing them, and composing one that changes nothing costs only work the
 * save's allowance already bounds, while missing one costs a loop on every page
 * that places it.
 */
function everySelection(
  document: unknown
): readonly (string | undefined)[] | null {
  const named = variantNamesIn(document);
  if (named === null) return null;

  // A forest that is not a list is one nothing composes. The resolver hands such
  // a document back unchanged with nothing unresolved, which would read as a
  // clean composition rather than as no composition at all.
  if (!Array.isArray((document as { nodes?: unknown }).nodes)) return null;
  return [undefined, ...named];
}

/** How one composition of the subject ended, and what it left standing. */
interface ComposedOnce {
  /** A loop closed, a limit ended the descent, or the composition finished. */
  readonly reached: "cycle" | "stopped" | "finished";
  readonly unresolved: readonly { readonly componentId: string }[];
}

/**
 * Compose the subject under ONE selection, over whatever definitions `lookup`
 * supplies, charged to the save's allowance.
 *
 * The one place a composition is judged, so the self check and the walk cannot
 * come to read the same result differently. A loop outranks a limit: a
 * composition that closed one has shown it, whatever else also stopped it.
 */
function composeSubject(
  self: string,
  variant: string | undefined,
  lookup: { has(id: string): boolean; get(id: string): unknown },
  options: CycleGuardOptions,
  work: WorkAllowance
): ComposedOnce {
  const { unresolved, loopsClosed } = resolveComponentInstances(
    hostPlacing(self, variant),
    lookup as never,
    { limits: options.limits, work }
  );
  // Read from the loops the resolver closed rather than from what it left
  // standing: an expansion abandoned when the allowance runs out takes its
  // refusals with it, and a loop found before that point still decides.
  if (loopsClosed.length > 0) return { reached: "cycle", unresolved };
  if (unresolved.some(one => STOPPED_SHORT.includes(one.reason))) {
    return { reached: "stopped", unresolved };
  }
  return { reached: "finished", unresolved };
}

/** Composing the subject under ONE variant selection, reading what it asks for. */
async function composesUnder(
  variant: string | undefined,
  self: string,
  options: CycleGuardOptions,
  read: DocumentReader,
  library: HeldLibrary,
  work: WorkAllowance
): Promise<CompositionVerdict> {
  const composed = await composeWithReads({
    host: hostPlacing(self, variant),
    library,
    read,
    limits: options.limits,
    work,
    stopAtLoop: true,
  });
  // A loop outranks every limit: a composition that closed one has shown it,
  // whatever else stopped it. A capped branch or a read that failed rules
  // nothing out, so either leaves the question open rather than answered.
  if (composed.loopsClosed.size > 0) return "cycle";
  return composed.incomplete || composed.stoppedShort
    ? "indeterminate"
    : "none";
}

/**
 * The loop as the SAVING AUTHOR may be told it.
 *
 * The walk reads as the system, with no access rule, because a component this author
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
export function formsChangedBy(next: string | undefined): readonly boolean[] {
  return next === "published" ? [false, true] : [true];
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
  // A head index rather than `shift()`, which moves every remaining entry on
  // each step. The same walk shape as `componentReach`, and quadratic for the
  // same reason on a library that fans out.
  for (let head = 0; head < pending.length; head += 1) {
    const id = pending[head];
    if (seen.has(id)) continue;
    // No bound of its own: the reader charges every distinct component against
    // the budget, and answers `unreadable` past it — which this walk already
    // reads as an unknown graph and refuses on. A second count here would be a
    // second number meaning nearly the same thing.
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
    const installed = componentReferencesFrom(
      target.document,
      placement.node,
      options.limits.maxNodes
    );
    // The placed definition holds more nodes than the bound admits, so which of
    // its nodes an override lands on could not be established. Unknown for the
    // same reason an unreadable definition is: the walk must not read a prefix of
    // an answer as the whole of it.
    //
    // Every definition reached here is also surveyed by the graph walk below,
    // which applies the same bound and reports the same document unread — so on
    // today's call graph this cannot be the only thing that catches it. Kept
    // because it is an assertion over a value already in hand: it costs nothing
    // while it never fires, and which walks reach a definition is a property of
    // the callers rather than of this answer.
    if (!installed.complete) return undefined;
    for (const id of installed.ids) ids.add(id);
  }
  return [...ids];
}

/**
 * A refusal raised inside the judgement and turned into the sentence it carries.
 *
 * Its own class so the entry can tell the judgement's own refusals from a
 * failure it should not swallow.
 */
class CycleRefusal extends Error {}

/** A refusal an author actually sees. */
function refusal(message: string): Error {
  return new CycleRefusal(message);
}
