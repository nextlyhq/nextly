/**
 * The note an unbind leaves under its field: what it kept, or why it was
 * refused.
 *
 * @module binding-notes
 */
import { Check, EyeOff } from "lucide-react";
import * as React from "react";

import type { UnbindAnswer } from "./composition-actions";
import { fieldLabel } from "./inspector";

/**
 * What an unbind said, and how: kept as visitors saw it, kept in place of a
 * field visitors can't read, or refused.
 */
export interface UnbindNote {
  readonly text: string;
  readonly tone: "kept" | "private" | "refused";
}

/** The note an unbind leaves under its field. */
export function UnboundNote({ note }: { note: UnbindNote }): React.JSX.Element {
  return (
    <p className="nx-binding-note" data-tone={note.tone} role="status">
      {note.tone === "kept" ? <Check aria-hidden="true" size={14} /> : null}
      {note.tone === "private" ? <EyeOff aria-hidden="true" size={14} /> : null}
      <span>
        {note.tone === "refused" ? note.text : `Unbound. ${note.text}`}
      </span>
    </p>
  );
}

/**
 * What an unbind kept, said as the author reads it: the block keeps what
 * visitors saw, the fallback, or its own value. The answer's own reason
 * says more, for an API client; the note says what changed on the page.
 */
export function noteFor(
  answer: UnbindAnswer,
  blockLabel: string,
  propName: string,
  /** The bound field, named as the chip names it. */
  fieldName: string,
  /** The block's label for the prop an image's address went into. */
  intoLabel?: string
): string {
  const block = `The ${blockLabel.toLowerCase()}`;
  const value =
    typeof answer.value === "string" && answer.value !== ""
      ? `: “${answer.value}”`
      : "";
  // A field visitors can't read: its value was never copied in, and the note
  // says so before what was kept in its place. Said first, since what was
  // kept matters less than that the field is private.
  if (answer.unreadable === true) {
    const unread = `Visitors can't read “${fieldName}”, so its value wasn't copied in.`;
    return answer.kept === "fallback"
      ? `${unread} ${block} keeps the fallback${value}.`
      : `${unread} ${block} keeps its own ${propName.toLowerCase()}.`;
  }
  // A link's entry kept by reference: the link goes on to the page visitors
  // were sent to, named by its title where a visitor may read it, never by
  // the id the prop now holds.
  if (answer.entry !== undefined) {
    const title = answer.entry.title;
    const page =
      title === undefined ? "the page visitors saw" : `${title}'s page`;
    return `The link keeps going to ${page}.`;
  }
  // An image kept by its address goes to another prop than the one unbound,
  // which is left empty, so the note names where the address went.
  if (answer.into !== undefined) {
    const into = intoLabel ?? fieldLabel(answer.into);
    switch (answer.kept) {
      case "visitor":
        return `Visitors saw an image address, not a library image, so it's kept in ${into}.`;
      // The fallback is said where it is what visitors saw: the binding's
      // own address, not one the field gave.
      case "fallback":
        return `Visitors saw the fallback's image address, so it's kept in ${into}.`;
      default:
        return `The image address given is kept in ${into}.`;
    }
  }
  switch (answer.kept) {
    case "visitor":
      return `${block} keeps what visitors saw${value}.`;
    case "fallback":
      return `Visitors saw the fallback, so ${block.toLowerCase()} keeps it${value}.`;
    case "own":
      return `${block} keeps its own ${propName.toLowerCase()}.`;
    default:
      return `${block} keeps the value given${value}.`;
  }
}
