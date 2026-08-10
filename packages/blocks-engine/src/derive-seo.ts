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
import type { BlockSeoContribution } from "./block";
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
  image?: string[];
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
    }
  | undefined;

/** Trimmed text, or undefined when there is none worth using. */
function usable(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * An offer's image candidates, best first, with the empty ones dropped.
 *
 * A block may answer with one value or an ordered list, and both collapse to
 * the same thing here so the caller resolves a single shape. Normalizing at
 * the boundary rather than at each use is what keeps "the first that resolves"
 * from having to know which form it was given.
 */
function candidates(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = typeof value === "string" ? [value] : value;
  return list
    .map(entry => usable(entry))
    .filter((entry): entry is string => entry !== undefined);
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
  try {
    return definition.seo(node.props as never);
  } catch {
    return undefined;
  }
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

  const filled = (): boolean =>
    derived.title !== undefined &&
    derived.description !== undefined &&
    derived.image !== undefined;

  // Walked here rather than through `walkNodes`, which descends into every
  // slot unconditionally. A gated node takes its whole SUBTREE out of the
  // output, so a visible-looking child of a hidden container must not speak for
  // a page it never reaches — and stopping the descent is the only way to say
  // that. An ancestor check at each node would be the same rule paid for
  // repeatedly, and one that only looked at the immediate parent would miss a
  // gated grandparent entirely.
  const visit = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      // Cheap exit once nothing is left to learn. The tree is bounded by the
      // document's own caps, but a long page still walks every node otherwise.
      if (filled()) return;
      if (!isVisible(node)) continue;

      const offer = offerOf(node, definitions);
      if (offer) {
        derived.title ??= usable(offer.title);
        derived.description ??= usable(offer.description);
        if (derived.image === undefined) {
          const offered = candidates(offer.image);
          if (offered.length > 0) derived.image = offered;
        }
      }

      if (node.slots) {
        for (const children of Object.values(node.slots)) visit(children);
      }
    }
  };
  visit(document.nodes);

  // `??=` assigns `undefined` when the offer had nothing, which would leave the
  // key present and defeat spreading over a caller's fallbacks. Dropped here
  // rather than guarded at each assignment, which would repeat the check three
  // times for one rule.
  for (const key of Object.keys(derived) as (keyof DerivedSeo)[]) {
    if (derived[key] === undefined) delete derived[key];
  }
  return derived;
}
