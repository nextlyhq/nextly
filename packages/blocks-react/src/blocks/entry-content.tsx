/**
 * `core/entry-content` — the entry's own blocks content, drawn inside its
 * collection's template.
 *
 * A template draws every entry of its collection; a post's Body is the post's
 * own. This block marks where that content goes and stores which top-level
 * blocks field it is (`field`). It holds nothing itself: its slot is locked
 * empty, and the host composes the entry's blocks into it before the page is
 * drawn (`composeEntryContent` in the engine), so this draws them through
 * `renderSlot` like any container's children, with their own styles, in the
 * one render the template is drawn by.
 *
 * - On a published page it draws the entry's content as the route read the
 *   entry, with the public's access. Where there is none to draw (the public
 *   may not read the field, it is empty, or the field is gone) it draws
 *   nothing: no element and no data.
 * - On the editor's canvas (`ctx.entryContentCanvas`), the content is the
 *   entry's, edited on the entry, so it is drawn for looking at: the canvas
 *   keeps the pointer off it, and a click selects this block. Where there is
 *   none to draw, the canvas's note says why, in the canvas's words.
 *
 * @experimental Settles when collection templates ship.
 * @module blocks/entry-content
 */
import {
  type BlockDefinition,
  defineBlock,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryContentFieldOf,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type {
  BlockRenderArgs,
  EntryContentNote,
  PageContext,
} from "../context";
import {
  ENTRY_CONTENT_DRAWN_ATTRIBUTE,
  ENTRY_CONTENT_NOTE_ATTRIBUTE,
} from "../editor-markers";

import { ENTRY } from "./categories";
import { CONTAINER_CHILD_GAP, CONTAINER_SUPPORTS } from "./container";

export interface EntryContentProps {
  /** The top-level blocks field of the template's collection it draws. */
  field?: string;
}

/** Whether the host composed any of the entry's blocks into the block. */
function holdsContent(
  node: BlockRenderArgs<EntryContentProps>["node"]
): boolean {
  const children = node.slots?.[ENTRY_CONTENT_SLOT];
  return Array.isArray(children) && children.length > 0;
}

/**
 * The red note's mark: a circle with an exclamation, drawn inline as the
 * editor's alert icon is drawn, since a block carries no icon set of its own.
 */
function AlertMark(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

/** The canvas's note, in its tone, the entry's title set apart before it. */
function Note({ note }: { note: EntryContentNote }): ReactElement {
  return (
    <p {...{ [ENTRY_CONTENT_NOTE_ATTRIBUTE]: note.tone }}>
      {note.tone === "failed" ? <AlertMark /> : null}
      <span>
        {note.lead === undefined ? null : <b>{note.lead}</b>}
        {/* The words apart from the title, so the canvas's sheet draws them
            fainter than the title it names. */}
        <span>{note.lead === undefined ? note.words : ` ${note.words}`}</span>
      </span>
    </p>
  );
}

/**
 * The entry's blocks the host composed into the block, or, with none, the
 * canvas's note on the canvas and nothing at all on a published page.
 */
function renderEntryContent({
  node,
  ctx,
  className,
  renderSlot,
}: BlockRenderArgs<EntryContentProps>): ReactElement | null {
  const canvas = ctx.entryContentCanvas;
  if (holdsContent(node)) {
    return (
      <div
        className={className}
        {...(canvas === undefined
          ? {}
          : { [ENTRY_CONTENT_DRAWN_ATTRIBUTE]: "" })}
      >
        {renderSlot(ENTRY_CONTENT_SLOT)}
      </div>
    );
  }
  // Nothing to draw: nothing at all for a visitor, the canvas's note for an
  // author.
  if (canvas === undefined) return null;
  return (
    <div className={className}>
      <Note note={canvas.noteFor(entryContentFieldOf(node))} />
    </div>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const entryContent: BlockDefinition<EntryContentProps, PageContext> =
  defineBlock({
    name: ENTRY_CONTENT_TYPE,
    version: 1,
    // What an author reads, in the Add panel and the block card: one plain line.
    // What the block does, for whoever maintains it: draws the entry's own
    // blocks field inside the collection's template, read-only.
    description: "Shows the entry’s own blocks content, read-only.",
    // Palette metadata. Under a heading of its own, which the Add panel
    // offers only while a template is open.
    editor: {
      label: "Entry content",
      icon: "entry",
      category: ENTRY,
      keywords: ["entry", "body", "content", "post", "template"],
    },
    props: {
      // Which of the collection's top-level blocks fields it draws, chosen
      // from the collection's own in the inspector.
      field: { label: "Field", type: "entryField" },
    },
    defaultProps: {},
    example: { props: {} },
    slots: {
      // Where the host composes the entry's blocks for drawing. Locked empty,
      // so a template never stores anything here, whoever writes it.
      [ENTRY_CONTENT_SLOT]: { lock: "all" },
    },
    // The entry's blocks spaced as a container spaces its children.
    childGap: CONTAINER_CHILD_GAP,
    supports: CONTAINER_SUPPORTS,
    render: renderEntryContent,
  });
