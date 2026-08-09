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

import { flag, oneOf, text, url } from "./props";

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
}: BlockRenderArgs<ImageProps>): Promise<ReactElement | null> {
  const mediaId = text(props.mediaId);
  // A resolver that throws must not take the page with it: media lives behind
  // a network call for a signed-URL host, and one unreachable image is not a
  // reason to lose the article around it.
  const resolved =
    mediaId === "" ? null : await ctx.resolveMedia(mediaId).catch(() => null);

  const src = resolved?.url ?? url(props.src);
  // Nothing to show. An `<img>` with no `src` still requests the current page
  // in some browsers, so render nothing rather than a broken element.
  if (src === undefined) return null;

  const decorative = flag(props.decorative);
  const alt = decorative ? "" : text(props.alt, resolved?.alt ?? "");
  const caption = text(props.caption);

  const image = (
    <img
      className={caption === "" ? className : undefined}
      src={src}
      alt={alt}
      loading={oneOf(props.loading, IMAGE_LOADING, "lazy")}
      // Intrinsic dimensions reserve the space before the file arrives, which
      // is what stops the text below it jumping when it loads.
      {...(resolved?.width === undefined ? {} : { width: resolved.width })}
      {...(resolved?.height === undefined ? {} : { height: resolved.height })}
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
export const image = defineBlock<ImageProps, PageContext>({
  name: "core/image",
  version: 1,
  description:
    "A picture, resolved through the host's media library so its URL, alt text and intrinsic size stay current.",
  props: {
    mediaId: { type: "media" },
    src: { type: "url" },
    alt: { type: "text" },
    decorative: { type: "checkbox" },
    loading: { type: "select", options: [...IMAGE_LOADING] },
    caption: { type: "text" },
  },
  defaultProps: { alt: "", loading: "lazy" },
  // The media id when there is one, so the caller resolves it through the same
  // path the rendered image uses; a directly-held `src` otherwise.
  seo: props => ({ image: props.mediaId ?? props.src }),
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
