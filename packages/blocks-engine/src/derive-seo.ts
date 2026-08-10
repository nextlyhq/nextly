/**
 * The metadata a document can speak for itself.
 *
 * A page built from blocks already contains its title, its opening prose and
 * its first picture. When the entry's SEO fields are blank — which is the
 * common case, because filling them is a separate act an author has to
 * remember — deriving them from the document is the difference between a
 * correct search result and one that reads `Untitled`.
 *
 * Each field is filled from the FIRST block that offers it, independently: a
 * page whose opening block is an image and whose first heading comes later
 * takes the image from one and the title from the other. Stopping at the first
 * block that answers anything would make the result depend on document order
 * in a way an author cannot see.
 *
 * @module derive-seo
 */
import type { BlockSeoContribution, BlockSeoImage } from "./block";
import type { BlockDocument, BlockNode } from "./document";

/**
 * What a walk over a document produced.
 *
 * `image` is always the normalized candidate LIST, whichever form the block
 * offered, so a caller resolving it never re-derives that distinction.
 */
export interface DerivedSeo {
  title?: string;
  description?: string;
  image?: SeoImageCandidate[];
}

/**
 * Whether a node is part of the output being described.
 *
 * REQUIRED, and required for a reason. A document can carry nodes the server
 * deliberately omits — `visibility.conditions` gates personalised and
 * status-restricted content — and deriving a page's TITLE from one publishes
 * the withheld text on every search result and link preview. That is strictly
 * worse than publishing its colour in a stylesheet, which is the same leak the
 * style compiler already had to close.
 *
 * Injected rather than decided here, and not optional. The rule lives in one
 * place already (`isUnconditional`, beside the renderer's pruning pass) and it
 * fails closed on malformed shapes; a second copy in this package would be a
 * second answer that can drift, and a DEFAULT would be a safe-looking call that
 * silently skips the check. Making it an argument means a caller cannot reach
 * this function without having answered the question.
 */
export type NodeVisibilityTest = (node: BlockNode) => boolean;

/** Looks a block definition up by type. */
export type SeoDefinitionSource = (type: string) =>
  | {
      seo?: (props: never) => BlockSeoContribution | undefined;
      /** Declared child regions, in declaration order. */
      slots?: Record<string, unknown>;
      /** Slots the block may decline to render. See `conditionalSlots`. */
      conditionalSlots?: readonly string[];
      /** Whether these props guarantee the block draws nothing. */
      rendersNothing?: (props: never) => boolean;
    }
  | undefined;

