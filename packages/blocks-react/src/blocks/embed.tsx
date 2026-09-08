/**
 * `core/embed` — third-party content in an iframe.
 *
 * Sandboxed by default, and the default is the point. An un-sandboxed iframe
 * can navigate the top-level page, run scripts against its own origin and open
 * dialogs, so a marketing page carrying one embed hands that reach to whoever
 * controls the embedded URL. The permissions here are the smallest set that
 * makes a video player work.
 *
 * Whether a frame keeps its own origin is decided by HOST CONFIGURATION, not by
 * the document. It used to be a checkbox on the block, which meant a security
 * posture was being chosen by whoever edited the page, could be set against any
 * URL, and travelled with the content if that content was ever copied. It is
 * now an origin allowlist the site operator sets once, so the grant belongs to
 * a named origin rather than to a node.
 *
 * The grant follows the frame, not the URL: sandbox permissions survive a
 * redirect, so an allowlisted origin is trusted for wherever it forwards to.
 * See `BlockHostPolicy.trustedFrameOrigins` for what to pair this with.
 *
 * A `title` is emitted always. An iframe without one is announced only as
 * "frame", which tells a screen-reader user nothing about whether to enter it.
 *
 * @module blocks/embed
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { MEDIA } from "./categories";
import { fetchableUrl, flag, isTrustedOrigin, text, url } from "./props";

/**
 * What an embedded document may do.
 *
 * `allow-scripts` and `allow-same-origin` together would let the frame remove
 * its own sandbox, so they are never both granted by this default: scripts run,
 * but in an opaque origin.
 */
const SANDBOX = "allow-scripts allow-popups allow-forms allow-presentation";

export interface EmbedProps {
  /** The URL to embed. */
  src?: string;
  /** An accessible name describing what is embedded. */
  title?: string;
  /** Whether the frame may go fullscreen. */
  allowFullscreen?: boolean;
}

export function renderEmbed({
  props,
  className,
  hostPolicy,
}: BlockRenderArgs<EmbedProps>): ReactElement | null {
  const src = url(props.src);
  // No source means no frame. An iframe with an empty `src` loads the current
  // page inside itself in several browsers, which is a recursive render.
  if (src === undefined) return null;
  // The host's fetch list, asked here rather than at the boundary: the boundary
  // sees the element this returns, not the URL chosen to build it. An unlisted
  // host renders nothing at all rather than an empty frame, for the same reason
  // as above — a frame with no usable source is worse than no frame.
  if (fetchableUrl(src, hostPolicy?.remotePatterns) === undefined) return null;

  const title = text(props.title, "Embedded content");
  // Keeping its own origin is the host's decision about this URL, not the page
  // editor's about this block. Granted only when the origin was named in
  // configuration, so the answer cannot be reached by typing a URL into a
  // field, and it is scoped to the origin that was trusted rather than to
  // whatever the field happens to hold now.
  const sandbox = isTrustedOrigin(src, hostPolicy?.trustedFrameOrigins)
    ? `${SANDBOX} allow-same-origin`
    : SANDBOX;

  return (
    <iframe
      className={className}
      src={src}
      title={title}
      sandbox={sandbox}
      loading="lazy"
      // Referrer trimmed to the origin: the full path of the page an embed sits
      // on is not the embedded party's business, and a draft preview URL is
      // exactly the kind of path that must not travel.
      referrerPolicy="strict-origin-when-cross-origin"
      {...(flag(props.allowFullscreen) ? { allowFullScreen: true } : {})}
    />
  );
}

/**
 * The shape an embed takes before an author gives it one.
 *
 * A user agent sizes an `<iframe>` at 300x150 and nothing here overrode it, so
 * a video dropped on a page rendered at postage-stamp size in the corner of a
 * full-width column — measured on a published page, and the block declared no
 * defaults at all.
 *
 * `16 / 9` because that is what the sources an embed block is for actually
 * serve: YouTube, Vimeo and every player that follows them. It is a DEFAULT
 * rather than a rule — `dimensions` is in this block's `supports`, so an
 * author setting a height or a ratio of their own outranks it, which is what
 * an audio embed or a square player needs.
 *
 * `width: 100%` alongside it, because a ratio alone still resolves against the
 * 300px the user agent starts from: the pair is what makes the frame fill its
 * column and take its height from that width.
 */
const EMBED_BASE_STYLES = {
  base: {
    base: {
      width: "100%",
      aspectRatio: "16 / 9",
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const embed = defineBlock<EmbedProps, PageContext>({
  name: "core/embed",
  version: 1,
  description:
    "Third-party content in a sandboxed iframe, with an accessible name and a referrer policy that does not leak the page's path.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Embed",
    icon: "embed",
    category: MEDIA,
    keywords: ["video", "iframe", "youtube", "external"],
  },
  props: {
    src: { type: "url" },
    title: { type: "text" },
    allowFullscreen: { type: "checkbox" },
  },
  defaultProps: { title: "", allowFullscreen: true },
  example: {
    props: { src: "https://example.com/player", title: "A product demo" },
  },
  baseStyles: EMBED_BASE_STYLES,
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderEmbed,
  // The whole condition is in the props: no usable source, no iframe. This is
  // the same test `renderEmbed` applies, deliberately written as one expression
  // in both places rather than shared, because a helper would let the two drift
  // apart silently while looking coordinated.
  // Deliberately answered from the props ALONE. The declaration is read without
  // a render, so it has no host policy to consult; a URL the policy will refuse
  // is reported here as output, and the render then draws nothing. Erring that
  // way costs an empty rule in a stylesheet, while erring the other way would
  // claim a drawing block draws nothing.
  rendersNothing: props => url(props.src) === undefined,
});
