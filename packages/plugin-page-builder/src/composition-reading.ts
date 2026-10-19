/**
 * Composing a document over a library that is read as the composition asks.
 *
 * The resolver is handed definitions and fetches nothing. A caller judging a
 * write does not have the library in memory, and cannot predict which
 * definitions a document reaches: an override can choose a component, a variant
 * can re-point a node, and a definition read in one round places others. So the
 * reads follow the composition — compose, read every placement it could not
 * expand, compose again — until nothing new is asked for.
 *
 * One loop for every judgement that composes, so the cycle refusal, the
 * nesting and depth judgement, and the re-judging of a component's hosts read
 * the same library the same way.
 *
 * @module composition-reading
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolveComponentInstances,
  type BlockDocument,
  type DocumentLimits,
  type ResolvedComposition,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";

/**
 * How many rounds of reads one composition may take.
 *
 * Each round reads at least one definition the last could not expand, so the
 * reader's own bound on distinct definitions ends the loop first; this is the
 * backstop for a reader that answers without ever running out.
 */
const MOST_ROUNDS = 100;

/**
 * One form of one component's stored document, or why it is not available.
 *
 * A discriminated result rather than the document with sentinels beside it: a
 * stored document is `unknown`, and a union with `unknown` in it collapses to
 * `unknown` — so every sentinel comparison would type-check against anything.
 */
export type ReadDocument =
  | { readonly kind: "document"; readonly document: unknown }
  /** No such row. The resolver draws a placement of it as missing, not as a loop. */
  | { readonly kind: "absent" }
  /** Read, and not establishable as this component's document. */
  | { readonly kind: "unreadable" };

/** Reads one component's document; the caller decides caching and bounds. */
export type DocumentReader = (id: string) => Promise<ReadDocument>;

/**
 * Where component documents come from: one form of one component, uncached.
 *
 * `draft` is the form an editor's preview reads — the pending working draft, or
 * the live row where none is pending — and `false` is the live row.
 */
export type ComponentSource = (
  id: string,
  draft: boolean
) => Promise<ReadDocument>;

/**
 * How many DISTINCT components one walk will read before giving up.
 *
 * A bound on the reads, which nothing else supplies: the walk follows only what
 * the document reaches, and that is normally a handful, but a library is sized
 * at three thousand entries and nothing stops one component reaching a large
 * share of them.
 *
 * Charged per DISTINCT component per lifecycle form, by the reader every read
 * goes through — so a component reached by twenty placements costs one.
 *
 * Exceeding it answers `unreadable`, so a judgement that needed the read
 * cannot read a prefix of the library as the whole of it.
 */
export const MOST_COMPONENTS_READ = 100;

/**
 * Reads each component's document ONCE per walk.
 *
 * The cache is what keeps the placement pass affordable: computing a document's
 * edges reads every definition it places, and the walk then visits those same
 * definitions. Without it a library where many components place one shared
 * component would read that component once per placement.
 *
 * It also makes the answer consistent. A definition read twice in one walk could
 * come back differently — a concurrent write committing between the two —
 * and a graph assembled from two readings of one component is a graph no reader
 * ever receives.
 */
export function documentReader(
  source: ComponentSource,
  draft: boolean
): BoundedReader {
  const held = new Map<string, ReadDocument>();
  let exhausted = false;
  const read: DocumentReader = async id => {
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
    if (held.size >= MOST_COMPONENTS_READ) {
      exhausted = true;
      return { kind: "unreadable" };
    }
    const answer = await source(id, draft);
    held.set(id, answer);
    return answer;
  };
  return Object.assign(read, { exhausted: () => exhausted });
}

/**
 * A reader that can say whether it ran out.
 *
 * Its refusals past the bound answer `unreadable`, which is also what a row that
 * could not be read answers — and the two need different remedies: one is an
 * author's to fix by using fewer components, the other is a damaged row.
 */
export type BoundedReader = DocumentReader & {
  /** Whether any read was refused for the bound rather than attempted. */
  readonly exhausted: () => boolean;
};

/**
 * What has been read so far, shared by every composition over one library.
 *
 * `held` may be seeded: a write judges the document it is SAVING under the id
 * it is stored as, so a chain leading back to it meets the new document rather
 * than the copy the store still holds.
 */
export interface HeldLibrary {
  readonly held: Map<string, unknown>;
  /** Asked for and not supplied: absent, or unreadable. */
  readonly missing: Set<string>;
}

/** An empty library, or one seeded with the documents a write is about to store. */
export function heldLibrary(seed?: ReadonlyMap<string, unknown>): HeldLibrary {
  return {
    held: new Map<string, unknown>(seed ?? []),
    missing: new Set<string>(),
  };
}

/**
 * The resolver's reasons that mean a composition STOPPED rather than finished.
 *
 * A limit reached is not a report about references: the resolver stopped
 * descending, so whatever lies past it was never looked at. The other reasons
 * describe a placement a reader sees resolved-as-absent — `missing` once it
 * survives a read, `malformed` naming no component, `unreadable` a definition
 * the renderer declines — and there the composition and the reader agree.
 */
export const STOPPED_SHORT: readonly string[] = [
  "composed-depth",
  "node-depth",
  "budget",
];