/** Trimmed text, or undefined when there is none worth using. */
function usable(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * One image candidate, normalized so a caller never re-derives its kind.
 *
 * `media` needs resolving through the host's media reader; `url` is already an
 * address and is used as written.
 */
export type SeoImageCandidate =
  | { kind: "media"; value: string }
  | { kind: "url"; value: string };

/** Normalize one offer entry, or `undefined` when it says nothing. */
function toCandidate(entry: BlockSeoImage): SeoImageCandidate | undefined {
  if (typeof entry === "string") {
    const value = usable(entry);
    return value === undefined ? undefined : { kind: "url", value };
  }
  // Checked before the `in` test, which THROWS on a non-object right operand.
  // The offer came from a block, and a block written in JavaScript or typed
  // loosely can answer `null` or a list holding one. That throw would escape
  // the guard around the block's own callback — the offer has already been
  // returned by then — and fail the whole route rather than cost one field.
  if (typeof entry !== "object" || entry === null) return undefined;
  if ("media" in entry) {
    const value = usable(entry.media);
    return value === undefined ? undefined : { kind: "media", value };
  }
  const value = usable(entry.url);
  return value === undefined ? undefined : { kind: "url", value };
}

/**
 * An offer's image candidates, best first, with the empty ones dropped.
 *
 * A block may answer with one value or an ordered list, and both collapse to
 * the same shape here so the caller resolves one thing. Normalizing at the
 * boundary is also what carries the KIND through: the block knew whether it was
 * holding a media id or an address, and every attempt to recover that from the
 * text alone was wrong about some value a block renders fine.
 */
function candidates(
  value: BlockSeoImage | readonly BlockSeoImage[] | undefined
): SeoImageCandidate[] {
  if (value === undefined) return [];
  const list =
    typeof value === "string" || !Array.isArray(value)
      ? [value as BlockSeoImage]
      : value;
  return list
    .map(entry => toCandidate(entry))
    .filter((entry): entry is SeoImageCandidate => entry !== undefined);
}

/**
 * Ask one node what it offers, without letting it break the page.
 *
 * A definition's `seo` is third-party code on the metadata path, and metadata
 * generation runs before the page renders — so a throw here would fail the
 * whole route rather than degrade one field. The forgiving-render posture the
 * document model takes for a block that throws applies at least as strongly to
 * a block merely being ASKED about itself.
 */
function offerOf(
  node: BlockNode,
  definitions: SeoDefinitionSource
): BlockSeoContribution | undefined {
  const definition = definitions(node.type);
  if (!definition?.seo) return undefined;
  let offer: BlockSeoContribution | undefined;
  try {
    offer = definition.seo(node.props as never);
  } catch {
    return undefined;
  }
  // A `try` around a synchronous call cannot contain an ASYNC one: a block
  // mistakenly declared `async seo()` returns a pending promise, the `try`
  // completes, and a later rejection has no handler. Node reports that as an
  // unhandled rejection and can end the process — the whole page lost to a
  // block being asked a question, which is exactly what the guard above exists
  // to prevent.
  //
  // The value is discarded either way: this contract is synchronous, so a
  // promise is a malformed offer whether it settles or not. Attaching the
  // handler is only about who owns the rejection.
  const thenable = (offer as { then?: unknown } | undefined)?.then;
  if (typeof thenable === "function") {
    void Promise.resolve(offer).catch(() => undefined);
    return undefined;
  }
  return offer;
}

/**
 * Whether a block says these props make it draw nothing.
 *
 * Only `true` counts. A definition that does not answer, answers with something
 * other than a boolean, or throws is treated as drawing — the safe direction,
 * since assuming otherwise removes a block that IS on the page from everything
 * derived about it.
 */
function drawsNothing(
  node: BlockNode,
  definitions: SeoDefinitionSource
): boolean {
  const predicate = definitions(node.type)?.rendersNothing;
  if (typeof predicate !== "function") return false;
  let answer: unknown;
  try {
    answer = predicate(node.props as never);
  } catch {
    return false;
  }
  // A block mistakenly declared `async rendersNothing` returns a pending
  // promise, so the `try` above finishes before any rejection happens and its
  // `catch` never sees one. Node reports that as an unhandled rejection and can
  // end the process — the whole page lost because a block was asked about
  // itself. The same containment the `seo` hook needed, for the same reason.
  if (typeof (answer as { then?: unknown } | undefined)?.then === "function") {
    void Promise.resolve(answer).catch(() => undefined);
    return false;
  }
  return answer === true;
}

/**
 * Derive title, description and image from a document's blocks.
 *
 * Returns only the fields something answered for, so the result can be spread
 * over a caller's own fallbacks without a `undefined` overwriting a value that
 * was already known.
 */
export function deriveSeoFromDocument(
  document: BlockDocument,
  definitions: SeoDefinitionSource,
  isVisible: NodeVisibilityTest
): DerivedSeo {
  const derived: DerivedSeo = {};

  const images: SeoImageCandidate[] = [];

  // Walked here rather than through `walkNodes`, which descends into every
  // slot unconditionally. A gated node takes its whole SUBTREE out of the
  // output, so a visible-looking child of a hidden container must not speak for
  // a page it never reaches — and stopping the descent is the only way to say
  // that. An ancestor check at each node would be the same rule paid for
  // repeatedly, and one that only looked at the immediate parent would miss a
  // gated grandparent entirely.
  // Walked to the end rather than stopping once the text fields are filled.
  // Whether an image candidate yields a picture is only decided AFTER this
  // walk, by the caller resolving them in order, so a first image offering a
  // deleted media id must not end the search — a later block may hold the one
  // that renders. The tree is bounded by the document's own caps, so this is a
  // walk over one page rather than an open-ended scan.
  const visit = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      if (!isVisible(node)) continue;

      // A block that DECLARES it draws nothing for these props is not on the
      // page, and neither is anything beneath it — the same reasoning that
      // stops a gated node speaking, reached by the block's own answer rather
      // than by the document's shape. Skipping the subtree matters as much as
      // skipping the node: a heading inside a container that draws nothing is
      // just as absent as the container.
      //
      // Guarded like every other call into a definition: this runs on the
      // metadata path where a throw fails the whole route, and a non-boolean
      // answer means the block did not really answer. Both degrade to "draws",
      // which costs unused work rather than a missing page.
      if (drawsNothing(node, definitions)) continue;

      const offer = offerOf(node, definitions);
      if (offer) {
        derived.title ??= usable(offer.title);
        derived.description ??= usable(offer.description);
        // Appended rather than claimed by the first block that offers one.
        // Resolution happens AFTER this walk, so a first image whose only
        // candidate is a deleted media id would otherwise consume the slot and
        // leave the page with no picture even though a later image renders
        // fine. Order is preserved, so the earliest block that actually
        // resolves still wins.
        images.push(...candidates(offer.image));
      }

      // Visited in the order the DEFINITION declares its slots, and only those
      // it declares. Stored order is insertion order of a JSON object and is
      // decided by whatever last wrote the row, so it carries no information
      // about the page at all; a stored slot the definition no longer declares
      // is not rendered either.
      //
      // Declared order is a BETTER signal, not a guaranteed one, and the
      // difference is worth stating. `slots` is a record of named regions and
      // nothing binds its property order to the order `render` calls
      // `renderSlot` — a block declaring `{ sidebar, main }` while drawing
      // `main` first is valid, and this would take the sidebar's heading as the
      // page's. Closing that needs the definition to state its draw order,
      // which is the same Block API question `conditionalSlots` provisionally
      // answers and belongs with it at the freeze rather than guessed here.
      //
      // The exposure is bounded by what it costs: picking a later heading over
      // an earlier one is a WORSE title for content that is genuinely on the
      // page, not a leak of content that is not.
      //
      // What this cannot decide: a container that renders its slots
      // CONDITIONALLY, such as tabs drawing only the active panel. That is
      // settled by calling the block, which is a render, not a document read.
      // A heading in an inactive panel can therefore still be chosen; closing
      // that needs the definition to state which slots contribute, which is an
      // API question rather than a walk question.
      const slots = node.slots;
      if (slots) {
        // A definition declaring NO slots is a leaf, and a leaf never calls
        // `renderSlot` — so stale or hand-edited children under one are not on
        // the page and must not speak for it. `undefined` means exactly that
        // here: the caller has already dropped nodes whose definition is
        // unknown, so the only way to reach this with no declaration is to BE
        // a leaf. Falling back to the stored keys conflated the two and let a
        // heading beneath a leaf supply the title.
        const definition = definitions(node.type);
        const declared = definition?.slots ?? {};
        // A slot the block may decline to draw cannot speak for the page. The
        // walk reads a stored document and cannot know whether the block DID
        // draw it — that is settled by calling the block, which is a render —
        // so a slot declared conditional is skipped outright. `core/collection-
        // loop` is the case that forces it: an empty query renders no children
        // at all, and its template's heading would otherwise become a title for
        // content the page does not contain.
        //
        // Skipped rather than guessed in either direction, and this is the
        // cautious one: a conditional slot that WAS drawn loses its
        // contribution, which costs a field the page could have filled, while
        // the reverse publishes text that was never served.
        const conditional = new Set(definition?.conditionalSlots ?? []);
        const order = Object.keys(declared).filter(
          name => name in slots && !conditional.has(name)
        );
        for (const name of order) {
          const children = slots[name];
          if (children) visit(children);
        }
      }
    }
  };
  visit(document.nodes);
  if (images.length > 0) derived.image = images;

  // `??=` assigns `undefined` when the offer had nothing, which would leave the
  // key present and defeat spreading over a caller's fallbacks. Dropped here
  // rather than guarded at each assignment, which would repeat the check three
  // times for one rule.
  for (const key of Object.keys(derived) as (keyof DerivedSeo)[]) {
    if (derived[key] === undefined) delete derived[key];
  }
  return derived;
}
