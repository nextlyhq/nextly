/**
 * `core/table-of-contents` — the page's own headings, as links to them.
 *
 * It lists the headings the page draws, in page order, each linking to the
 * anchor that heading is drawn with: Heading blocks, the headings inside Rich
 * text, and on a collection template the entry's own content. There is
 * nothing to fill in: a heading added, renamed or moved changes the list.
 *
 * ## One reading of the page
 *
 * The headings, their words and their anchors come from the page outline
 * (`ctx.outline`, built once per page after bindings), the same reading the
 * headings take their ids from, so a link and the heading it names cannot
 * disagree. The outline says which headings a table of contents lists
 * (`listed`): the page's own, not the header's or footer's, not inside a
 * Collection list or an accordion, not left out by their author, and not
 * hidden on every device.
 *
 * ## Nested, not indented
 *
 * A heading one level below the one before it is listed inside that one's
 * list, rather than in one flat list with an indent. A screen reader announces
 * the nesting ("list, 3 items, level 2"); an indent says it to sighted readers
 * only. A heading deeper than the one before it by more than a level nests one
 * level, so no list item is ever drawn empty to make room.
 *
 * ## Numbers, bullets and the section being read, with no script
 *
 * Numbers are CSS counters on the nested lists (1, 2, 2.1), drawn before each
 * entry with an empty alternative text, so a screen reader, which already
 * announces each item's place, never reads them twice. Where the browser
 * knows scroll-linked targets, the entry of the section being read is
 * highlighted (`scroll-target-group` on the list, `:target-current` on its
 * links); elsewhere the list works the same, unhighlighted. Folding is the
 * browser's own `<details>`.
 *
 * ## When there is nothing to list
 *
 * A visitor gets nothing at all: an empty contents box is noise above an
 * article. An author, on the canvas or a preview, sees the block's frame with a
 * line saying what to add, so the block can still be found, selected and
 * styled.
 *
 * @module blocks/table-of-contents
 */
import {
  type BlockDefinition,
  defineBlock,
  DISCLOSURE_ICON_CLASS,
  DISCLOSURE_TITLE_CLASS,
} from "@nextlyhq/blocks-engine";
import type { ReactElement, ReactNode } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import type { OutlineHeading } from "../outline";

import { CONTENT } from "./categories";
import { flag, oneOf, text } from "./props";

/** This block's registered name. */
const TABLE_OF_CONTENTS_BLOCK = "core/table-of-contents";

/** Which headings a contents block lists, from the top level down. */
export const TABLE_OF_CONTENTS_DEPTHS = ["h2", "h2-h3", "h2-h4"] as const;

export type TableOfContentsDepth = (typeof TABLE_OF_CONTENTS_DEPTHS)[number];

/** How each entry is marked: numbered (1, 2, 2.1) or with a bullet. */
const TABLE_OF_CONTENTS_MARKERS = ["numbered", "bullets"] as const;

type TableOfContentsMarker = (typeof TABLE_OF_CONTENTS_MARKERS)[number];

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
  "Add H2 headings to this page and they'll be listed here.";

/** The mark on the top list naming its markers, which the rules below read. */
const MARKER_ATTRIBUTE = "data-nx-toc";

/** The mark on the top list asking for the section being read to show. */
const HIGHLIGHT_ATTRIBUTE = "data-nx-toc-highlight";

/**
 * The mark on the folding title's `<summary>`: the one thing a visitor taps
 * to fold the contents, so a target at least 44px tall, as each link is.
 */
const TOGGLE_ATTRIBUTE = "data-nx-toc-toggle";

/**
 * The markers and the highlight, which no stored style can say: a counter
 * per list, joined down the nesting (`2.1`), or a bullet, each drawn before
 * the entry's link with an empty alternative text (the second `content`;
 * a browser without that syntax keeps the first, and its screen reader may
 * read the number); and, where the browser knows scroll-linked targets, the
 * link to the section being read set in a heavier weight. A browser that
 * does not know `:target-current` drops that one rule and no other.
 * Attribute selectors at a class's weight, so an author's own styles on the
 * block's parts still win. Hoisted and deduped by React, one per page.
 */
const TABLE_OF_CONTENTS_CSS = [
  `:is([${MARKER_ATTRIBUTE}],[${MARKER_ATTRIBUTE}] ol){counter-reset:nx-toc}`,
  `[${MARKER_ATTRIBUTE}] li{counter-increment:nx-toc}`,
  `[${MARKER_ATTRIBUTE}] li::before{margin-inline-end:0.5em;font-variant-numeric:tabular-nums}`,
  `[${MARKER_ATTRIBUTE}="numbered"] li::before{content:counters(nx-toc,".");content:counters(nx-toc,".")/""}`,
  `[${MARKER_ATTRIBUTE}="bullets"] li::before{content:"\\2022";content:"\\2022"/""}`,
  `[${MARKER_ATTRIBUTE}="bullets"] li li::before{content:"\\25E6";content:"\\25E6"/""}`,
  `[${HIGHLIGHT_ATTRIBUTE}]{scroll-target-group:auto}`,
  `[${HIGHLIGHT_ATTRIBUTE}] a:target-current{font-weight:600}`,
  // A floor, under `:where`, so an author's own minimum height on the title
  // replaces it; a smaller `height` cannot take the target below 44px. Only
  // the folding title takes it: a title that cannot fold is a label, not a
  // target.
  `:where([${TOGGLE_ATTRIBUTE}]){min-height:44px}`,
].join("");

