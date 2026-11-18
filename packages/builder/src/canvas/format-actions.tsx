/**
 * What the format bar's actions say and do, shared by the floating bar over
 * the canvas and the full editor a Rich text opens from the panel, so the
 * two offer the same buttons in the same words and cannot drift apart.
 *
 * Kept apart from the bar itself, which is drawn in the canvas overlay and
 * reads the canvas's own modules: the panel's full editor reads these
 * without them.
 *
 * @module format-actions
 */

import { isLinkableUrl } from "@nextlyhq/blocks-engine";
import { List, ListOrdered, Quote } from "lucide-react";
import type * as React from "react";

import type {
  FormatBlockAction,
  FormatSelection,
  FormatSession,
} from "./format-bar-state";

/** The words the bar and its notice say, in one place. */
export const FORMAT_BAR_WORDS = {
  bar: "Text formatting",
  bold: "B",
  boldName: "Bold",
  italic: "I",
  italicName: "Italic",
  link: "Link",
  h2: "H2",
  h2Name: "Heading 2",
  h3: "H3",
  h3Name: "Heading 3",
  bullet: "Bullets",
  number: "Numbers",
  quote: "Quote",
  turnInto: "Turn into",
  address: "Link address",
  addressHint: "Paste or type an address",
  newTab: "Open in a new tab",
  apply: "Apply",
  removeLink: "Remove link",
  badAddress: "This address can't be used for a link.",
  dropped:
    "Text keeps words, bold, italic and links. Use Rich text for headings and lists",
  toRichText: "Turn into Rich text",
  dismiss: "Dismiss",
} as const;

/**
 * Link the selected words to `address`, answering whether it was taken: an
 * empty address takes a link off (or does nothing), and one this format
 * cannot express — `javascript:`, `data:` — is refused.
 */
export function linkTo(
  session: Pick<FormatSession, "link">,
  address: string,
  newTab: boolean,
  linked: boolean
): boolean {
  const url = address.trim();
  if (url === "") {
    if (linked) session.link(null);
    return true;
  }
  if (!isLinkableUrl(url)) return false;
  session.link(url, { newTab });
  return true;
}

/**
 * What a block button shows and is named: H2 and H3 by their words, the
 * lists and the quote by their marks, each named in words. Shared with the
 * full editor, so its buttons say what the bar's say.
 */
export const BLOCK_BUTTON_FACES: Record<
  FormatBlockAction,
  { readonly face: React.ReactNode; readonly name: string }
> = {
  h2: { face: FORMAT_BAR_WORDS.h2, name: FORMAT_BAR_WORDS.h2Name },
  h3: { face: FORMAT_BAR_WORDS.h3, name: FORMAT_BAR_WORDS.h3Name },
  bullet: {
    face: <List aria-hidden="true" size={14} />,
    name: FORMAT_BAR_WORDS.bullet,
  },
  number: {
    face: <ListOrdered aria-hidden="true" size={14} />,
    name: FORMAT_BAR_WORDS.number,
  },
  quote: {
    face: <Quote aria-hidden="true" size={14} />,
    name: FORMAT_BAR_WORDS.quote,
  },
};

/** Whether the caret's block is the one `action` makes, so its button is on. */
export function blockIsOn(
  selection: FormatSelection | null | undefined,
  action: FormatBlockAction
): boolean {
  return selection?.block === action;
}
