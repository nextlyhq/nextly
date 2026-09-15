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
 * not skippable, which is a core capability rather than a hook.
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
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  componentReach,
  componentReachIn,
  componentReferencesFrom,
  resolveComponentInstances,
  variantNamesIn,
  type ComponentReach,
  type DocumentLimits,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ClassUsageDirectApi } from "./class-usage-runtime";

/**
 * How many DISTINCT components one walk will read before giving up.
 *
 * A bound on the reads, which nothing else supplies: the walk follows only what
 * the saved document reaches, and that is normally a handful, but a library is
 * sized at three thousand entries and nothing stops one component reaching a
 * large share of them.
 *
 * Charged per DISTINCT component per lifecycle form, by the reader every read
 * goes through — so a component reached by twenty placements costs one, and the
 * lookahead that resolves a placement cannot outrun the bound before the walk
 * that follows it gets a turn.
 *
 * Exceeding it REFUSES, because a prefix of the graph that did not meet the
 * subject is exactly what a graph with no loop looks like. That is the
 * expensive direction of the fail-closed choice and it is deliberate: the other
 * one admits the loop this exists to stop.
 */
const MOST_COMPONENTS_READ = 100;

/** The Direct API surface this needs, aliased rather than described again. */
export type CycleGuardDirectApi = ClassUsageDirectApi;

/**
 * What composing the subject established, as three facts rather than two.
 *
 * `indeterminate` is the one a boolean loses: a composition that could not be
 * finished — a definition the reader could not supply, a budget spent — has
 * shown nothing, and reading it as `none` would let an unreadable library clear
 * a loop the walk had already proven.
 */
type CompositionVerdict = "cycle" | "none" | "indeterminate";

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
  if (submitted === "absent" && next === undefined) return;

  // The field IS in this patch and carries no document. What lands therefore
  // holds no references at all, so it can close no loop whatever the status does
  // — and judging the pending draft instead would refuse the write for a chain
  // that this very write REMOVES. An author clearing a component to break a
  // legacy loop would be told to break it first.
  if (submitted === "empty") return;

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

  // ONE allowance for every composition this save performs, so the bound is on
  // the save rather than on each check that composes.
  const work: WorkAllowance = { left: MOST_COMPOSED_NODES };

  // Decided from the document in hand, so it is decided BEFORE the declines
  // below. Those exist for the graph READS, and this question needs none.
  refuseASelfReference(submitted, self, options, work);

  const nextly = directApiOf(context);
  // No Direct API to ask with. A guard that refused every write it could not
  // evaluate would make the collection unwritable on any path that shapes its
  // context differently, and this is a data-integrity guard rather than an
  // authorisation one.
  if (nextly === null) return;

  const held = await documentPutLive(submitted, self, options, nextly);
  // Nothing goes live that this write supplies. Nothing changes and nothing is
  // judged, rather than a refusal for a row this could not find.
  if (held === null) return;

  await refuseIfReached({
    options,
    nextly,
    self,
    document: held.document,
    forms: formsChangedBy(next),
    work,
  });
}

/**
 * Refuse a submitted document that closes a loop on the subject by itself.
 *
 * Separate from the walk because it needs no library at all, which is what lets
 * it run ahead of every decline the graph reads require. A write on a path that
 * shapes its context differently — an early-runtime write, an internal one with
 * no Direct API bound — could otherwise persist the one loop that takes no
 * library to see, with the guard registered and reporting nothing.
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
  // Not cleared either. On the path with no Direct API there is no walk behind
  // this to decide instead, so a composition that could not finish refuses here.
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

/**
 * The document this write puts live, or `null` where it puts none there.
 *
 * A status-only publish carries no document of its own and is NOT graph-neutral:
 * core promotes the whole pending working draft into the live row
 * (`draft-published-split.integration.test.ts`, "promotes the whole working
 * draft to the live row when the publish omits its fields"). What goes live is
 * that draft, so that is the document to judge — a cycle written into a draft
 * before this guard existed, or through a write that skipped it, would otherwise
 * reach the live library on a publish this never inspected.
 *
 * Refuses where the subject's own stored document cannot be read, because a
 * document this could not read is not a document it can clear.
 */