/** The key the contents' rules are hoisted under. */
const TABLE_OF_CONTENTS_STYLE_KEY = "nx-table-of-contents";

export interface TableOfContentsProps {
  /** The label above the list, and the name of the navigation landmark. */
  title?: string;
  /** Which heading levels are listed. */
  depth?: TableOfContentsDepth;
  /**
   * Numbers or bullets. Unset reads as bullets: a block from before this
   * setting drew no numbers, and a new block stores `numbered`.
   */
  marker?: TableOfContentsMarker;
  /** Whether the list folds away under its title, starting open. */
  collapsible?: boolean;
  /** Whether the entry of the section being read is highlighted. */
  highlight?: boolean;
}

/** One listed heading and the headings listed inside it. */
interface OutlineItem {
  readonly heading: OutlineHeading;
  readonly children: OutlineItem[];
}

/**
 * The listed headings as a tree. Each heading goes inside the nearest heading
 * before it of a higher level, so a level skipped on the page (an h4 after an
 * h2) nests one level, not two.
 */
function outlineTree(headings: readonly OutlineHeading[]): OutlineItem[] {
  const top: OutlineItem[] = [];
  const open: { level: number; children: OutlineItem[] }[] = [
    { level: 0, children: top },
  ];
  for (const heading of headings) {
    while (open.length > 1 && open[open.length - 1].level >= heading.level) {
      open.pop();
    }
    const item: OutlineItem = { heading, children: [] };
    open[open.length - 1].children.push(item);
    open.push({ level: heading.level, children: item.children });
  }
  return top;
}

