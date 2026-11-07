/**
 * `core/table-of-contents` — the headings of a passage, as links to them.
 *
 * It lists a rich-text value's headings, nested as the passage nests them, each
 * linking to the anchor `core/rich-text` gives that heading. On a collection
 * template its `content` is bound to the same field as the article's body, so a
 * post's contents sit beside the post and follow it as it is edited.
 *
 * ## One reading of the passage
 *
 * The anchors come from {@link headingAnchors}, the function `core/rich-text`
 * draws its heading ids with. Both blocks read the same value through the same
 * function, so a contents link and the heading it names cannot disagree.
 *
 * ## Nested, not indented
 *
 * A heading one level below the one before it is listed inside that one's
 * list, rather than in one flat list with an indent. A screen reader announces
 * the nesting ("list, 3 items, level 2"); an indent says it to sighted readers
 * only. A heading deeper than the one before it by more than a level nests one
 * level, so no list item is ever drawn empty to make room.
 *
 * ## When there is nothing to list
 *
 * A visitor gets nothing at all: an empty contents box is noise above an
 * article. An author, on the canvas or a preview, sees the block's frame with a
 * line saying why it is empty, so a block bound to a post with no headings yet
 * can still be found, selected and styled.
 *
 * @module blocks/table-of-contents
 */
import {
  type BlockDefinition,
  defineBlock,
  RICH_TEXT_PROP_TYPE,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement, ReactNode } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";
import { headingAnchors, type HeadingAnchor } from "./heading-anchors";
import { flag, oneOf, text } from "./props";

/** This block's registered name. */
const TABLE_OF_CONTENTS_BLOCK = "core/table-of-contents";

/** Which headings a contents block lists, from the top level down. */
export const TABLE_OF_CONTENTS_DEPTHS = ["h2", "h2-h3", "h2-h4"] as const;

export type TableOfContentsDepth = (typeof TABLE_OF_CONTENTS_DEPTHS)[number];

/** The deepest heading level each depth lists. */
const DEEPEST: Readonly<Record<TableOfContentsDepth, number>> = {
  h2: 2,
  "h2-h3": 3,
  "h2-h4": 4,
};

/** The title a block shows when its own is empty, and its landmark's name. */
const DEFAULT_TITLE = "On this page";

/** What an author reads on a block with nothing to list. */
const NOTHING_TO_LIST =
  "No headings to list yet. Bind Content to the rich text this lists; its headings appear here.";

export interface TableOfContentsProps {
  /** The passage whose headings are listed, usually bound to the entry's body. */
  content?: RichTextValue;
  /** The label above the list, and the name of the navigation landmark. */
  title?: string;
  /** Which heading levels are listed. */
  depth?: TableOfContentsDepth;
  /** Whether the list folds away under its title, starting open. */
  collapsible?: boolean;
}

/** One listed heading and the headings listed inside it. */
interface OutlineItem {
  readonly anchor: HeadingAnchor;
  readonly children: OutlineItem[];
}

/**
 * The listed headings as a tree. Each heading goes inside the nearest heading
 * before it of a higher level, so a level skipped in the passage (an h4 after
 * an h2) nests one level, not two.
 */
function outline(anchors: readonly HeadingAnchor[]): OutlineItem[] {
  const top: OutlineItem[] = [];
  const open: { rank: number; children: OutlineItem[] }[] = [
    { rank: 0, children: top },
  ];
  for (const anchor of anchors) {
    while (open.length > 1 && open[open.length - 1].rank >= anchor.rank) {
      open.pop();
    }
    const item: OutlineItem = { anchor, children: [] };
    open[open.length - 1].children.push(item);
    open.push({ rank: anchor.rank, children: item.children });
  }
  return top;
}

