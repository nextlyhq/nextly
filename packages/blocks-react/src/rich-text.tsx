import {
  codeTokenClass,
  cssColor,
  hasFormat,
  isRichTextNode,
  isRichTextValue,
  TEXT_FORMAT,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";
import type { CSSProperties, ReactNode } from "react";

import { fetchableUrl, oneOf, relFor, text, url } from "./blocks/props";
import type { BlockHostPolicy } from "./context";

/**
 * Drawing stored rich text as React.
 *
 * The CMS derives HTML from the same stored shape for its API consumers; this
 * draws a React tree for a page. Both read the type and the format bits from
 * `blocks-engine`, which is the only thing they can share — this package's
 * layering test forbids it from importing the CMS, the admin or the plugin SDK,
 * so there is no module a common READER could live in.
 *
 * That is a real cost and it is worth naming: two producers must agree about
 * what a node means. What contains it is that neither invents the meaning —
 * `TEXT_FORMAT` and `RichTextNode` are imported, never re-declared, so the
 * disagreement can only be about output and never about the data.
 *
 * ## No `dangerouslySetInnerHTML`
 *
 * Nodes become elements. Rich text arrives from storage, and storage holds
 * whatever an editor once accepted — passing it through an HTML string would
 * make every stored document a place markup could execute from, which is a
 * surface this format does not otherwise have.
 *
 * A stored URL is the one field where that is not enough. It reaches an `href`
 * attribute, where a `javascript:` or `data:text/html` value executes without
 * any markup being parsed at all, so it goes through the same `url()` boundary
 * every other stored URL in this package crosses.
 *
 * ## Unknown nodes render their children
 *
 * A site can register node types this renderer has never heard of. Dropping an
 * unknown node would silently delete an author's content; refusing to render
 * would take the page down for one unrecognised paragraph. Descending into its
 * children keeps the words and loses only the wrapper, which is the forgiving
 * behaviour the format asks for everywhere else.
 *
 * That fallback carries content only for nodes that HAVE children. The editor
 * also registers leaf nodes that hold their content in their own fields —
 * `image`, `video`, `gallery` and the button nodes — and those render as nothing
 * here. Each needs a URL and host policy of the kind the media blocks already
 * carry, so they are drawn by that work rather than guessed at here.
 *
 * @module rich-text
 */

/**
 * The element each format bit wraps text in, outermost LAST.
 *
 * A table rather than a run of `if`s: every entry says the same thing, and the
 * order is data — `code` sits at the end so it wraps the rest, matching how the
 * CMS's serializer nests them. Read as a list, a reordering is visible; read as
 * eight branches, it is not.
 */
const FORMAT_ELEMENTS: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  wrap: (inner: ReactNode) => ReactNode;
}[] = [
  { flag: TEXT_FORMAT.SUBSCRIPT, wrap: inner => <sub>{inner}</sub> },
  { flag: TEXT_FORMAT.SUPERSCRIPT, wrap: inner => <sup>{inner}</sup> },
  { flag: TEXT_FORMAT.STRIKETHROUGH, wrap: inner => <s>{inner}</s> },
  { flag: TEXT_FORMAT.UNDERLINE, wrap: inner => <u>{inner}</u> },
  { flag: TEXT_FORMAT.ITALIC, wrap: inner => <em>{inner}</em> },
  { flag: TEXT_FORMAT.BOLD, wrap: inner => <strong>{inner}</strong> },
  { flag: TEXT_FORMAT.HIGHLIGHT, wrap: inner => <mark>{inner}</mark> },
  { flag: TEXT_FORMAT.CODE, wrap: inner => <code>{inner}</code> },
];

/**
 * How the three case formats are drawn.
 *
 * A transform rather than an element, because that is what they are: the stored
 * text is unchanged and only its presentation differs, so wrapping it in a tag
 * would assert a meaning the author did not choose. The values are constants
 * from this table and never stored text, so no author input reaches a style.
 */
const CASE_TRANSFORM: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  value: "lowercase" | "uppercase" | "capitalize";
}[] = [
  { flag: TEXT_FORMAT.LOWERCASE, value: "lowercase" },
  { flag: TEXT_FORMAT.UPPERCASE, value: "uppercase" },
  { flag: TEXT_FORMAT.CAPITALIZE, value: "capitalize" },
];

/** Wraps text in the elements its format bits ask for, innermost first. */
function formatted(text: string, format: number | undefined): ReactNode {
  let out: ReactNode = text;
  for (const { flag, wrap } of FORMAT_ELEMENTS) {
    if (hasFormat(format, flag)) out = wrap(out);
  }

  // Outermost, and only one can apply: `text-transform` is a single CSS
  // property, so a value carrying two case bits would otherwise render whichever
  // wrapper happened to be inner. Taking the first keeps that deterministic.
  const transform = CASE_TRANSFORM.find(entry => hasFormat(format, entry.flag));
  if (transform === undefined) return out;
  const style: CSSProperties = { textTransform: transform.value };
  return <span style={style}>{out}</span>;
}

