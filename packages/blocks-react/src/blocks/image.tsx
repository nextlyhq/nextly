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
  type BlockNode,
  blockTypeClassName,
  defineBlock,
  type BoundValues,
  type ImageValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type {
  BlockRenderArgs,
  PageContext,
  ReadClaim,
  ResolvedMedia,
} from "../context";
import {
  copiesWantedUpTo,
  type ImageCopy,
  narrowForOwnSize,
  sizesFor,
} from "../image-slot";

import { MEDIA } from "./categories";
import {
  ENLARGE_ATTRIBUTE,
  enlargeName,
  Lightbox,
  LIGHTBOX_PARTS,
  lightboxId,
} from "./lightbox";
import { imageLooks } from "./looks";
import {
  boundImage,
  fetchableUrl,
  type BoundImage,
  flag,
  canLink,
  isAuthoredText,
  LINK_PROPS,
  linkFor,
  oneOf,
  readClaimOf,
  text,
  url,
  type LinkAttributes,
  type LinkProps,
  WHEN_CLICKED,
  type WhenClicked,
  whenClickedOf,
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
  /** What a click on the picture does; unset, see `whenClickedOf`. */
  whenClicked?: WhenClicked;
}

/**
 * Whether an image may have anything to draw, and so a link to follow: a
 * media id or an address, the two props its picture candidates are drawn
 * from (`pictureCandidates`; a bound image fills `mediaId`). `has` says
 * whether a prop holds a value or, for a list reading its links ahead, is
 * bound to one. A list asks it before it reads this image's link ahead, so
 * an image with neither, which the render draws as nothing and links
 * nowhere, reads no link.
 */
function imageMayDraw(has: (prop: string) => boolean): boolean {
  return has("mediaId") || has("src");
}

/**
 * Whether an image, drawn with `props`, follows its link: it may draw a
 * picture to wrap ({@link imageMayDraw}), and a click on it follows its link
 * (`whenClickedOf`), the reading its render makes before it reads the link.
 * Set to Nothing or Enlarge, it keeps its link stored and reads none, so a
 * list reading its links ahead reads none for it either.
 */
export function imageFollowsLink(
  has: (prop: string) => boolean,
  props: Readonly<Record<string, unknown>>
): boolean {
  return imageMayDraw(has) && whenClickedOf(props) === "link";
}

/**
 * The media record an image reads first as it is drawn, by its id: its
 * first picture candidate, where that holds a media record. None where it
 * draws an address, a bound URL field's or a fallback's, which takes no
 * read. What a list reads ahead for its images, from the same candidates
 * the render draws from, so a list never reads a record its image will not.
 */
export function firstMediaRead(
  props: Readonly<Record<string, unknown>>,
  bound: BoundValues | undefined
): string | undefined {
  const [first] = pictureCandidates(
    text(props.mediaId),
    props.src,
    boundImage(bound?.mediaId)
  );
  return first?.holds === "media" ? first.value : undefined;
}

export async function renderImage({
  props,
  className,
  ctx,
  node,
  hostPolicy,
  partClass,
  bound,
}: BlockRenderArgs<ImageProps>): Promise<ReactElement | null> {
  // Each read this block makes is claimed as its own, so a page past its
  // allowance names it among the blocks drawn without their data.
  const claim = readClaimOf(node);
  const mediaId = text(props.mediaId);

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

  const { picture, missing } = await firstDrawable(
    pictureCandidates(mediaId, props.src, boundImage(bound?.mediaId)),
    ctx,
    fetchable,
    claim
  );
  // Nothing to show. An `<img>` with no `src` still requests the current page
  // in some browsers, so a visitor's page draws nothing rather than a broken
  // element, and the editor draws the box it puts its controls on.
  if (picture === undefined) {
    return emptyPicture({ ctx, node, className, partClass, missing });
  }
  const { record: usable } = picture;
  // Sized to where it sits, where the site keeps copies; as it is otherwise.
  const sized = await sizedPicture(picture, ctx, node, fetchable);

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
  // what names the link. Only while a click follows it: an Image set to
  // Nothing or Enlarge keeps its link stored for when the author switches
  // back, and draws none, so no entry path is read for it either.
  const link =
    whenClickedOf(props) === "link"
      ? await linkFor(props, (collection, id) =>
          ctx.resolveEntryPath(collection, id, claim)
        )
      : undefined;
  // Where a click enlarges the picture, the id of the lightbox it opens.
  const enlarge = lightboxOf(props, node, ctx);

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
      className={pictureClass(className, caption, { link, enlarge }, partClass)}
      {...pictureAttributes(sized, props.loading)}
      alt={alt}
      // Intrinsic dimensions reserve the space before the file arrives, which
      // is what stops the text below it jumping when it loads.
      {...(usable?.width === undefined ? {} : { width: usable.width })}
      {...(usable?.height === undefined ? {} : { height: usable.height })}
      {...(decorative ? { role: "presentation" } : {})}
    />
  );
  if (enlarge !== undefined) {
    return enlargedPicture(image, {
      id: enlarge,
      className,
      caption,
      alt,
      partClass,
      // The full-size file is the original, never a copy sized to the page.
      full: { src: picture.src, width: usable?.width, height: usable?.height },
    });
  }
  return wrapPicture(image, {
    className,
    caption,
    link,
    partClass,
    linkName: linkNameOf(alt, caption, link),
  });
}