function OutlineList({
  items,
  partClass,
  nested,
}: {
  items: readonly OutlineItem[];
  partClass: (name: string) => string;
  nested: boolean;
}): ReactElement {
  // `role="list"` restates what `<ol>` already is: Safari's screen reader
  // drops list semantics from a list whose markers a stylesheet removed, which
  // this block's own defaults do.
  return (
    <ol role="list" className={partClass(nested ? "sublist" : "list")}>
      {items.map(item => (
        <li key={item.anchor.id} className={partClass("item")}>
          <a href={`#${item.anchor.id}`} className={partClass("link")}>
            {item.anchor.text}
          </a>
          {item.children.length > 0 ? (
            <OutlineList
              items={item.children}
              partClass={partClass}
              nested={true}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function renderTableOfContents({
  props,
  ctx,
  className,
  partClass,
  markProp,
}: BlockRenderArgs<TableOfContentsProps>): ReactElement | null {
  const deepest =
    DEEPEST[oneOf(props.depth, TABLE_OF_CONTENTS_DEPTHS, "h2-h3")];
  // Level 1 is the page's own title, never an entry in its contents.
  const listed = headingAnchors(props.content).filter(
    anchor => anchor.rank >= 2 && anchor.rank <= deepest
  );
  const authorLooking = ctx.diagnostics === true;
  if (listed.length === 0 && !authorLooking) return null;

  const ownTitle = text(props.title).trim();
  const title = ownTitle === "" ? DEFAULT_TITLE : ownTitle;
  const titleClass = partClass("title");
  const body: ReactNode =
    listed.length > 0 ? (
      <OutlineList
        items={outline(listed)}
        partClass={partClass}
        nested={false}
      />
    ) : (
      <p className={partClass("note")}>{NOTHING_TO_LIST}</p>
    );

  if (flag(props.collapsible, true)) {
    return (
      <nav className={className} aria-label={title}>
        <details open>
          {/* The browser's own marker and keyboard: it folds with no script. */}
          <summary className={titleClass} {...markProp?.("title")}>
            {title}
          </summary>
          {body}
        </details>
      </nav>
    );
  }
  return (
    <nav className={className} aria-label={title}>
      <p className={titleClass} {...markProp?.("title")}>
        {title}
      </p>
      {body}
    </nav>
  );
}

/** A margin of nothing, written on every side so no browser default survives. */
const NO_MARGIN = {
  blockStart: "0",
  blockEnd: "0",
  inlineStart: "0",
  inlineEnd: "0",
} as const;

/**
 * The parts' defaults: lists without markers or a browser's gutter, since the
 * nesting is what shows the structure; a nested list set in by one `em`; one
 * line's breathing room between entries; and a title in the weight of a
 * label. Everything else inherits from the block, so a template styles the
 * contents by styling the block.
 */
const TABLE_OF_CONTENTS_PARTS = {
  title: {
    baseStyles: {
      base: { base: { fontWeight: 600, margin: NO_MARGIN } },
    },
  },
  list: {
    baseStyles: {
      base: {
        base: {
          listStyleType: "none",
          margin: { ...NO_MARGIN, blockStart: "0.75em" },
          padding: { inlineStart: "0" },
        },
      },
    },
  },
  sublist: {
    baseStyles: {
      base: {
        base: {
          listStyleType: "none",
          margin: NO_MARGIN,
          padding: { inlineStart: "1em" },
        },
      },
    },
  },
  item: {
    baseStyles: {
      base: { base: { margin: { ...NO_MARGIN, blockStart: "0.5em" } } },
    },
  },
  link: {},
  note: {
    baseStyles: {
      base: { base: { margin: { ...NO_MARGIN, blockStart: "0.75em" } } },
    },
  },
} as const;

/** A passage with headings, so a newly placed block shows what it does. */
const EXAMPLE_PASSAGE: RichTextValue = {
  root: {
    type: "root",
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Getting started", format: 0 }],
      },
      {
        type: "heading",
        tag: "h3",
        children: [{ type: "text", text: "Install", format: 0 }],
      },
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Next steps", format: 0 }],
      },
    ],
  },
};

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const tableOfContents: BlockDefinition<
  TableOfContentsProps,
  PageContext
> = defineBlock({
  name: TABLE_OF_CONTENTS_BLOCK,
  version: 1,
  // What an author reads, in the Add panel and the block card: one plain line.
  description: "Links to the headings of a passage of rich text.",
  editor: {
    label: "Table of contents",
    icon: "list",
    category: CONTENT,
    keywords: ["toc", "contents", "outline", "anchors", "on this page"],
  },
  parts: TABLE_OF_CONTENTS_PARTS,
  props: {
    // Not inline and not content: the passage is read, never typed here. It
    // takes its value from a binding, as any rich-text prop can.
    content: { label: "Content", type: RICH_TEXT_PROP_TYPE },
    title: { label: "Title", role: "content", type: "text", inline: true },
    depth: {
      label: "Headings listed",
      optionLabels: {
        h2: "H2 only",
        "h2-h3": "H2 and H3",
        "h2-h4": "H2 to H4",
      },
      type: "select",
      options: [...TABLE_OF_CONTENTS_DEPTHS],
    },
    collapsible: { label: "Can be folded away", type: "checkbox" },
  },
  defaultProps: { title: DEFAULT_TITLE, depth: "h2-h3", collapsible: true },
  example: {
    props: {
      title: DEFAULT_TITLE,
      depth: "h2-h3",
      collapsible: true,
      content: EXAMPLE_PASSAGE,
    },
  },
  supports: {
    typography: true,
    color: true,
    spacing: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
  },
  // A navigation landmark of links, folded in a `<details>` by default: flow
  // content that is interactive while it draws a link or the disclosure.
  contentModel: () => ({ is: ["flow", "interactive"] }),
  render: renderTableOfContents,
});