async function documentPutLive(
  submitted: { readonly document: unknown } | "absent",
  self: string,
  options: CycleGuardOptions,
  nextly: CycleGuardDirectApi
): Promise<{ readonly document: unknown } | null> {
  if (submitted !== "absent") return { document: submitted.document };

  const promoted = await pendingDocument(self, options, nextly);
  if (promoted.kind === "absent") return null;
  if (promoted.kind === "unreadable") {
    throw refusal(
      `This component cannot be saved: its own stored document could not be ` +
        `read, so whether it would end up referencing itself could not be ` +
        `established.`
    );
  }
  return { document: promoted.document };
}

/** Walk each named form, and refuse on the first that does not come back clean. */
async function refuseIfReached(args: {
  options: CycleGuardOptions;
  nextly: CycleGuardDirectApi;
  self: string;
  document: unknown;
  forms: readonly boolean[];
  work: WorkAllowance;
}): Promise<void> {
  const { options, nextly, self, document, forms, work } = args;
  for (const draft of forms) {
    // One reader per FORM. A component's published and draft documents are
    // different documents, so a cache shared across the two would answer the
    // second walk with the first one's reading.
    const read = documentReader(options, nextly, draft);
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
   * list grows by reading other definitions with `overrideAccess: true` — a
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
  // the path that runs before the guard can ask the library anything.
  return survey.ids.includes(self);
}

/**
 * Whether the submitted document closes a loop on the subject by itself.
 *
 * Answerable with no library at all, which is why it is asked before the guard
 * declines a write it cannot read the graph for.
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
  const library: HeldLibrary = {
    held: new Map<string, unknown>([[self, document]]),
    missing: new Set<string>(),
  };

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
const MOST_COMPOSED_NODES = 250_000;

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

/** What the walk and the composition have read so far, shared across selections. */
interface HeldLibrary {
  readonly held: Map<string, unknown>;
  readonly missing: Set<string>;
}

/**
 * The reasons that mean the composition STOPPED rather than finished.
 *
 * A limit reached is not a report about references: the resolver stopped
 * descending, so whatever lies past it was never looked at and a loop there is
 * invisible to the composition — while the walk, which has no such cap, can have
 * proven it. Reading these as "no loop" is what lets a chain longer than
 * `MAX_COMPOSED_DEPTH` clear a refusal the insert panel still applies.
 *
 * The other non-`cycle` reasons are deliberately NOT here, because they describe
 * a placement the reader sees resolved-as-absent rather than an unfinished
 * search. `missing` is what drives the read loop below and means absent once it
 * survives a read; `malformed` names no component at all; and `unreadable` is a
 * definition the RENDERER declines, so it draws a placeholder and no reader can
 * see a loop through it. The composition and the reader agree in all three.
 */
const STOPPED_SHORT: readonly string[] = [
  "composed-depth",
  "node-depth",
  "budget",
];

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
    hostPlacing(self, variant) as never,
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
  const { held } = library;
  // HELD until the reads are exhausted, rather than answered with on sight. A
  // capped branch rules nothing out, and another branch may still compose a loop
  // — so a `cycle` this can prove beats a limit it cannot see past, which is the
  // rule `componentReach` already follows for a branch it could not read.
  let stoppedShort = false;

  const lookup = {
    has: (id: string) => held.has(id),
    get: (id: string) => held.get(id),
  };
  for (let round = 0; round <= MOST_COMPONENTS_READ; round += 1) {
    // Every round composes again from the top, so every round is charged. The
    // early answer is the optimisation the loop above makes, for the same reason.
    if (work.left <= 0) return "indeterminate";
    const composed = composeSubject(self, variant, lookup, options, work);
    if (composed.reached === "cycle") return "cycle";
    if (composed.reached === "stopped") stoppedShort = true;

    const wanted = stillWanted(composed.unresolved, library);
    // Nothing further to supply. Every placement this selection resolves was
    // composed — so this is `none` only where nothing stopped the descent.
    if (wanted.length === 0) return stoppedShort ? "indeterminate" : "none";
    if (!(await supply(wanted, read, library))) return "indeterminate";
  }
  return "indeterminate";
}