/**
 * The name a linked picture with no alt text gives its link: its caption,
 * then where it goes, so the link is never unnamed. None while the alt text
 * names it.
 */
function linkNameOf(
  alt: string,
  caption: string,
  link: LinkAttributes | undefined
): string | undefined {
  if (alt !== "") return undefined;
  return caption !== "" ? caption : link?.href;
}

/**
 * The id of the lightbox a click on the picture opens, where it enlarges:
 * from the node, which a block drawn on its own outside a page is not
 * handed, so such a picture is drawn as Nothing would draw it.
 */
function lightboxOf(
  props: ImageProps,
  node: BlockNode | undefined,
  ctx: PageContext | undefined
): string | undefined {
  if (whenClickedOf(props) !== "enlarge" || node?.id === undefined) {
    return undefined;
  }
  return lightboxId(node.id, ctx?.itemPosition);
}

/**
 * The attribute on the box an Image with no picture draws on the editor's
 * canvas, naming why it has none: `empty`, nothing chosen yet, or `missing`,
 * a library file it names that the library no longer has. The editor's
 * canvas finds the box by it and draws its controls over it; its test draws
 * this block to find it, so the two spellings cannot drift apart unseen.
 */
const IMAGE_EMPTY_ATTRIBUTE = "data-nx-image-empty";

/** Why an Image draws its empty box, as {@link IMAGE_EMPTY_ATTRIBUTE} says it. */
type ImageEmptyReason = "empty" | "missing";

/**
 * What an Image with no picture draws.
 *
 * Nothing on a page a visitor is served, which is where an empty Image has
 * nothing to show. Where an author is looking (`diagnostics`), a box the size
 * the picture would take, 16:9 unless the block sets its own proportion, so
 * a new Image is a place on the canvas rather than a line nothing can land
 * on; the editor draws its choices over it. The box carries the block's own
 * classes, so a size, a proportion or a corner set on the block shapes it.
 *
 * A bound Image, by its media or its address, is left out: its picture is
 * its binding's, and what it shows without one is the binding's Fallback,
 * which the binding's own controls set.
 */
function emptyPicture({
  ctx,
  node,
  className,
  partClass,
  missing,
}: {
  ctx: PageContext | undefined;
  node: BlockNode | undefined;
  className: string;
  partClass: (part: string) => string;
  missing: boolean;
}): ReactElement | null {
  if (ctx?.diagnostics !== true) return null;
  if (
    node?.bindings?.mediaId !== undefined ||
    node?.bindings?.src !== undefined
  )
    return null;
  const reason: ImageEmptyReason = missing ? "missing" : "empty";
  return (
    <div
      className={[className, partClass("empty")].filter(Boolean).join(" ")}
      {...{ [IMAGE_EMPTY_ATTRIBUTE]: reason }}
    />
  );
}

/** One place a picture may come from: a media id, or an address. */
type PictureCandidate = ImageValue;

/** The picture drawn: its address, and the media record it came from. */
interface Picture {
  readonly src: string;
  readonly record: ResolvedMedia | null;
  /** What the site's copies of it are asked for by: its id, or its address. */
  readonly source: { readonly id: string } | { readonly url: string };
}