/** How one composition over a read library ended. */
export interface ReadComposition {
  /** The last composition, with every placement the reads could supply expanded. */
  readonly composition: ResolvedComposition;
  /**
   * Each reference loop the composition closed, identified by the component
   * it closes at and the placement it is cut at. Empty when none did.
   *
   * By placement, not by component alone: two loops that close at the same
   * component are distinct loops, and a caller comparing two compositions has
   * to tell a new one from one that was already there. The composed ids are
   * the resolver's, derived from each placement's path, so one loop has one
   * identity in both compositions. A loop closed in a round whose expansion was
   * later abandoned keeps only its component, which is all that round left.
   */
  readonly loopsClosed: ReadonlySet<string>;
  /** Whether a limit ended the descent somewhere. */
  readonly stoppedShort: boolean;
  /**
   * Whether the composition is a FLOOR: a definition could not be read, or the
   * reads or the work allowance ran out before nothing more was asked for.
   */
  readonly incomplete: boolean;
}

/**
 * Compose `host` over `library`, reading through `read` whatever it asks for.
 *
 * `stopAtLoop` ends the composition at the first round a loop closes, for a
 * caller to whom a loop is the whole answer. A caller judging the rest of the
 * composition leaves it off: a loop already in the library is drawn as one
 * placeholder, and the rest of the document still has to be judged.
 *
 * An unreadable definition is recorded as missing and the reads go on, so the
 * composition is the one a reader receives — which draws a placeholder there —
 * and `incomplete` says the gap was not established as absence.
 */
export async function composeWithReads(args: {
  host: BlockDocument;
  library: HeldLibrary;
  read: DocumentReader;
  limits: DocumentLimits;
  work: WorkAllowance;
  stopAtLoop?: boolean;
}): Promise<ReadComposition> {
  const { host, library, read, limits, work } = args;
  const lookup = {
    has: (id: string) => library.held.has(id),
    get: (id: string) => library.held.get(id) as BlockDocument | undefined,
  };
  const seen = {
    loopsClosed: new Set<string>(),
    stoppedShort: false,
    incomplete: false,
  };
  let composition = resolveComponentInstances(host, lookup, { limits, work });
  for (let round = 0; ; round += 1) {
    noteRound(composition, seen);
    if (seen.loopsClosed.size > 0 && args.stopAtLoop === true) break;

    const wanted = stillWanted(composition, library);
    // Nothing further to supply: every placement this document reaches was
    // composed, or is known to be missing.
    if (wanted.length === 0) break;
    // Every round composes again from the top, so every round is charged; once
    // the allowance is spent the next composition would stop at its first entry.
    if (round >= MOST_ROUNDS || work.left <= 0) {
      seen.incomplete = true;
      break;
    }
    if (await supply(wanted, read, library)) seen.incomplete = true;
    composition = resolveComponentInstances(host, lookup, { limits, work });
  }
  if (work.left <= 0) seen.incomplete = true;
  return { composition, ...seen };
}

/**
 * What one round of composition showed.
 *
 * Read from the loops the resolver closed rather than from what it left
 * standing: an expansion abandoned when the allowance runs out takes its
 * refusals with it, and a loop found before that point still decides.
 */
function noteRound(
  composition: ResolvedComposition,
  seen: { loopsClosed: Set<string>; stoppedShort: boolean }
): void {
  const cut = composition.unresolved.filter(one => one.reason === "cycle");
  for (const one of cut) {
    seen.loopsClosed.add(`${one.componentId}\u0000${one.instanceId}`);
  }
  for (const id of composition.loopsClosed) {
    if (!cut.some(one => one.componentId === id)) seen.loopsClosed.add(id);
  }
  if (composition.unresolved.some(one => STOPPED_SHORT.includes(one.reason))) {
    seen.stoppedShort = true;
  }
}

/**
 * What the composition asked for and the library has not answered yet.
 *
 * Derived from what the COMPOSITION reached rather than from a second traversal
 * predicting it: the resolver names every instance it could not expand, so the
 * set to read is the one the render itself needs.
 */
function stillWanted(
  composition: ResolvedComposition,
  library: HeldLibrary
): readonly string[] {
  return composition.unresolved
    .map(one => one.componentId)
    .filter(
      id => id !== "" && !library.held.has(id) && !library.missing.has(id)
    );
}

/**
 * Read each wanted definition into the library; `true` where one could not be.
 *
 * An absent row is recorded as missing: the resolver draws a placement of
 * something nobody supplied as missing, and so does every reader. An unreadable
 * one is recorded the same way, so the composition matches what a reader is
 * drawn, and reported, because nothing established that it is absent.
 */
async function supply(
  wanted: readonly string[],
  read: DocumentReader,
  library: HeldLibrary
): Promise<boolean> {
  let unreadable = false;
  for (const id of wanted) {
    const answer = await read(id);
    if (answer.kind === "document") {
      library.held.set(id, answer.document);
      continue;
    }
    library.missing.add(id);
    if (answer.kind === "unreadable") unreadable = true;
  }
  return unreadable;
}

/** A page that places one component, so the resolver is asked about it. */
export function hostPlacing(self: string, variant?: string): BlockDocument {
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
