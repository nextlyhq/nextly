/**
 * Where a block added from the panel goes, said in words: "Adding after
 * Heading", "Adding inside Section", "Adding at the end of the page". One
 * place says it, so the Add panel, the Components panel and the editor's
 * search name a place the same way.
 *
 * @module insert-placement-words
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import type * as React from "react";

import type { InsertionCandidate } from "./inserter";
import { layerLabel } from "./layers";

/**
 * Where a place is, in words: "after", "inside" or "at the end of the page",
 * and the block it is beside or in, named as Layers names it.
 */
export function placeParts(
  document: BlockDocument,
  candidate: InsertionCandidate
): { where: string; name?: string } {
  if (candidate.kind === "document-end") {
    return { where: "at the end of the page" };
  }
  const inside = candidate.kind === "inside";
  const id = inside ? candidate.insideId : candidate.afterId;
  const node = id === undefined ? undefined : findNode(document.nodes, id);
  // The guard is over an id the candidate was built from this same document,
  // so it holds; the words still say something true if it ever does not.
  return {
    where: inside ? "inside" : "after",
    name: node === undefined ? "the selected block" : layerLabel(node),
  };
}

/** "Adding after Heading", say, with the block's name in bold. */
export function placementWords(
  lead: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): React.ReactNode {
  const { where, name } = placeParts(document, candidate);
  return name === undefined ? (
    `${lead} ${where}`
  ) : (
    <>
      {`${lead} ${where} `}
      <b>{name}</b>
    </>
  );
}