/**
 * Where the picture may come from, in order.
 *
 * Unbound: the picked media, then the typed address. Bound: what the binding
 * filled `mediaId` with, a media id resolved exactly as a picked one is or an
 * image address, then the binding's fallback, and nothing after it. The
 * typed address is not a fallback for a binding, which names its own.
 */
function pictureCandidates(
  mediaId: string,
  typed: unknown,
  image: BoundImage | undefined
): PictureCandidate[] {
  if (image === undefined) {
    return [
      ...(mediaId === "" ? [] : [{ holds: "media" as const, value: mediaId }]),
      ...(typeof typed === "string" && typed !== ""
        ? [{ holds: "address" as const, value: typed }]
        : []),
    ];
  }
  return [
    ...(mediaId === "" ? [] : [{ holds: image.holds, value: mediaId }]),
    ...(image.fallback === undefined ? [] : [image.fallback]),
  ];
}

/**
 * The first candidate actually allowed, asked in order.
 *
 * A media record whose url either filter refused is dropped WHOLE, not just
 * for its url. Its alt text and intrinsic size describe the asset that was
 * refused, so keeping them beside the next candidate announces one image to a
 * screen reader while reserving the other one's space. A record the host
 * cannot find, deleted since it was picked or bound, moves on the same way,
 * and is reported as `missing` when nothing after it draws either.
 */
async function firstDrawable(
  candidates: readonly PictureCandidate[],
  ctx: PageContext,
  fetchable: (value: unknown) => string | undefined,
  claim: ReadClaim | undefined
): Promise<{ picture?: Picture; missing: boolean }> {
  let missing = false;
  for (const candidate of candidates) {
    if (candidate.holds === "address") {
      const src = fetchable(candidate.value);
      if (src !== undefined) {
        return {
          picture: { src, record: null, source: { url: src } },
          missing,
        };
      }
      continue;
    }
    // A resolver that throws must not take the page with it: media lives
    // behind a network call for a signed-URL host, and one unreachable image
    // is not a reason to lose the article around it.
    const record = await ctx
      .resolveMedia(candidate.value, claim)
      .catch(() => null);
    if (record === null) missing = true;
    const src = fetchable(record?.url);
    if (
      record !== null &&
      src !== undefined &&
      typeof candidate.value === "string"
    ) {
      return {
        picture: { src, record, source: { id: candidate.value } },
        missing,
      };
    }
  }
  return { missing };
}

/** The picture's sources as drawn: one address, or copies for its slot. */
interface SizedPicture {
  readonly src: string;
  readonly srcSet?: string;
  readonly sizes?: string;
  /** In the page's first block: loaded at once and before other images. */
  readonly eager: boolean;
}

/**
 * The `<img>` attributes a sized picture sets: its sources, and how soon it
 * loads, at once and first in the page's first block, as the author chose
 * otherwise.
 */
function pictureAttributes(
  sized: SizedPicture,
  loading: unknown
): {
  src: string;
  srcSet?: string;
  sizes?: string;
  loading: "lazy" | "eager";
  fetchPriority?: "high";
} {
  return {
    src: sized.src,
    ...(sized.srcSet === undefined
      ? {}
      : { srcSet: sized.srcSet, sizes: sized.sizes }),
    ...(sized.eager
      ? { loading: "eager", fetchPriority: "high" }
      : { loading: oneOf(loading, IMAGE_LOADING, "lazy") }),
  };
}

/**
 * Add the original itself where it fits the bound and the copies stop short of
 * it: copies are never wider than their original, so one 600px wide has none
 * past 320, and a slot drawing it at 600 would otherwise stretch that.
 */
function withOriginal(
  sources: { url: string; width: number }[],
  picture: Picture,
  upTo: number
): void {
  const own = picture.record?.width;
  if (own === undefined || own > upTo) return;
  if (own > (sources.at(-1)?.width ?? 0)) {
    sources.push({ url: picture.src, width: own });
  }
}

/** Whether a media record states the picture's width and height. */
function hasDimensions(record: ResolvedMedia | null): boolean {
  return (
    typeof record?.width === "number" &&
    record.width > 0 &&
    typeof record.height === "number" &&
    record.height > 0
  );
}

/**
 * Whether the picture is in the page's first block, so it loads at once and
 * before other images. Read with care: a block drawn on its own, outside a
 * page, is handed no context or node, and loads as the author chose.
 */
