/**
 * What a Table of contents says under "Headings": it lists the page's
 * headings, and any one of them can be left out, from the Heading's own
 * Advanced settings. Said here because the setting lives on each Heading,
 * not on the contents block an author has selected when they look for it.
 *
 * @module toc-left-out-note
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

/** The block the note belongs to. */
const TABLE_OF_CONTENTS_BLOCK = "core/table-of-contents";

/** The setting the note sits under: which heading levels are listed. */
export const TOC_NOTE_PROP = "depth";

/** The note's words, naming the path to the setting. */
export const TOC_LEFT_OUT_HINT =
  "Any heading can be left out: Heading → Advanced → Leave out of table of contents";

/** The note, under a Table of contents' "Headings"; nothing on any other block. */
export function TocLeftOutNote({
  node,
}: {
  node: Pick<BlockNode, "type"> | undefined;
}): React.JSX.Element | null {
  if (node?.type !== TABLE_OF_CONTENTS_BLOCK) return null;
  return <p className="nx-settings-note">{TOC_LEFT_OUT_HINT}</p>;
}