/**
 * What the composition asked for and the library has not answered yet.
 *
 * Derived from what the COMPOSITION reached rather than from a second traversal
 * predicting it: the resolver names every instance it could not expand, so the
 * set to read is the one the render itself needs.
 */
function stillWanted(
  unresolved: readonly { readonly componentId: string }[],
  library: HeldLibrary
): readonly string[] {
  return unresolved
    .map(one => one.componentId)
    .filter(
      id => id !== "" && !library.held.has(id) && !library.missing.has(id)
    );
}

/**
 * Read each wanted definition into the library; `false` where one could not be.
 *
 * An absent row is RECORDED rather than refused: the resolver draws a placement
 * of something nobody supplied as missing, and that is not a loop. A read that
 * fails, or one past the budget, is the case a caller cannot conclude from.
 */
async function supply(
  wanted: readonly string[],
  read: DocumentReader,
  library: HeldLibrary
): Promise<boolean> {
  for (const id of wanted) {
    const answer = await read(id);
    if (answer.kind === "unreadable") return false;
    if (answer.kind === "absent") {
      library.missing.add(id);
      continue;
    }
    library.held.set(id, answer.document);
  }
  return true;
}

/** A page that places one component, so the resolver is asked about it. */
function hostPlacing(self: string, variant?: string): unknown {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "cycle-guard-subject",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        // The selection spelled as ABSENT rather than as `undefined`, which a
        // reader's own placement of no variant is: an explicit `variant` key
        // holding `undefined` is a different record, and the resolver reads the
        // props it is given rather than the ones this meant.
        props:
          variant === undefined
            ? { componentId: self }
            : { componentId: self, variant },
      },
    ],
  };
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
    // The budget is charged HERE, at the one place every read passes through,
    // rather than by whichever walk happens to ask. Two walks ask now — the
    // graph traversal, and the lookahead that resolves a placement against the
    // definition it places — and the lookahead runs FIRST. Charged only by the
    // traversal, a document holding more distinct placements than this could
    // issue one read per placement before anything counted them: the node cap
    // admits five thousand, so a single save meant a few thousand sequential
    // reads and only then a refusal for exceeding a bound of a hundred.
    //
    // Refused rather than cached, so every id past the bound refuses too — an
    // entry here would spend the budget on remembering that it had run out.
    if (held.size >= MOST_COMPONENTS_READ) return { kind: "unreadable" };
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
 * all included. A looser rule, accepting a key-less row on the grounds that the
 * read was addressed by id anyway, admits exactly the case an `afterRead` hook
 * can manufacture: a lookup for B retargeted to an acyclic C
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
 * The document this write carries, and which KIND of nothing where it carries none.
 *
 * `absent` is a patch that does not mention the field, so the stored document
 * survives the write and a promotion puts that document live. `empty` is a patch
 * that mentions it and supplies no document — a cleared field — so what lands
 * names nothing. The two look identical from the field's value and lead to
 * opposite answers, which is why they are separate sentinels rather than one.
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
): { readonly document: unknown } | "absent" | "empty" {
  const data = fieldOf(context, "data");
  if (data === undefined) return "absent";
  // PRESENCE, not truthiness. Core selects the columns an update writes with the
  // same question (`hasOwnProperty` over the patch), so a field carrying `null`
  // is one this write STORES rather than one it leaves alone — and the two need
  // opposite treatment below.
  if (!Object.hasOwn(data, options.documentField)) return "absent";
  const document = data[options.documentField];
  if (typeof document !== "object" || document === null) return "empty";
  const nodes = (document as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return "empty";
  // Wrapped, because a bare `unknown` in a union with the sentinels collapses to
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