function children(
  nodes: readonly RichTextNode[] | undefined,
  policy: BlockHostPolicy | undefined
): ReactNode {
  // Array-checked, not undefined-checked. `children` is stored JSON like
  // everything else here, so it can arrive as `{}` or `"oops"`, and calling
  // `.map` on either throws while rendering a published page. The type cannot
  // prevent it; only reading the value can.
  if (!Array.isArray(nodes)) return null;
  return nodes.map((node, i) => (
    // Index keys, and the reason is that nothing better exists: a serialized
    // node carries no identity, and a rich-text tree is replaced wholesale on
    // every edit rather than reordered in place, so React never has to match a
    // node across renders.
    <RichTextNodeView key={i} node={node} policy={policy} />
  ));
}

/**
 * Node types that are just an element around their children.
 *
 * A table rather than cases, because every one of them says the same thing and
 * a switch makes ten identical branches look like ten decisions. What is left
 * in {@link RichTextNodeView} is only the nodes that genuinely differ.
 */
const SIMPLE_ELEMENTS: Readonly<
  Record<
    string,
    "p" | "blockquote" | "li" | "details" | "summary" | "div" | "tbody" | "tr"
  >
> = {
  paragraph: "p",
  quote: "blockquote",
  listitem: "li",
  "collapsible-content": "div",
  tablerow: "tr",
};

/**
 * The types this renderer draws as something a `<p>` may not contain.
 *
 * Lexical's `DecoratorNode` is INLINE unless a node overrides `isInline()`, and
 * at lexical 0.47.0 not one of this editor's five decorator nodes does — image,
 * gallery, video, button-link and button-group are all inline, so inserting one
 * with a caret in a paragraph makes it a CHILD of that paragraph. Drawing a
 * `<figure>`, a `<ul>` or a flex row inside `<p>` then publishes markup a
 * browser will not parse as written: `<p>` is closed at any of them, so the DOM
 * that results is not the tree React rendered, and every page carrying one
 * hydrates mismatched.
 *
 * Naming the BLOCK types rather than the phrasing ones is deliberate. A type no
 * list here has heard of is drawn by the unknown-node fallback, which emits no
 * element of its own, so phrasing is the correct answer for it.
 *
 * A LIST rather than a set literal, because the admin's conformance test reads
 * it with the same `constMembers` it already uses for the button vocabularies,
 * and holds every dispatch key to being classified here or declared phrasing
 * there. A new decorator added to {@link NODE_VIEWS} and forgotten here fails
 * that check instead of silently publishing a `<figure>` inside a `<p>`.
 */
const BLOCK_LEVEL_NODES = [
  "paragraph",
  "heading",
  "quote",
  "list",
  "listitem",
  "code",
  "horizontalrule",
  "table",
  "tablerow",
  "tablecell",
  "collapsible-container",
  "collapsible-title",
  "collapsible-content",
  "image",
  "gallery",
  "button-link",
  "button-group",
] as const;

/**
 * Types this renderer draws as their OWN interactive element.
 *
 * An `<a>` may not contain another `<a>`, and the parser does not merely object:
 * it closes the outer anchor at the inner one, lifts the content out, and
 * inserts a DUPLICATE empty anchor inside — measured, so a link applied across a
 * button produced markup with two anchors React never rendered.
 */
const INTERACTIVE_NODES: ReadonlySet<string> = new Set([
  "link",
  "autolink",
  "button-link",
  "button-group",
]);

/** Whether anything drawn inside a container is itself interactive. */
function holdsInteractive(nodes: readonly RichTextNode[] | undefined): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some(child => {
    if (!isRichTextNode(child)) return false;
    if (INTERACTIVE_NODES.has(child.type)) return true;
    return holdsInteractive(child.children);
  });
}

const BLOCK_LEVEL: ReadonlySet<string> = new Set(BLOCK_LEVEL_NODES);

/**
 * Whether anything drawn inside a container lands as block content.
 *
 * DESCENDS through nodes that are not themselves block, rather than reading the
 * immediate children alone. Applying a link across a selection that contains an
 * image serialises as `link -> image`, and a shallow check sees only the
 * phrasing `link` while {@link LinkView} goes on to draw `<a><figure>` — inside
 * the `<p>` the shallow answer preserved. The unknown-node fallback needs the
 * same treatment for the opposite reason: it emits no element at all, so its
 * children land in whatever encloses IT.
 *
 * A block node ends the walk instead of being descended into, because it has
 * already answered the question. The recursion is therefore bounded by the
 * document's own depth, which the renderer walks anyway.
 */
function holdsBlockContent(
  nodes: readonly RichTextNode[] | undefined
): boolean {
  // Array-checked for the reason {@link children} gives: this is stored JSON.
  if (!Array.isArray(nodes)) return false;
  return nodes.some(child => {
    if (!isRichTextNode(child)) return false;
    if (BLOCK_LEVEL.has(child.type)) return true;
    return holdsBlockContent(child.children);
  });
}

