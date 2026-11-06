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
 * it, so it has to describe the same tree: the one the renderer walks, from its
 * own pipeline — format guard, shape repair under the site's caps, component
 * resolution, migration, condition gating, id repair. A block the renderer
 * draws as a placeholder keeps its place, since it takes one on the page.
 * Listing the stored nodes instead would number a condition-gated section the
 * preview leaves out, and every number after it would point one section too
 * far down the page.
 *
 * ## Drawn by one id, opened by another
 *
 * A placed component draws as its definition's nodes, which carry ids minted
 * for the drawing; the editor's document holds the instance the author placed.
 * So each section keeps the id it was drawn with, which is how the preview
 * finds it, and a `target`, which is how the builder opens it: the instance a
 * drawn node came from, or the node itself. It is named as Layers names that
 * target.
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
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  prepareDocumentAsDrawn,
  type BlockResolver,
} from "@nextlyhq/blocks-react";
import { layerLabel, type ComponentTitleOf } from "@nextlyhq/builder";

import type { PageRenderInputs } from "./page-render-inputs";
import { documentNodes } from "./page-summary";

/** One section of the page, as the entry screen lists it. */
export interface PageSection {
  /** The id the section is drawn with, which is how the preview finds it. */
  id: string;
  /**
   * Every top-level node the section is drawn as, `id` first: one for an
   * author's own block, each root of a placed component's definition.
   */
  parts: readonly string[];
  /** The id the builder opens at: the placed instance it came from, or itself. */
  target: string;
  /** Its place on the page, counting from 1. */
  number: number;
  /** Its name: the author's, else its component's title or its block's. */
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
 * @param componentTitle - a placed component's title by id, so its section
 *   reads as what the author placed, as it does in Layers
 * @returns the sections in page order, or none when nothing would be drawn
 */
export function pageSections(
  value: unknown,
  resolver: BlockResolver,
  render: Pick<PageRenderInputs, "limits" | "styleContext" | "definitions">,
  componentTitle?: ComponentTitleOf
): PageSection[] {
  // The pipeline expects a document; anything without a node list draws
  // nothing, which is what the preview shows for it too.
  if (documentNodes(value).length === 0) return [];
  const prepared = prepareDocumentAsDrawn(value as BlockDocument, {
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
  const stored = new Map(documentNodes(value).map(node => [node.id, node]));
  return groupByTarget(prepared.nodes).map(({ target, nodes }, index) => {
    // Every node is offered: the tree was already gated above, so nothing left
    // in it is withheld from the reader this describes.
    const text = deriveSeoFromDocument(
      { ...prepared, nodes },
      lookup,
      () => true
    );
    const first = nodes[0];
    return {
      id: first.id,
      parts: nodes.map(node => node.id),
      target,
      number: index + 1,
      label: layerLabel(stored.get(target) ?? first, lookup, componentTitle),
      firstLine: text.title ?? text.description ?? "",
    };
  });
}

/**
 * The drawn top-level nodes, gathered by what the author placed.
 *
 * `instanceOf` is set by component resolution on every node a definition
 * contributed, naming the instance on the page; an author's own node has none
 * and stands alone. A placed component whose definition has several top-level
 * nodes is one thing the author placed, so its roots — drawn one after another
 * where the instance stood — are one section.
 */
function groupByTarget(
  nodes: readonly BlockNode[]
): { target: string; nodes: BlockNode[] }[] {
  const groups: { target: string; nodes: BlockNode[] }[] = [];
  for (const node of nodes) {
    const host = (node as { instanceOf?: unknown }).instanceOf;
    const target = typeof host === "string" ? host : node.id;
    const last = groups.at(-1);
    if (typeof host === "string" && last?.target === target) {
      last.nodes.push(node);
    } else {
      groups.push({ target, nodes: [node] });
    }
  }
  return groups;
}
