/**
 * The first accessibility check: an image a visitor sees, with no alt text
 * and not marked decorative, which a screen reader then announces by its
 * file name or not at all.
 *
 * It judges only what the page itself decides, read the way the block reads
 * it (`image-group`): decorative first, then an alt the page stores (an empty
 * one included, the block's own way to say "decorative"), then the library's.
 * So it leaves alone an image whose picture comes from the media library,
 * whose words come from there, an alt text bound to a field, and an image
 * with no picture yet, which draws nothing to describe. An image whose
 * picture is bound to a field is listed more softly, as "may be missing":
 * each entry brings its own picture, and some may have no words.
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
import { bound, holds } from "./stored-values";

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
 * What the page says of an image's words: described (an alt of its own or
 * decorative, a bound alt, a picture from the library, which brings the
 * library's, or no picture at all), missing, or possibly missing, where the
 * picture is bound to a field and each entry's may come with none.
 */
function altState(
  node: BlockNode,
  { alt, source }: Required<ImageGroup>
): "described" | "missing" | "may-be-missing" {
  if (altModeOf(alt, node.props) !== "library" || bound(node, alt.alt)) {
    return "described";
  }
  if (bound(node, source.media) || bound(node, source.address)) {
    return "may-be-missing";
  }
  if (holds(node.props[source.media])) return "described";
  return holds(node.props[source.address]) ? "missing" : "described";
}

/** The finding for one image, or nothing when it is described or exempt. */
function missingAlt(
  node: BlockNode,
  page: ResolvedPage
): PageCheckResult | undefined {
  const image = imageOf(node, page);
  const state = image === undefined ? "described" : altState(node, image);
  if (image === undefined || state === "described") return undefined;
  const fix = { tab: "content", id: image.alt.alt } as const;
  if (state === "may-be-missing") {
    return {
      nodeId: node.id,
      part: "may-be-missing",
      what: "Image may be missing alt text",
      why: "Its picture comes from a field, and a picture there may have no alt text, so screen readers can’t describe it.",
      todo: "Write alt text here, bind Alt text to a field, or tick “Decorative, no alt text” if it only decorates.",
      fix,
    };
  }
  return {
    nodeId: node.id,
    what: "Image has no alt text",
    why: "Screen readers can’t describe the picture to people who can’t see it.",
    todo: "Describe the picture in Alt text, or tick “Decorative, no alt text” if it only decorates.",
    fix,
  };
}

/** Every image on the page with no alt text, in page order. */
export const IMAGE_ALT_CHECK: PageCheck = {
  id: "image-alt",
  group: "accessibility",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.drawn as BlockNode[], node => {
      const finding = missingAlt(node, page);
      if (finding !== undefined) found.push(finding);
    });
    return found;
  },
};