/** Heading levels Lexical serializes; anything else is a document from a version this does not know. */
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * A container that may hold only phrasing content, with the rest moved AFTER it.
 *
 * `h1`-`h6` take phrasing content, and `summary` takes phrasing content or a
 * single heading — so a decorator inserted with the caret in a heading or in a
 * disclosure label puts a `<figure>` or a button row somewhere neither may go.
 *
 * Unlike a paragraph, the element cannot simply be swapped for a `div`. The tag
 * IS the meaning here: an `h2` is what puts the text in the document outline and
 * what a search engine reads, and `summary` is what makes a `details` operable
 * at all — it has to be the first child, so replacing it removes the disclosure.
 *
 * So the container keeps its tag and its phrasing children, and anything block
 * follows it as a SIBLING. That lands correctly in both cases: after a heading
 * the media sits in the flow where the author put it, and after a `summary` it
 * becomes part of the disclosure's body, which is the only place inside a
 * `details` it can legally go.
 *
 * A child is moved WHOLE when it merely contains block content — a link around
 * an image leaves the heading entirely rather than being taken apart. Splitting
 * one node across the boundary would need the renderer to rebuild the author's
 * markup, and a heading keeping its words is the property worth protecting.
 */
function PhrasingOnly({
  tag: Tag,
  node,
  policy,
}: {
  tag: "h1" | "summary";
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  const kids = Array.isArray(node.children) ? node.children : [];
  if (!holdsBlockContent(kids)) return <Tag>{children(kids, policy)}</Tag>;
  // Asked per child through the same walk the container was judged by, so
  // "what counts as block" has one answer rather than two that can drift.
  const keeps = kids.filter(child => !holdsBlockContent([child]));
  const moves = kids.filter(child => holdsBlockContent([child]));
  return (
    <>
      <Tag>{children(keeps, policy)}</Tag>
      {children(moves, policy)}
    </>
  );
}

function HeadingView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  // `h2` rather than `h1` when the tag is unrecognised: guessing `h1` invents a
  // second top-level heading and breaks the page outline, which is worse than
  // rendering one level too deep.
  const tag =
    typeof node.tag === "string" && HEADING_TAGS.has(node.tag)
      ? node.tag
      : "h2";
  const Heading = tag as "h1";
  return <PhrasingOnly tag={Heading} node={node} policy={policy} />;
}

function LinkView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  // Sanitized, not merely read: the destination is stored text that lands in an
  // `href`. `url()` is the same boundary the URL props cross, so a scheme
  // refused in a button cannot be reached through a link beside it.
  const href = url(node.url);
  // A link with no usable destination renders as text. An anchor to nowhere is
  // announced as a link by a screen reader and goes nowhere when followed, and
  // that is also the right answer for a destination this refuses: the author's
  // words survive, the navigation does not.
  // A link around something ALREADY interactive renders as its children alone.
  // The buttons inside it navigate on their own, so nothing is lost but the
  // wrapper the parser was going to take apart anyway — and taking it apart is
  // not a tidy failure: it leaves a second, empty anchor in the middle of the
  // row, which is focusable and announced with no name.
  if (href === undefined || holdsInteractive(node.children))
    return <>{children(node.children, policy)}</>;

  // Only `_blank` is honoured. It is the one target the editor writes, and it
  // is the one that needs the `rel` below; passing an arbitrary stored string
  // through would let a document name a frame elsewhere on the page.
  const target = node.target === "_blank" ? "_blank" : undefined;
  return (
    <a href={href} target={target} rel={relFor(target, node.rel)}>
      {children(node.children, policy)}
    </a>
  );
}

function TableCellView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  // Lexical marks a header cell with `headerState`, a bitfield where any set bit
  // means the cell heads its row or its column.
  const header = typeof node.headerState === "number" && node.headerState !== 0;
  const Cell = header ? "th" : "td";
  return <Cell>{children(node.children, policy)}</Cell>;
}

/**
 * Dimensions, when the editor recorded usable ones.
 *
 * BOTH or NEITHER. A lone `width` on an `<img>` makes a browser compute the
 * other from the intrinsic size, which is a different number from the one the
 * author saw and moves the layout as the image loads — the reserved space this
 * exists to provide, reserved wrongly.
 */
function boxOf(
  node: Readonly<Record<string, unknown>>
): { width: number; height: number } | undefined {
  const width = usableEdge(node.width);
  const height = usableEdge(node.height);
  return width === undefined || height === undefined
    ? undefined
    : { width, height };
}

/**
 * One edge, judged BEFORE anything clamps it.
 *
 * Clamping first and rejecting zero after cannot work: a stored `0` becomes the
 * minimum on the way in, so the rejection never fires and the page draws a
 * one-pixel image. That makes the picture DISAPPEAR, where dropping the
 * dimension entirely would have let its intrinsic size render normally — the
 * failure is worse than the one the bound was added to prevent.
 */
