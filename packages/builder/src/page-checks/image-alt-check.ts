/**
 * The first accessibility check: an image a visitor sees, with no alt text
 * and not marked decorative, which a screen reader then announces by its
 * file name or not at all.
 *
 * It judges only what the page itself decides, read the way the block reads
 * it (`image-group`): decorative first, then an alt the page stores (an empty
 * one included, the block's own way to say "decorative"), then the library's.
 * So it leaves alone an image whose picture comes from the media library or
 * from a binding, whose words may come from there, an alt text bound to a
 * field, and an image with no picture yet, which draws nothing to describe.
 *
 * Which props are an image's alt text is the inspector's answer
 * (`imageGroupOf`), so the check finds every block the panel draws an alt
 * field for, and its fix opens that field.
 *
 * @module page-checks/image-alt-check
 */
import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";

import { altModeOf, imageGroupOf, type ImageGroup } from "../image-group";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";

/** A stored value with something in it. */
function holds(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  return value !== undefined && value !== null;
}

/** Whether a prop is bound to a field. */
function bound(node: BlockNode, prop: string): boolean {
  return node.bindings?.[prop] !== undefined;
}

/** The props a block's image is drawn from, where it has an alt text. */
function imageOf(
  node: BlockNode,
  page: ResolvedPage
): Required<ImageGroup> | undefined {
  const declared = page.blocks(node.type)?.props;
  if (declared === undefined) return undefined;
  const group = imageGroupOf(
    Object.entries(declared).flatMap(([name, schema]) =>
      schema === undefined ? [] : [{ name, schema }]
    )
  );
  return group?.alt === undefined || group.source === undefined
    ? undefined
    : { alt: group.alt, source: group.source };
}

/**
 * Whether the page leaves the words to someone else, or has said them: an
 * alt of its own or decorative, a bound alt, a picture from the library or a
 * binding (which may bring its own words), or no picture at all.
 */
function answered(node: BlockNode, { alt, source }: Required<ImageGroup>) {
  if (altModeOf(alt, node.props) !== "library" || bound(node, alt.alt)) {
    return true;
  }
  if (holds(node.props[source.media]) || bound(node, source.media)) {
    return true;
  }
  return bound(node, source.address) || !holds(node.props[source.address]);
}

/** The finding for one image, or nothing when it is described or exempt. */
function missingAlt(
  node: BlockNode,
  page: ResolvedPage
): PageCheckResult | undefined {
  const image = imageOf(node, page);
  if (image === undefined || answered(node, image)) return undefined;
  return {
    nodeId: node.id,
    what: "Image has no alt text",
    why: "Screen readers can’t describe the picture to people who can’t see it.",
    todo: "Describe the picture in Alt text, or tick “Decorative, no alt text” if it only decorates.",
    fix: { tab: "content", id: image.alt.alt },
  };
}

/** Every image on the page with no alt text, in page order. */
export const IMAGE_ALT_CHECK: PageCheck = {
  id: "image-alt",
  group: "accessibility",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.document.nodes, node => {
      const finding = missingAlt(node, page);
      if (finding !== undefined) found.push(finding);
    });
    return found;
  },
};
