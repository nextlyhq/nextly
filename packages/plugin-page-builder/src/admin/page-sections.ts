/**
 * The page's sections, as the entry screen lists them under its preview.
 *
 * A section is a top-level block. Each is numbered in page order, named as
 * Layers names it, and given its first heading or, without one, its first line
 * of prose — enough for an author to recognise the part of the page they want
 * to change without opening the editor to find it.
 *
 * ## The sections the preview DRAWS, not the ones stored
 *
 * The list sits under a preview of the page and its numbers are read against
 * it, so it has to describe the same tree. The document is prepared by the
 * renderer's own pipeline — format guard, shape repair under the site's caps,
 * migration, condition gating, id repair — and only what that leaves is listed.
 * Listing the stored nodes instead would number a condition-gated section the
 * preview leaves out, and every number after it would point one section too
 * far down the page.
 *
 * Preparing first also makes the text walk safe. A stored value has been
 * repaired by nothing, and a hand walk over it can overflow the stack on a
 * deep tree or never return on a cycle; the prepared tree is bounded by the
 * same caps the renderer read it under.
 *
 * ## One answer for each part
 *
 * The name is `layerLabel`, so a section reads the same here and in Layers. The
 * first line is the search-metadata derivation run over the section alone:
 * "the first heading, else the first prose" is exactly what a page's title and
 * description are drawn from, and a second walk deciding which props count as
 * text would come to disagree with it.
 *
 * @module @nextlyhq/plugin-page-builder/admin/page-sections
 */
import {
  deriveSeoFromDocument,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  prepareDocumentForRead,
  type BlockResolver,
} from "@nextlyhq/blocks-react";
import { layerLabel } from "@nextlyhq/builder";

import type { PageRenderInputs } from "./page-render-inputs";
import { documentNodes } from "./page-summary";

/** One section of the page, as the entry screen lists it. */
export interface PageSection {
  /** The block's id, which is what the editor opens at. */
  id: string;
  /** Its place on the page, counting from 1. */
  number: number;
  /** Its name: the author's, or its block's. */
  label: string;
  /** Its first heading, or its first line of prose; empty when it has none. */
  firstLine: string;
}

/**
 * The page's top-level sections, as the preview draws them.
 *
 * @param value - the field's value, which may not be a document at all
 * @param resolver - where block definitions come from, the preview's own
 * @param render - the site's rendering inputs, the preview's own
 * @returns the sections in page order, or none when nothing would be drawn
 */
export function pageSections(
  value: unknown,
  resolver: BlockResolver,
  render: Pick<PageRenderInputs, "limits" | "styleContext" | "definitions">
): PageSection[] {
  // The pipeline expects a document; anything without a node list draws
  // nothing, which is what the preview shows for it too.
  if (documentNodes(value).length === 0) return [];
  const prepared = prepareDocumentForRead(value as BlockDocument, {
    resolver,
    styleContext: render.styleContext,
    ...(render.limits === undefined ? {} : { limits: render.limits }),
    // Spread only when there is something in it, as the renderer does: an
    // empty map and an absent one are reported differently by the pipeline.
    ...(render.definitions.size === 0
      ? {}
      : { definitions: render.definitions }),
  });
  if (prepared === null) return [];

  const lookup = (type: string) => resolver.get(type);
  return prepared.nodes.map((node, index) => {
    // Every node is offered: the tree was already gated above, so nothing left
    // in it is withheld from the reader this describes.
    const text = deriveSeoFromDocument(
      { ...prepared, nodes: [node] },
      lookup,
      () => true
    );
    return {
      id: node.id,
      number: index + 1,
      label: layerLabel(node, lookup),
      firstLine: text.title ?? text.description ?? "",
    };
  });
}