function usableEdge(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > MAX_IMAGE_EDGE) return undefined;
  // Rounded FIRST, then judged again. A positive edge below a half is inside
  // the range above and rounds to zero, so returning the rounded value straight
  // away reinstates the collapsed image the range check exists to refuse — one
  // step later, where the earlier check can no longer see it.
  const edge = Math.round(value);
  return edge <= 0 ? undefined : edge;
}

/** The largest edge an `<img>` is given a reserved box for. */
const MAX_IMAGE_EDGE = 20000;

/**
 * The `<img>` every image in this file goes through.
 *
 * ONE path rather than one per caller. A gallery entry carries the same fields
 * a standalone image does — a title the author wrote, the intrinsic width and
 * height — and a second, reduced projection beside this one drops them: the
 * gallery loses its titles and reserves no space, so its rows shift as the
 * images load while the standalone path above them does not.
 */
function ImageElement({
  src,
  node,
}: {
  src: string;
  node: Readonly<Record<string, unknown>>;
}): ReactNode {
  const title = text(node.title);
  const box = boxOf(node);
  return (
    <img
      src={src}
      alt={text(node.altText ?? node.alt)}
      {...(title === "" ? {} : { title })}
      {...(box ?? {})}
      loading="lazy"
      decoding="async"
      // CONTAINED, and inline for the reason everything else here is: this
      // package ships no stylesheet, so an upload wider than the column renders
      // at its intrinsic width and breaks out of the prose — a normal case for
      // anything from a modern camera or a high-DPI screen. The editor draws
      // these with `w-full h-auto`; a published page that did not would show the
      // author something they never saw.
      //
      // `height: auto` is what keeps the pair above honest rather than
      // contradicting it: the width and height attributes still give the
      // browser the aspect ratio to reserve space with, and this lets the
      // rendered height follow the constrained width instead of holding the
      // intrinsic one and squashing the picture.
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}

/** A caption, when the author wrote one. */
function CaptionView({ value }: { value: unknown }): ReactNode {
  const caption = text(value);
  if (caption === "") return null;
  return (
    <figcaption className="nextly-rich-text-caption">{caption}</figcaption>
  );
}

/**
 * An image an author placed inside their prose.
 *
 * Refused sources render NOTHING rather than a broken element. An `<img>` whose
 * source this page will not load is an alt-text box on the published page and a
 * request the operator said not to make; the prose around it is unaffected
 * either way, which is what makes dropping it the better answer.
 *
 * `alt` is always written, empty when the author gave none. Absent, a screen
 * reader announces the FILENAME, which is worse than silence — and an image
 * inside prose that carries no description is decorative far more often than it
 * is unlabelled.
 *
 * A plain `<img>` rather than `next/image`, and that is the package boundary
 * rather than an oversight: this entry's layering test forbids importing
 * `next/*`, so the root renderer works in any React host.
 *
 * There is no optimised route through this renderer today, and saying otherwise
 * sends a Next.js reader looking for a seam that does not exist: `next.ts` does
 * not import `RichText` and does not replace this element. Optimising it means
 * giving that subpath its own rich-text entry, which is a change to what this
 * package exports rather than a detail of this function.
 */
function ImageView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  const src = fetchableUrl(node.src, policy?.remotePatterns);
  if (src === undefined) return null;
  return (
    <figure className="nextly-rich-text-image">
      <ImageElement src={src} node={node} />
      <CaptionView value={node.caption} />
    </figure>
  );
}

/** The column counts the editor offers; anything else is a document it did not write. */
const GALLERY_COLUMNS = ["2", "3", "4"] as const;

/** The custom property {@link GALLERY_NARROW_CSS} lowers on a narrow screen. */
const GALLERY_COLUMN_VAR = "--nx-rich-text-gallery-columns";

/** The dedupe key for the one gallery rule set a page needs. */
const GALLERY_STYLE_KEY = "nextly-rich-text-gallery";

/**
 * Two columns below the editor's `sm`, which is what the editor SHOWS.
 *
 * `GalleryNode` previews three columns as `grid-cols-2 sm:grid-cols-3` and four
 * as `grid-cols-2 sm:grid-cols-4`, so below that breakpoint an author is shown
 * two columns whatever they picked. Published without this, a four-column
 * gallery squeezes four images across a phone — a layout the author was never
 * offered and cannot preview.
 *
 * `not all and (min-width: 40rem)` is the EXACT complement of Tailwind's `sm:`,
 * whose `--breakpoint-sm` is `40rem` and is overridden nowhere in this repo. A
 * `max-width` written beside it leaves a gap or an overlap at the boundary
 * depending on how the value is rounded, and the boundary is the one width
 * where being wrong is visible.
 *
 * Written as a CHILD rather than through `dangerouslySetInnerHTML`, which is
 * safe only because this text contains no character React escapes. A test
 * asserts the rendered bytes to keep that true.
 */
const GALLERY_NARROW_CSS = `@media not all and (min-width: 40rem){.nextly-rich-text-gallery-items{${GALLERY_COLUMN_VAR}:2}}`;

