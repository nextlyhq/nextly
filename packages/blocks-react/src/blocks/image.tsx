/**
 * `core/image` — a picture.
 *
 * The media id is resolved through the context, not stored as a URL. A stored
 * URL goes stale the moment a file is re-uploaded or the storage adapter
 * changes, and it cannot carry the alt text and intrinsic size the element
 * needs; a host that signs its URLs cannot serve one at all.
 *
 * Alt text is ALWAYS emitted, empty when the image is decorative. Omitting the
 * attribute makes a screen reader read the file name instead, so "no alt" and
 * "deliberately no alt" have to be different states, and the second is `alt=""`.
 *
 * @module blocks/image
 */
import {
  type BlockDefinition,
  blockTypeClassName,
  defineBlock,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { MEDIA } from "./categories";
import { imageLooks } from "./looks";
import {
  fetchableUrl,
  flag,
  canLink,
  isAuthoredText,
  LINK_PROPS,
  linkFor,
  oneOf,
  text,
  url,
  type LinkAttributes,
  type LinkProps,
} from "./props";

/** How the browser should schedule the image. */
export const IMAGE_LOADING = ["lazy", "eager"] as const;

export interface ImageProps extends LinkProps {
  /** The media record's id, resolved through the host. */
  mediaId?: string;
  /** A direct URL, for a host with no media library. */
  src?: string;
  /** Alternative text. Empty means decorative, which is a real answer. */
  alt?: string;
  /** Marks the image as decorative, forcing empty alt text. */
  decorative?: boolean;
  /** Loading strategy. Above-the-fold images should be `eager`. */
  loading?: "lazy" | "eager";
  /** A caption rendered under the image, inside a figure. */
  caption?: string;
}

export async function renderImage({
  props,
  className,
  ctx,
  hostPolicy,
  partClass,
}: BlockRenderArgs<ImageProps>): Promise<ReactElement | null> {
  const mediaId = text(props.mediaId);
  // A resolver that throws must not take the page with it: media lives behind
  // a network call for a signed-URL host, and one unreachable image is not a
  // reason to lose the article around it.
  const record =
    mediaId === "" ? null : await ctx.resolveMedia(mediaId).catch(() => null);

  // A candidate has to clear BOTH filters, and both are asked before the two are
  // chosen between rather than after.
  //
  // Both, because they refuse different things: the scheme filter refuses a
  // value that could execute, the host list refuses one this site will not fetch
  // from. A resolver is trusted code, but the value it returns came out of a
  // media record a person filled in, so it is input in the same sense the typed
  // prop is — checking one position of that pair and not the other lets a value
  // through unfiltered.
  //
  // Before, because selecting first and filtering after means a library image
  // the site will not load beats a perfectly good typed URL and then takes the
  // whole block down with it: the author is left with nothing over a setting
  // they cannot see, while the fallback they wrote sits unused. Filtering first
  // renders the first candidate actually allowed, which is what a fallback is
  // for and what the link-preview path does with the same pair.
  const patterns = hostPolicy?.remotePatterns;
  const fetchable = (value: unknown): string | undefined =>
    fetchableUrl(value, patterns);

  // A record whose url either filter refused is dropped WHOLE, not just for its
  // url. Its alt text and intrinsic size describe the asset that was refused, so
  // keeping them beside the fallback announces one image to a screen reader
  // while reserving the other one's space.
  const usable = fetchable(record?.url) === undefined ? null : record;
  const src = fetchable(usable?.url) ?? fetchable(props.src);
  // Nothing to show. An `<img>` with no `src` still requests the current page
  // in some browsers, so render nothing rather than a broken element.
  if (src === undefined) return null;

  const decorative = flag(props.decorative);
  // Three states, not two, and `text()` collapses two of them: it answers `""`
  // for a MISSING alt and for an explicitly empty one, which here mean opposite
  // things. An explicit `""` is this block's documented way to say "decorative"
  // and is emitted as written; a missing alt is nobody having said anything,
  // and falling back to the record's text is what keeps a screen reader from
  // being handed the file name.
  //
  // Order is deliberate: `decorative` wins outright, because an author marking
  // an image decorative means `alt=""` even when the record holds text; an
  // author's own alt beats the record's, because it was written for THIS
  // placement; and the record's is the fallback for a placement that says
  // nothing.
  const alt = decorative
    ? ""
    : isAuthoredText(props.alt)
      ? text(props.alt)
      : (usable?.alt ?? "");
  const caption = text(props.caption);
  // Where the picture links, read as the button reads it; the alt text is
  // what names the link.
  const link = await linkFor(props, (collection, id) =>
    ctx.resolveEntryPath(collection, id)
  );

  const image = (
    <img
      /*
       * The block-type class rides the `<img>` in EVERY branch, and only the
       * node's own classes move to a figure or a link around it.
       *
       * The type class is where this block's default sizing lands, and that
       * sizing has to reach the IMAGE: a figure held to its column still
       * contains an `<img>` drawn at the intrinsic width its own attributes
       * declare, so a captioned asset wider than the column overflows while
       * the wrapper around it looks correct. Handing the figure the whole
       * class string put the rule one element above the thing it constrains.
       */
      className={pictureClass(className, caption, link, partClass)}
      src={src}
      alt={alt}
      loading={oneOf(props.loading, IMAGE_LOADING, "lazy")}
      // Intrinsic dimensions reserve the space before the file arrives, which
      // is what stops the text below it jumping when it loads.
      {...(usable?.width === undefined ? {} : { width: usable.width })}
      {...(usable?.height === undefined ? {} : { height: usable.height })}
      {...(decorative ? { role: "presentation" } : {})}
    />
  );
  return wrapPicture(image, {
    className,
    caption,
    link,
    partClass,
    // A picture with no alt text names no link; its caption, then where it
    // goes, does instead, so the link is never unnamed.
    linkName: alt !== "" ? undefined : caption !== "" ? caption : link?.href,
  });
}

/**
 * The picture's classes: the node's own where it is the root, else the type
 * class and the part that takes the corners, proportion, fit and focal point
 * from the root (where the node's classes land), plus the part that fills a
 * link's box when it is linked.
 */
function pictureClass(
  className: string,
  caption: string,
  link: LinkAttributes | undefined,
  partClass: (part: string) => string
): string {
  if (caption === "" && link === undefined) return className;
  return [
    blockTypeClassName(IMAGE_BLOCK),
    partClass("picture"),
    ...(link === undefined ? [] : [partClass("linked")]),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The picture in its link and its figure, as it has them.
 *
 * Only the picture is linked: a caption inside the link would be read as part
 * of its name, and is text a visitor may want to select. A caption belongs to
 * the image, and `figure`/`figcaption` is what says so; the block's own class
 * moves to whichever is the root.
 */
function wrapPicture(
  image: ReactElement,
  {
    className,
    caption,
    link,
    partClass,
    linkName,
  }: {
    className: string;
    caption: string;
    link: LinkAttributes | undefined;
    partClass: (part: string) => string;
    linkName: string | undefined;
  }
): ReactElement {
  const rootClass = caption === "" ? className : "";
  const linked =
    link === undefined ? (
      image
    ) : (
      <a
        {...link}
        className={[rootClass, partClass("link")].filter(Boolean).join(" ")}
        {...(linkName === undefined ? {} : { "aria-label": linkName })}
      >
        {image}
      </a>
    );
  if (caption === "") return linked;
  return (
    <figure
      className={[className, partClass("frame")].filter(Boolean).join(" ")}
    >
      {linked}
      <figcaption className={partClass("caption")}>{caption}</figcaption>
    </figure>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
/**
 * The one pair of declarations that keeps an image inside its container.
 *
 * The element carries `width` and `height` attributes taken from the media
 * record, which is what reserves the right box before the bytes arrive and
 * keeps the page from shifting. Those attributes are also a SIZE: without a
 * rule overriding them, an asset wider than its column renders at its intrinsic
 * width and overflows, and the layout shift the attributes prevented is
 * replaced by a horizontal scrollbar.
 *
 * `height: auto` is not optional beside `maxWidth`. Constraining the width
 * alone leaves the attribute height standing, so a narrowed image is drawn
 * squashed rather than scaled — the aspect ratio is preserved by the pair or by
 * neither.
 *
 * This is the one place every precedent surveyed agrees, which is the standard
 * the typographic defaults set for what belongs in a baseline: it is not a look
 * anyone chose, it is what stops a correct document rendering broken.
 */
/**
 * Named once, because the renderer above derives a class from it and the
 * definition below registers under it. Two literals would be one contract with
 * two spellings, and the rule that missed would simply not apply.
 */
const IMAGE_BLOCK = "core/image";

const IMAGE_BASE_STYLES = {
  base: {
    base: {
      maxWidth: "100%",
      height: "auto",
    },
  },
} as const;

/**
 * The caption, which only the captioned branch renders.
 *
 * Unstyled, it drew at the body's own size directly beneath the picture, so a
 * caption read as another paragraph that happened to follow an image. These are
 * the two things that make it read as a caption instead.
 */
const IMAGE_PARTS = {
  // A captioned picture's figure: the picture and its caption in a column,
  // so a height set on the block is shared between them rather than
  // overflowed.
  frame: {
    baseStyles: {
      base: {
        base: {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          // As wide as its picture unless the block says otherwise, so the
          // picture can fill the figure without stretching past its size.
          width: "fit-content",
        },
      },
    },
  },
  // The picture inside a wrapper (a figure, a link) takes its corners,
  // proportion, fit and focal point from the root, from every tier that styles
  // it (a look, a shared style, the node's own values), so the wrapper's box,
  // and a caption inside it, is never rounded or squared by them. It may
  // shrink to the room the wrapper leaves it, where the fit crops or fits it.
  picture: {
    takesFromRoot: {
      properties: [
        "borderRadius",
        "aspectRatio",
        "objectFit",
        "objectPosition",
      ],
      whenRootIs: ["frame", "link"],
    },
    baseStyles: {
      base: {
        base: {
          // The wrapper's width, which the block's width sets: the box the fit
          // crops or fits the picture to.
          width: "100%",
          minHeight: "0",
        },
      },
    },
  },
  // Inside a link, the picture fills the link's box, so a size set on the
  // block sizes the picture; as a block, so no line gap sits under it.
  linked: {
    baseStyles: {
      base: { base: { display: "block", width: "100%", height: "100%" } },
    },
  },
  // A link wrapping a captioned picture: as wide as what it holds, and free
  // to shrink to the room the figure leaves it, as the picture is.
  link: {
    baseStyles: {
      base: {
        base: {
          display: "inline-block",
          maxWidth: "100%",
          minHeight: "0",
          // Clipped, so nothing the picture draws past its corners shows.
          overflow: "hidden",
        },
      },
    },
  },
  caption: {
    baseStyles: {
      base: {
        base: {
          fontSize: "0.875em",
          margin: { blockStart: "0.5em" },
          // As wide as the figure, which is as wide as its picture: no width
          // of its own to give, so a long caption wraps under a small picture
          // rather than widening the figure and the picture with it.
          width: "0",
          minWidth: "100%",
        },
      },
    },
  },
} as const;

export const image: BlockDefinition<ImageProps, PageContext> = defineBlock({
  name: IMAGE_BLOCK,
  version: 1,
  // What an author reads, in the Add panel and the block card: one plain line.
  // What the block does, for whoever maintains it: A picture, resolved through
  // the host's media library so its URL, alt text and intrinsic size stay
  // current.
  description: "A picture from the media library.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Image",
    icon: "image",
    category: MEDIA,
    keywords: ["picture", "photo", "img", "media"],
    // Its looks, offered as tiles on a block already on the page.
    variations: imageLooks(),
  },
  baseStyles: IMAGE_BASE_STYLES,
  parts: IMAGE_PARTS,
  props: {
    mediaId: {
      label: "Image",
      role: "content",
      type: "media",
      accept: "image/*",
    },
    src: { label: "Image address", role: "content", type: "url" },
    alt: { label: "Alt text", role: "content", type: "text" },
    decorative: { label: "Decorative (no alt text)", type: "checkbox" },
    loading: {
      label: "Loading",
      optionLabels: {
        lazy: "Load when near the screen",
        eager: "Load immediately",
      },
      // Drawn as one switch named by `eager`'s words: two states with a safe
      // default are a yes-or-no question. The stored values stay as they are.
      display: "switch",
      switchOn: "eager",
      hint: "Turn on for images at the top of the page.",
      type: "select",
      options: [...IMAGE_LOADING],
    },
    caption: { label: "Caption", role: "content", type: "text" },
    // The button's link props, by the same names, so the inspector draws the
    // one link control for both and the renderer follows both the same way.
    ...LINK_PROPS,
  },
  // No `alt`: an image placed with none takes its library file's alt text,
  // which is what an author picking a described file expects. A stored `""`
  // would say "decorative" instead and silence that description, so it is
  // left to an author to choose. Only what new blocks are placed with
  // changes; a stored alt, empty or not, reads exactly as before.
  defaultProps: { loading: "lazy" },
  // Both candidates, in the order the render prefers them: the resolved media
  // first, the directly-typed URL as the fallback the render itself falls back
  // to when the record is missing.
  //
  // Each says WHICH KIND it is, because only this block knows: the
  // id came from `mediaId` and the address from `src`, and no inspection of the
  // text can tell them apart — a UUID is a valid relative URL and a bare word
  // is a valid src.
  seo: props => {
    const mediaId = text(props.mediaId);
    const src = url(props.src) ?? "";
    return {
      image: [
        ...(mediaId === "" ? [] : [{ media: mediaId }]),
        ...(src === "" ? [] : [{ url: src }]),
      ],
    };
  },
  // The address only, for the same reason: blocks are placed with their
  // example, and an example alt would be stored as the page's own words in
  // place of the library's.
  example: { props: { src: "/example.jpg" } },
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  // Interactive content while it links, so a link (a linked box or card)
  // cannot hold it, which would nest one link in another.
  contentModel: (props: ImageProps) => ({
    is: canLink(props) ? ["flow", "interactive"] : ["flow"],
  }),
  render: renderImage,
  // A media id may still resolve to nothing, and that is settled by a call to
  // the host — so only the case decidable from the props alone is claimed here:
  // no id AND no usable direct url means there is nothing to draw and nothing
  // to ask about. An id that fails to resolve falls back to drawing nothing at
  // render time, which the boundary already treats as a deliberate decision.
  rendersNothing: props =>
    text(props.mediaId) === "" && url(props.src) === undefined,
});
