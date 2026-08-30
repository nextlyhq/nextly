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
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { MEDIA } from "./categories";
import { fetchableUrl, flag, isAuthoredText, oneOf, text, url } from "./props";

/** How the browser should schedule the image. */
export const IMAGE_LOADING = ["lazy", "eager"] as const;

export interface ImageProps {
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

  const image = (
    <img
      className={caption === "" ? className : undefined}
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

  // A caption belongs to the image, and `figure`/`figcaption` is what says so.
  // The block's own class moves to the figure, because that is then the root.
  if (caption === "") return image;
  return (
    <figure className={className}>
      {image}
      <figcaption>{caption}</figcaption>
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
const IMAGE_BASE_STYLES = {
  base: {
    base: {
      maxWidth: "100%",
      height: "auto",
    },
  },
} as const;

export const image = defineBlock<ImageProps, PageContext>({
  name: "core/image",
  version: 1,
  description:
    "A picture, resolved through the host's media library so its URL, alt text and intrinsic size stay current.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Image",
    icon: "image",
    category: MEDIA,
    keywords: ["picture", "photo", "img", "media"],
  },
  baseStyles: IMAGE_BASE_STYLES,
  props: {
    mediaId: { type: "media" },
    src: { type: "url" },
    alt: { type: "text" },
    decorative: { type: "checkbox" },
    loading: { type: "select", options: [...IMAGE_LOADING] },
    caption: { type: "text" },
  },
  defaultProps: { alt: "", loading: "lazy" },
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
  example: { props: { src: "/example.jpg", alt: "An example image" } },
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderImage,
  // A media id may still resolve to nothing, and that is settled by a call to
  // the host — so only the case decidable from the props alone is claimed here:
  // no id AND no usable direct url means there is nothing to draw and nothing
  // to ask about. An id that fails to resolve falls back to drawing nothing at
  // render time, which the boundary already treats as a deliberate decision.
  rendersNothing: props =>
    text(props.mediaId) === "" && url(props.src) === undefined,
});