/**
 * A gallery of images, as a list.
 *
 * A LIST rather than a row of figures, because that is what it is: a screen
 * reader announces the count before the first item, which is the one fact a
 * non-visual reader most needs about a gallery and the one a bare sequence of
 * images cannot convey.
 *
 * Each source crosses the same two filters separately, so one image the site
 * will not fetch removes itself rather than the gallery around it. A gallery
 * left with no usable image renders nothing, for the reason a single refused
 * image does.
 */
function GalleryView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  if (!Array.isArray(node.images)) return null;
  const images = node.images
    .map(entry => {
      if (entry === null || typeof entry !== "object") return undefined;
      const item: Readonly<Record<string, unknown>> = entry;
      const src = fetchableUrl(item.src, policy?.remotePatterns);
      // The WHOLE entry travels on, not a `{ src, alt }` reduction of it. The
      // shared element below reads the title and the dimensions off it, and a
      // projection that kept two fields is what dropped them here before.
      return src === undefined ? undefined : { src, item };
    })
    .filter(
      (
        entry
      ): entry is { src: string; item: Readonly<Record<string, unknown>> } =>
        entry !== undefined
    );
  if (images.length === 0) return null;

  // Read as a STRING because a stored `3` and a stored `"3"` are the same
  // gallery to an author, and the value reaches an attribute either way.
  const columns = oneOf(String(node.columns), GALLERY_COLUMNS, "3");
  // The grid is written INLINE rather than left to the attribute alone. This
  // package ships no stylesheet — a host styles the emitted classes, as the
  // blog template does for code tokens — so a `data-columns` nobody has written
  // a rule for makes an author's choice of two, three or four do nothing at
  // all, and the list draws as one bulleted column. The count is structural
  // rather than theming: it is what the author selected, not how the site wants
  // galleries to look, so the renderer owes it. The attribute stays beside it so
  // a host can still target the choice, and `textTransform` above sets the same
  // precedent for a property this file must guarantee.
  const layout: CSSProperties = {
    display: "grid",
    // The count is read through a CUSTOM PROPERTY whose fallback is the
    // author's choice, so the narrow-screen rule can lower it without
    // `!important` and without the inline value having to know that rule
    // exists. If the stylesheet never arrives, the fallback is what applies and
    // the gallery draws exactly the columns the author picked.
    gridTemplateColumns: `repeat(var(${GALLERY_COLUMN_VAR}, ${columns}), minmax(0, 1fr))`,
    // The list's own presentation, reset here for the same reason the columns
    // are set here: a `<ul>` in a grid still carries markers, padding and
    // margins from the browser, so a host with no rule for this class publishes
    // the gallery as a bulleted, indented list. The list SEMANTICS stay — a
    // screen reader announces the count, which is the one fact about a gallery
    // a non-visual reader most needs.
    // The LONGHAND. `list-style` is a shorthand, and a shorthand is the one
    // form a test cannot observe here — jsdom's CSS parser drops it from the
    // serialised style, so asserting it would be asserting something unreadable
    // whether or not it was applied. The marker is the only part being removed
    // anyway.
    listStyleType: "none",
    padding: 0,
    margin: 0,
    gap: "0.5rem",
  };
  return (
    <figure className="nextly-rich-text-gallery">
      {/*
       * HOISTED and DEDUPED by React: `href` plus `precedence` lifts this out
       * of the figure and collapses every gallery on the page to one copy —
       * measured, under `renderToStaticMarkup` as well as `renderToString`.
       *
       * A media query is the only reason a rule set exists here at all.
       * Everything else this file guarantees fits in an inline style, but a
       * breakpoint cannot, and `auto-fit` track sizing cannot stand in for one:
       * a jump from two columns to four is unreachable at any basis, because
       * the basis that fits four at the breakpoint also fits three below it.
       */}
      <style href={GALLERY_STYLE_KEY} precedence="default">
        {GALLERY_NARROW_CSS}
      </style>
      <ul
        className="nextly-rich-text-gallery-items"
        data-columns={columns}
        style={layout}
      >
        {images.map((image, i) => (
          <li key={i}>
            <ImageElement src={image.src} node={image.item} />
          </li>
        ))}
      </ul>
      <CaptionView value={node.caption} />
    </figure>
  );
}

/**
 * The button vocabularies, and the DEFAULT each falls back to.
 *
 * Every value here is the editor's, not a set invented to look reasonable. A
 * button serialises `variant: "filled"` by default and offers only `"outline"`
 * beside it, so a renderer allowlist of `primary | secondary | outline | ghost`
 * rewrites every default button to `primary` — the author picks an appearance
 * and the page draws a different one, with the value having passed a check that
 * looked like validation.
 *
 * The fallbacks are the editor's defaults for the same reason: a node stored
 * before a field existed carries nothing there, and answering `left` where the
 * editor answers `center` moves a button an author never touched.
 *
 * `richTextValueVocabulariesAgree` in the admin's conformance test is what
 * holds these to the editor's own types. They cannot be imported — this package
 * may not reach the admin — so they are restated and CHECKED rather than
 * restated and hoped for.
 */
