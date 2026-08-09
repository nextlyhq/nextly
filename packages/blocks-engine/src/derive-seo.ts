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
import { walkNodes } from "./tree";

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
  definitions: SeoDefinitionSource
): BlockSeoContribution {
  const derived: BlockSeoContribution = {};

  walkNodes(document.nodes, node => {
    // Every field already filled: nothing further to learn, and the walk is
    // over a tree whose size the document caps rather than a bounded list.
    if (
      derived.title !== undefined &&
      derived.description !== undefined &&
      derived.image !== undefined
    ) {
      return;
    }
    const offer = offerOf(node, definitions);
    if (!offer) return;
    derived.title ??= usable(offer.title);
    derived.description ??= usable(offer.description);
    derived.image ??= usable(offer.image);
  });

  // `??=` assigns `undefined` when the offer had nothing, which would leave the
  // key present and defeat spreading over a caller's fallbacks. Dropped here
  // rather than guarded at each assignment, which would repeat the check three
  // times for one rule.
  for (const key of Object.keys(derived) as (keyof BlockSeoContribution)[]) {
    if (derived[key] === undefined) delete derived[key];
  }
  return derived;
}