function loadsFirst(
  ctx: PageContext | undefined,
  node: BlockNode | undefined
): boolean {
  if (ctx?.imageSlot?.eager === true) return true;
  return node?.id !== undefined && node.id === ctx?.firstBlockId;
}

/**
 * The picture's sources, sized to the slot it is drawn in.
 *
 * Where the page sizes images, the site's copies no wider than twice the
 * slot's widest width are offered as `srcset`, with `sizes` saying how wide it
 * is drawn on each device, so a phone downloads a phone-sized copy. The widest
 * copy is the `src` a browser without `srcset` takes. A copy the host list
 * refuses is left out, as any other address would be. Where no copy can be
 * had, or the lookup fails, the original is drawn as it always was: a page is
 * never left without its image for want of a smaller one.
 */
async function sizedPicture(
  picture: Picture,
  ctx: PageContext | undefined,
  node: BlockNode | undefined,
  fetchable: (value: unknown) => string | undefined
): Promise<SizedPicture> {
  const slot = ctx?.imageSlot;
  const original: SizedPicture = {
    src: picture.src,
    eager: loadsFirst(ctx, node),
  };
  if (slot === undefined || ctx?.imageCopies === undefined) return original;
  // Only where the media record gives the picture's width and height, which
  // the `<img>` then carries. Without them, `srcset` with `sizes` would set
  // its intrinsic width to the slot's, and a small picture drawn at its own
  // width would grow to fill its container.
  if (!hasDimensions(picture.record)) return original;
  const drawn = narrowForOwnSize(slot, node?.styles);
  const upTo = copiesWantedUpTo(drawn);
  const copies = await ctx
    .imageCopies(picture.source, upTo)
    .catch((): readonly ImageCopy[] => []);
  const usable = copies
    .filter(copy => copy.width > 0 && copy.width <= upTo)
    .flatMap(copy => {
      const url = fetchable(copy.url);
      return url === undefined ? [] : [{ url, width: copy.width }];
    })
    .sort((a, b) => a.width - b.width);
  withOriginal(usable, picture, upTo);
  const widest = usable.at(-1);
  if (widest === undefined) return original;
  return {
    src: widest.url,
    srcSet: usable.map(copy => `${copy.url} ${copy.width}w`).join(", "),
    sizes: sizesFor(drawn),
    eager: original.eager,
  };
}

/**
 * The picture's classes: the node's own where it is the root, else the type
 * class and the part that takes the corners, proportion, fit and focal point
 * from the root (where the node's classes land), plus the part that fills
 * the box of the link or button it is wrapped in.
 */