/**
 * What a filled button falls back to when the author chose no colours.
 *
 * The CMS's HTML serializer already answers this for the same stored node, and
 * these are its answers. See {@link buttonStyle}.
 */
const FILLED_BACKGROUND = "#000";
const FILLED_FOREGROUND = "#fff";

const BUTTON_VARIANTS = ["filled", "outline"] as const;
const BUTTON_SIZES = ["sm", "md", "lg"] as const;
const BUTTON_ALIGNMENTS = ["left", "center", "right"] as const;
const DEFAULT_VARIANT = "filled";
const DEFAULT_SIZE = "md";
const DEFAULT_ALIGNMENT = "center";

/** Where a row's contents sit, per alignment the editor records. */
const FLEX_ALIGN: Readonly<Record<string, string>> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** Padding and text size per size the editor offers. */
const BUTTON_METRICS: Readonly<
  Record<string, { padding: string; fontSize: string }>
> = {
  sm: { padding: "0.375rem 0.75rem", fontSize: "0.875rem" },
  md: { padding: "0.5rem 1rem", fontSize: "0.875rem" },
  lg: { padding: "0.75rem 1.5rem", fontSize: "1rem" },
};

/**
 * What a button LOOKS like, as far as the author decided it.
 *
 * The dividing line this file uses everywhere: **the renderer owes what the
 * author chose; what nobody chose stays the host's to theme.** Size and
 * alignment are choices the editor always records, so leaving them to a
 * stylesheet means an author picks `lg`, centred, and the page draws a
 * default-sized link on the left — the same failure the gallery column count
 * had. The colours are only written when the author set them; unset, the editor
 * falls back to its own `--nx-*` tokens, which a published site has no reason to
 * define, so emitting those would put a broken `var()` on the page instead of
 * letting the host's own rule apply.
 *
 * Enough shape to be a button and no more. No hover, no transition, no font
 * family: those are nobody's explicit choice, and the class beside them is how a
 * host says what it wants.
 */
function buttonStyle(
  item: Readonly<Record<string, unknown>>,
  variant: string,
  size: string
): CSSProperties {
  const metrics = Object.hasOwn(BUTTON_METRICS, size)
    ? BUTTON_METRICS[size]
    : undefined;
  // SANITIZED, not merely read. These are stored text and they land in a
  // `style` attribute, which React does not escape: a value of
  // `red;position:fixed;inset:0;background-image:url(...)` does not style the
  // button, it closes the declaration and opens its own — a full-page overlay
  // and an outbound request, from a field an author types into.
  //
  // The check is the engine's rather than this file's, because the CMS makes
  // the same decision about the same stored node and the two have to agree.
  const background = cssColor(item.bgColor);
  const foreground = cssColor(item.textColor);
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    textDecoration: "none",
    ...(metrics ?? {}),
    ...(variant === "outline"
      ? {
          border: "1px solid currentColor",
          ...(foreground === undefined ? {} : { color: foreground }),
        }
      : {
          // A filled button with NO colours still has to look filled. Both
          // fields are optional — `ButtonLinkNode`'s constructor defaults them
          // to `undefined` and its HTML-import path leaves them unset — so a
          // legacy, imported or programmatically built button arrives here with
          // neither, and emitting nothing publishes a padded but otherwise
          // plain anchor. This package ships no stylesheet for the class, so
          // there is nothing behind it to fall back on.
          //
          // Black on white rather than a token, because it is what the CMS's
          // own serializer already puts on a published page: `rich-text-html`
          // writes the background as `safeBg || "#000"` and the foreground as
          // `safeText || "#fff"`, and two published renderings of one document
          // have to agree. A `var(--nx-*)` would not — that is an ADMIN token a
          // site has no reason to define, so the page would carry a broken
          // `var()` where the button should be.
          backgroundColor: background ?? FILLED_BACKGROUND,
          color: foreground ?? FILLED_FOREGROUND,
        }),
  };
}

/**
 * One button, as the ANCHOR it is.
 *
 * Never a `<button>`. It navigates, so it has to be announced as a link and
 * behave like one — opening in a new tab, copying its address, being followed
 * by a keyboard. Styling it to look like a button is presentation, not element
 * choice.
 *
 * The destination crosses `url()` for the reason {@link LinkView} gives, and a
 * refused one renders nothing at all rather than the label alone: unlike a link
 * wrapping prose, a button's text IS the button, and leaving it behind as bare
 * words puts an orphaned "Buy now" in the middle of an article.
 */
function ButtonView({
  item,
}: {
  item: Readonly<Record<string, unknown>>;
}): ReactNode {
  const href = url(item.url);
  if (href === undefined) return null;
  const label = text(item.text);
  if (label === "") return null;
  const target = item.target === "_blank" ? "_blank" : undefined;
  const variant = oneOf(item.variant, BUTTON_VARIANTS, DEFAULT_VARIANT);
  const size = oneOf(item.size, BUTTON_SIZES, DEFAULT_SIZE);
  return (
    <a
      className="nextly-rich-text-button"
      href={href}
      target={target}
      rel={relFor(target, item.rel)}
      data-variant={variant}
      data-size={size}
      style={buttonStyle(item, variant, size)}
    >
      {label}
    </a>
  );
}

