/**
 * Where a block added from the panel goes, said in words: "Adding inside
 * Hero, at the end", "Adding after Heading, inside Hero", "Adding at the end
 * of the page", "Adding between Hero and Pricing". One place says it, so the
 * Add panel, the Components panel, the editor's search and the sentence an
 * insert is announced with name a place the same way.
 *
 * @module insert-placement-words
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import type * as React from "react";

import type { InsertionCandidate } from "./inserter";
import { layerLabel } from "./layers";

/**
 * One piece of a place's words: a place named by a block ("after Heading",
 * drawn bold), or the plain words between them.
 */
interface PlacePart {
  readonly text: string;
  readonly named: boolean;
}

/**
 * A place's words, in pieces: where it is beside or in a block, named as
 * Layers names it, then, where that place is itself inside a block, which.
 */
function placeParts(
  document: BlockDocument,
  candidate: InsertionCandidate
): readonly PlacePart[] {
  const named = (text: string): PlacePart => ({ text, named: true });
  const plain = (text: string): PlacePart => ({ text, named: false });
  const name = (id: string | undefined): string => {
    const node = id === undefined ? undefined : findNode(document.nodes, id);
    // The ids come from this same document, so the guard holds; the words
    // still say something true if it ever does not.
    return node === undefined ? "the selected block" : layerLabel(node);
  };
  if (candidate.kind === "document-end") {
    return [plain("at the end of the page")];
  }
  if (candidate.kind === "inside") {
    return [named(`inside ${name(candidate.insideId)}`), plain(", at the end")];
  }
  const beside =
    candidate.kind !== "between"
      ? `after ${name(candidate.afterId)}`
      : candidate.afterId === undefined
        ? `before ${name(candidate.beforeId)}`
        : `between ${name(candidate.afterId)} and ${name(candidate.beforeId)}`;
  const parentId = candidate.at.parentId;
  return parentId === undefined
    ? [named(beside)]
    : [named(beside), plain(", "), named(`inside ${name(parentId)}`)];
}

/** A place in plain words: "inside Hero, at the end", "after Heading, inside Hero". */
export function placeWords(
  document: BlockDocument,
  candidate: InsertionCandidate
): string {
  return placeParts(document, candidate)
    .map(part => part.text)
    .join("");
}

/** "Adding after Heading, inside Hero", say, with the places in bold. */
export function placementWords(
  lead: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): React.ReactNode {
  return (
    <>
      {`${lead} `}
      {placeParts(document, candidate).map((part, index) =>
        part.named ? <b key={index}>{part.text}</b> : part.text
      )}
    </>
  );
}

/** The same place as one plain sentence, for a tile's description. */
export function placementSentence(
  lead: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): string {
  return `${lead} ${placeWords(document, candidate)}.`;
}

/**
 * What an insert is announced with: "Heading added inside Hero, at the end".
 * Read from the page as it was before the insert, where the place was named.
 */
export function insertedAnnouncement(
  label: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): string {
  return `${label} added ${placeWords(document, candidate)}`;
}