function pictureClass(
  className: string,
  caption: string,
  around: { link: LinkAttributes | undefined; enlarge: string | undefined },
  partClass: (part: string) => string
): string {
  const wrapped = around.link !== undefined || around.enlarge !== undefined;
  if (caption === "" && !wrapped) return className;
  return [
    blockTypeClassName(IMAGE_BLOCK),
    partClass("picture"),
    ...(wrapped ? [partClass("linked")] : []),
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

/**
 * A picture a click enlarges: the picture as the button that opens its
 * lightbox, in a figure that holds the caption and the lightbox beside it,
 * so the block keeps one root whether or not it has a caption.
 *
 * The button only opens (`show`): a click on the picture while its lightbox
 * is open lands on the backdrop, which closes it, and never reopens it.
 */
function enlargedPicture(
  image: ReactElement,
  {
    id,
    className,
    caption,
    alt,
    partClass,
    full,
  }: {
    id: string;
    className: string;
    caption: string;
    alt: string;
    partClass: (part: string) => string;
    full: { src: string; width?: number; height?: number };
  }
): ReactElement {
  return (
    <figure
      className={[className, partClass("frame")].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className={partClass("enlarge")}
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={enlargeName(alt)}
        {...{ [ENLARGE_ATTRIBUTE]: "" }}
      >
        {image}
      </button>
      {caption === "" ? null : (
        <figcaption className={partClass("caption")}>{caption}</figcaption>
      )}
      <Lightbox
        id={id}
        src={full.src}
        alt={alt}
        width={full.width}
        height={full.height}
        caption={caption}
        partClass={partClass}
      />
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
/** The image block's type, which a list reading its links ahead asks by. */
export const IMAGE_TYPE = "core/image";
const IMAGE_BLOCK = IMAGE_TYPE;

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
  // The button an enlarged picture is, and the lightbox it opens.
  ...LIGHTBOX_PARTS,
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
  // The box an Image with no picture draws for its author (`emptyPicture`):
  // as wide as its column and 16:9, the proportion a picture most often has,
  // until the block sets its own size or proportion, which outweighs these.
  empty: {
    baseStyles: {
      base: {
        base: {
          display: "block",
          width: "100%",
          aspectRatio: "16 / 9",
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

/** The Content section a click's choice and its link are drawn in. */
const WHEN_CLICKED_SECTION = "When clicked";

/**
 * The shared link props, each placed in the When clicked section, where the
 * editor draws them under the choice that uses them.
 */
function whenClickedLinkProps(): {
  readonly [Name in keyof typeof LINK_PROPS]: (typeof LINK_PROPS)[Name] & {
    readonly section: string;
  };
} {
  return {
    href: { ...LINK_PROPS.href, section: WHEN_CLICKED_SECTION },
    entryCollection: {
      ...LINK_PROPS.entryCollection,
      section: WHEN_CLICKED_SECTION,
    },
    entryId: { ...LINK_PROPS.entryId, section: WHEN_CLICKED_SECTION },
    target: { ...LINK_PROPS.target, section: WHEN_CLICKED_SECTION },
    rel: { ...LINK_PROPS.rel, section: WHEN_CLICKED_SECTION },
  };
}

/**
 * Whether a click on the picture does something a visitor can reach: it
 * follows a link it has, or it enlarges the picture.
 */
function clickable(props: ImageProps): boolean {
  const click = whenClickedOf(props);
  return click === "enlarge" || (click === "link" && canLink(props));
}

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
      // An image kept by its address, as an unbound one a visitor saw by
      // address is, belongs in `src`: `mediaId` holds a library id only.
      addressProp: "src",
    },
    src: { label: "Image address", role: "content", type: "url" },
    alt: { label: "Alt text", role: "content", type: "text" },
    decorative: { label: "Decorative, no alt text", type: "checkbox" },
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
    // What a click does, with the link it follows beside it in the same
    // section: the editor draws the link's settings only while Link is
    // chosen. Stored as chosen; a new Image stores none (see `whenClickedOf`).
    // Content, as the link it gates is: where only content may change, an
    // author still chooses Link to add one.
    whenClicked: {
      label: "When clicked",
      role: "content",
      section: WHEN_CLICKED_SECTION,
      type: "select",
      options: [...WHEN_CLICKED],
      optionLabels: { nothing: "Nothing", link: "Link", enlarge: "Enlarge" },
    },
    // The button's link props, by the same names, so the inspector draws the
    // one link control for both and the renderer follows both the same way.
    ...whenClickedLinkProps(),
    caption: {
      label: "Caption",
      role: "content",
      type: "text",
      section: "Caption",
    },
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
  // A bound image offers what the page draws for it, from the same
  // candidates, so metadata never names a picture the page does not show.
  seo: (props, read) => ({
    image: pictureCandidates(
      text(props.mediaId),
      url(props.src),
      boundImage(read?.bound?.mediaId)
    ).map(candidate =>
      candidate.holds === "media"
        ? { media: candidate.value }
        : { url: candidate.value }
    ),
  }),
  // Nothing at all. Blocks are placed with their example, so an address here
  // is stored on every new Image as the page's own, pointing at a file the
  // site does not have; an alt would be stored as the page's own words in
  // place of the library's. A new Image starts empty, and the canvas draws
  // its choices: upload, the media library, or a link.
  example: { props: {} },
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  // Interactive content while it links or enlarges, so a link (a linked box
  // or card) cannot hold it, which would nest a link or a button in another.
  // Link chosen with nothing to follow draws no link, so it is not.
  contentModel: (props: ImageProps) => ({
    is: clickable(props) ? ["flow", "interactive"] : ["flow"],
  }),
  render: renderImage,
  // No `rendersNothing`. An Image with no picture draws nothing on a page a
  // visitor is served, but on the canvas it draws its empty box, which wears
  // the block's own classes so a size or a proportion set on the block shapes
  // it. A declaration answers from the props alone, for every render, and the
  // stylesheet holds back the rules of a block that declares it draws
  // nothing; declared here, the box would lose the very rules it is drawn to
  // show. So an empty Image draws nothing at render time instead, as one whose
  // library file has gone always has, and the boundary treats that as a
  // deliberate decision too.
});