function OutlineList({
  items,
  partClass,
  top,
}: {
  items: readonly OutlineItem[];
  partClass: (name: string) => string;
  /** The marks the top list carries; none on a nested list. */
  top?: Readonly<Record<string, string>>;
}): ReactElement {
  // `role="list"` restates what `<ol>` already is: Safari's screen reader
  // drops list semantics from a list whose markers a stylesheet removed, which
  // this block's own defaults do.
  return (
    <ol
      role="list"
      className={partClass(top === undefined ? "sublist" : "list")}
      {...top}
    >
      {items.map(item => (
        <li key={item.heading.anchor} className={partClass("item")}>
          <a href={`#${item.heading.anchor}`} className={partClass("link")}>
            {item.heading.text}
          </a>
          {item.children.length > 0 ? (
            <OutlineList items={item.children} partClass={partClass} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The headings this block lists from the page's outline, to its depth. */
function listedHeadings(
  ctx: PageContext,
  depth: TableOfContentsDepth
): OutlineHeading[] {
  const deepest = DEEPEST[depth];
  // Level 1 is the page's own title, never an entry in its contents.
  return (ctx.outline?.headings ?? []).filter(
    heading => heading.listed && heading.level >= 2 && heading.level <= deepest
  );
}

function renderTableOfContents({
  props,
  ctx,
  className,
  partClass,
  markProp,
}: BlockRenderArgs<TableOfContentsProps>): ReactElement | null {
  const listed = listedHeadings(
    ctx,
    oneOf(props.depth, TABLE_OF_CONTENTS_DEPTHS, "h2-h3")
  );
  const authorLooking = ctx.diagnostics === true;
  if (listed.length === 0 && !authorLooking) return null;

  const ownTitle = text(props.title).trim();
  const title = ownTitle === "" ? DEFAULT_TITLE : ownTitle;
  const titleClass = partClass("title");
  const marks: Record<string, string> = {
    [MARKER_ATTRIBUTE]: oneOf(
      props.marker,
      TABLE_OF_CONTENTS_MARKERS,
      "bullets"
    ),
    ...(flag(props.highlight, true) ? { [HIGHLIGHT_ATTRIBUTE]: "" } : {}),
  };
  const body: ReactNode =
    listed.length > 0 ? (
      <>
        <style href={TABLE_OF_CONTENTS_STYLE_KEY} precedence="default">
          {TABLE_OF_CONTENTS_CSS}
        </style>
        <OutlineList
          items={outlineTree(listed)}
          partClass={partClass}
          top={marks}
        />
      </>
    ) : (
      <p className={partClass("note")}>{NOTHING_TO_LIST}</p>
    );

  if (flag(props.collapsible, true)) {
    return (
      <nav className={className} aria-label={title}>
        <details open>
          {/*
           * The browser's own marker and keyboard: it folds with no script.
           * Beside the title, the empty icon an Accordion's sections draw,
           * which Style › Icon paints and places; with no icon chosen it is
           * nothing, and the browser's marker shows.
           */}
          <summary className={titleClass} {...{ [TOGGLE_ATTRIBUTE]: "" }}>
            <span className={DISCLOSURE_ICON_CLASS} aria-hidden="true" />
            <span className={DISCLOSURE_TITLE_CLASS} {...markProp?.("title")}>
              {title}
            </span>
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
 * The parts' defaults: lists without the browser's markers or gutter (the
 * block draws its own numbers or bullets), since the nesting is what shows
 * the structure; a nested list set in by one `em`; a title in the weight of a
 * label; links underlined in the text's colour, each a 44px target, with
 * hover and keyboard focus states; the note an author sees on an empty block,
 * slanted and quieter.
 * Everything else inherits from the block, so a template styles the contents
 * by styling the block.
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
      // No space between entries: each link is a target 44px tall.
      base: { base: { margin: NO_MARGIN } },
    },
  },
  // Links that read as links on a site that styles none: a thin underline in
  // the text's own colour, thicker under the pointer, and a ring in that
  // colour for keyboard focus, which a reset stylesheet may have taken away.
  // Each is 44px tall, a target a finger can hit, its words centred in it.
  link: {
    baseStyles: {
      base: {
        base: {
          textDecoration: "underline 1px",
          display: "inline-flex",
          alignItems: "center",
          minHeight: "2.75rem",
        },
      },
      hover: { base: { textDecoration: "underline 2px" } },
      focus: {
        base: {
          textDecoration: "underline 2px",
          borderRadius: "2px",
          boxShadow: "0 0 0 2px currentColor",
        },
      },
    },
  },
  // Set apart from the page's own words, so an author never reads it as
  // content: slanted, and a step quieter than the text around it.
  note: {
    baseStyles: {
      base: {
        base: {
          fontStyle: "italic",
          opacity: 0.75,
          margin: { ...NO_MARGIN, blockStart: "0.75em" },
        },
      },
    },
  },
} as const;

/**
 * Version 1 to 2: the list is built from the page's headings, so the passage
 * it read (`content`) goes, with any binding on it and any component setting
 * exposing it (`VERSION_1_DROPS`), and no fallback to it. Nothing else
 * changes: `marker` stays unset, which reads as bullets, as version 1 drew
 * no numbers.
 */
function fromVersion1(props: Record<string, unknown>): Record<string, unknown> {
  return props;
}

/** The props version 1 to 2 drops: the bound passage. */
const VERSION_1_DROPS = { 1: ["content"] } as const;

/** What a new block stores: the defaults the settings show. */
const NEW_BLOCK_PROPS = {
  title: DEFAULT_TITLE,
  depth: "h2-h3",
  marker: "numbered",
  collapsible: true,
  highlight: true,
} as const satisfies TableOfContentsProps;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const tableOfContents: BlockDefinition<
  TableOfContentsProps,
  PageContext
> = defineBlock({
  name: TABLE_OF_CONTENTS_BLOCK,
  version: 2,
  migrate: { 1: fromVersion1 },
  drops: VERSION_1_DROPS,
  // What an author reads, in the Add panel and the block card: one plain line.
  description: "Links to the headings on the page.",
  editor: {
    label: "Table of contents",
    icon: "list",
    category: CONTENT,
    keywords: ["toc", "contents", "outline", "anchors", "on this page"],
  },
  parts: TABLE_OF_CONTENTS_PARTS,
  props: {
    title: { label: "Title", role: "content", type: "text", inline: true },
    depth: {
      label: "Headings",
      optionLabels: {
        h2: "H2 only",
        "h2-h3": "H2 and H3",
        "h2-h4": "H2 to H4",
      },
      type: "select",
      options: [...TABLE_OF_CONTENTS_DEPTHS],
    },
    marker: {
      label: "List as",
      optionLabels: { numbered: "Numbers", bullets: "Bullets" },
      type: "select",
      options: [...TABLE_OF_CONTENTS_MARKERS],
    },
    collapsible: { label: "Can be folded", type: "checkbox" },
    highlight: { label: "Highlight the section being read", type: "checkbox" },
  },
  defaultProps: NEW_BLOCK_PROPS,
  // No headings of its own: placed on a page, it lists the page's.
  example: { props: NEW_BLOCK_PROPS },
  supports: {
    typography: true,
    color: true,
    spacing: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
    // The icon its folding title shows, and where, as an Accordion's.
    disclosure: true,
  },
  // A navigation landmark of links, folded in a `<details>` by default: flow
  // content that is interactive while it draws a link or the disclosure.
  contentModel: () => ({ is: ["flow", "interactive"] }),
  render: renderTableOfContents,
});