/**
 * Whether an entry can become a button at all.
 *
 * Asked BEFORE the wrapper is built, because a wrapper around nothing is not
 * nothing: an empty `<p>` keeps its paragraph margins and leaves a blank gap in
 * the prose, which is a visible artefact of a refusal whose stated behaviour is
 * to render nothing. A test asserting only that the LABEL is gone stays green
 * with that gap present.
 */
function isRenderable(item: Readonly<Record<string, unknown>>): boolean {
  return url(item.url) !== undefined && text(item.text) !== "";
}

/** The row a button or a group of them sits in. */
function ButtonRow({
  node,
  items,
}: {
  node: RichTextNode;
  items: readonly Readonly<Record<string, unknown>>[];
}): ReactNode {
  const usable = items.filter(isRenderable);
  if (usable.length === 0) return null;
  const align = oneOf(node.alignment, BUTTON_ALIGNMENTS, DEFAULT_ALIGNMENT);
  return (
    <p
      className="nextly-rich-text-buttons"
      data-align={align}
      // Alignment is a choice the editor always records, so the page owes it
      // for the reason the size above is owed: left to a stylesheet, a button
      // the author centred publishes against the margin.
      style={{
        display: "flex",
        // WRAPPING, because the editor wraps: its preview uses `flex-wrap` and
        // `exportDOM` sets `flexWrap` explicitly. Without it a group wider than
        // its column overflows rather than moving to a second line, so a long
        // pair of labels — or any group on a narrow screen — publishes
        // differently from what the author was shown.
        flexWrap: "wrap",
        gap: "0.75rem",
        justifyContent: FLEX_ALIGN[align] ?? "center",
      }}
    >
      {usable.map((item, i) => (
        <ButtonView key={i} item={item} />
      ))}
    </p>
  );
}

/** A single button the author placed in their prose. */
function ButtonLinkView({ node }: { node: RichTextNode }): ReactNode {
  return <ButtonRow node={node} items={[node]} />;
}

/**
 * Several buttons offered together.
 *
 * One refused button leaves the others: a group is a set of alternatives, and
 * dropping the whole row because one destination was unusable takes away
 * choices that were fine.
 */
function ButtonGroupView({ node }: { node: RichTextNode }): ReactNode {
  if (!Array.isArray(node.buttons)) return null;
  const items = node.buttons.filter(
    (entry): entry is Readonly<Record<string, unknown>> =>
      entry !== null && typeof entry === "object"
  );
  return <ButtonRow node={node} items={items} />;
}

/**
 * The nodes that are more than an element around their children.
 *
 * Keyed rather than branched for the same reason as {@link SIMPLE_ELEMENTS}: a
 * lookup makes "which types does this renderer know" answerable by reading one
 * list, where a chain of `if`s hides it in control flow.
 */
const NODE_VIEWS: Readonly<
  Record<
    string,
    (node: RichTextNode, policy: BlockHostPolicy | undefined) => ReactNode
  >
> = {
  heading: (node, policy) => <HeadingView node={node} policy={policy} />,
  // `open` is serialized by the editor, default included, so a section the
  // author left expanded publishes expanded.
  "collapsible-container": (node, policy) => (
    <details open={node.open === true}>
      {children(node.children, policy)}
    </details>
  ),
  // A `summary` is phrasing-only and cannot be swapped for a `div` — it has to
  // be the first child of its `details` or the disclosure stops working — so it
  // takes the same treatment as a heading rather than the paragraph's.
  "collapsible-title": (node, policy) => (
    <PhrasingOnly tag="summary" node={node} policy={policy} />
  ),
  link: (node, policy) => <LinkView node={node} policy={policy} />,
  autolink: (node, policy) => <LinkView node={node} policy={policy} />,
  list: (node, policy) => {
    if (node.listType !== "number")
      return <ul>{children(node.children, policy)}</ul>;
    // A list imported from `<ol start="5">` keeps its first number. Dropped,
    // the published list silently restarts at 1 and the prose around it —
    // "step 5" — stops matching. Only a positive integer is forwarded;
    // anything else is a value the attribute could not carry.
    const start =
      typeof node.start === "number" &&
      Number.isInteger(node.start) &&
      node.start > 0
        ? node.start
        : undefined;
    return <ol start={start}>{children(node.children, policy)}</ol>;
  },
  linebreak: () => <br />,
  horizontalrule: () => <hr />,
  code: (node, policy) => (
    <pre>
      <code>{children(node.children, policy)}</code>
    </pre>
  ),
  // `tbody` rather than bare rows: a browser inserts one anyway, and a React
  // tree that omits it does not match the DOM that results.
  table: (node, policy) => (
    <table>
      <tbody>{children(node.children, policy)}</tbody>
    </table>
  ),
  tablecell: (node, policy) => <TableCellView node={node} policy={policy} />,
  "code-highlight": node => <CodeTokenView node={node} />,
  // The MEDIA leaves. Each keeps its content in its OWN fields rather than in
  // `children`, which is why the unknown-node fallback below cannot draw them:
  // it descends into children, finds none, and renders nothing at all. An
  // author who placed an image in their prose saw it in the editor and lost it
  // on the page, with nothing anywhere reporting the loss.
  image: (node, policy) => <ImageView node={node} policy={policy} />,
  gallery: (node, policy) => <GalleryView node={node} policy={policy} />,
  "button-link": node => <ButtonLinkView node={node} />,
  "button-group": node => <ButtonGroupView node={node} />,
};

/**
 * One syntax-highlighted token inside a code block.
 *
 * The class comes from the engine so this and the CMS's HTML agree about which
 * class a token type gets; a token whose type the engine rejects renders as
 * bare text rather than in an element that would carry no styling anyway.
 */
function CodeTokenView({ node }: { node: RichTextNode }): ReactNode {
  const text = typeof node.text === "string" ? node.text : "";
  const className = codeTokenClass(node.highlightType);
  if (className === undefined) return <>{text}</>;
  return <span className={className}>{text}</span>;
}

function RichTextNodeView({
  node,
  policy,
}: {
  node: RichTextNode;
  policy: BlockHostPolicy | undefined;
}): ReactNode {
  // A stored document can hold anything JSON can express, including a null in a
  // `children` array. Reading `.text` off that throws, and it would throw during
  // render of a published page. The type says this cannot happen; the storage
  // does not.
  if (!isRichTextNode(node)) return null;

  // TYPE FIRST, then the generic text branch.
  //
  // `text` is not a text node's private field: a code token carries one, and so
  // does a button, whose label it holds. Asked the other way round, any node
  // with a `text` field returns as bare prose having lost the type that decides
  // what it IS — a button published as the stray words "Buy now" in the middle
  // of an article, and nothing anywhere reporting it.
  //
  // Ordering rather than a guard per type. The same collision was met once
  // before and answered with a `node.type === "code-highlight"` line in front of
  // the branch, which fixes the node that was noticed and leaves the next one
  // to be found the same way. A type this file knows is dispatched on its type;
  // only a node no table claims falls through to be read as text.
  //
  // `Object.hasOwn` before either lookup, because `node.type` is a stored string
  // and these tables inherit from `Object.prototype`. A node typed
  // `"constructor"` or `"toString"` would otherwise resolve to an inherited
  // function — used as a JSX element type, or called as a view — and throw,
  // instead of taking the unknown-node fallback that exists for exactly this.
  if (Object.hasOwn(SIMPLE_ELEMENTS, node.type)) {
    const declared = SIMPLE_ELEMENTS[node.type] as "p";
    // Only `p` is narrowed HERE. `li`, `blockquote` and `div` take flow content,
    // so a figure or a grid inside one of them is valid as it stands. The other
    // phrasing-only containers — headings and `summary` — cannot be swapped for
    // a `div` without losing what their tag means, so they are handled by
    // {@link PhrasingOnly} instead of by this table.
    const Element =
      declared === "p" && holdsBlockContent(node.children) ? "div" : declared;
    return <Element>{children(node.children, policy)}</Element>;
  }

  if (Object.hasOwn(NODE_VIEWS, node.type)) {
    const view = NODE_VIEWS[node.type];
    if (view !== undefined) return view(node, policy);
  }

  if (typeof node.text === "string") return formatted(node.text, node.format);

  // Unknown node: keep the words, lose the wrapper. See the module docblock.
  return <>{children(node.children, policy)}</>;
}

export interface RichTextProps {
  /** The stored value. Anything that is not rich text renders nothing. */
  value: unknown;
  /**
   * Site-operator decisions the media inside this value enforces.
   *
   * Passed as a PROP rather than read from a React context, because this entry
   * renders on the server: a context would make every page drawing rich text a
   * client component, which is a cost out of all proportion to reading one
   * optional object. It is the same way a block receives it.
   *
   * ABSENT MEANS UNASKED, not allowed-nothing — the semantics
   * {@link BlockHostPolicy} states for `remotePatterns` itself. A caller that
   * passes nothing gets what it had before media rendered at all, rather than a
   * page whose images silently disappear the day it upgrades. The scheme filter
   * every stored URL crosses is NOT part of this bargain: it applies whether or
   * not a policy was supplied, because a `javascript:` href is not a site
   * operator's decision to make.
   */
  hostPolicy?: BlockHostPolicy;
}

/**
 * Render a stored rich-text value.
 *
 * Takes `unknown` rather than `RichTextValue` because it is called with a block
 * prop, and a prop's stored type is whatever was saved — a string from before a
 * field became rich, a null, an empty object. Narrowing here means one check in
 * one place instead of one at every call site, and it means a prop holding the
 * wrong thing renders nothing rather than throwing on a live page.
 */
export function RichText({ value, hostPolicy }: RichTextProps): ReactNode {
  if (!isRichTextValue(value)) return null;
  return <>{children(value.root.children, hostPolicy)}</>;
}
