/**
 * `core/embed` — third-party content in an iframe.
 *
 * Sandboxed by default, and the default is the point. An un-sandboxed iframe
 * can navigate the top-level page, run scripts against its own origin and open
 * dialogs, so a marketing page carrying one embed hands that reach to whoever
 * controls the embedded URL. The permissions here are the smallest set that
 * makes a video player work.
 *
 * A `title` is emitted always. An iframe without one is announced only as
 * "frame", which tells a screen-reader user nothing about whether to enter it.
 *
 * @module blocks/embed
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { flag, text, url } from "./props";

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
  /**
   * Drop the sandbox. A deliberate escape hatch for a first-party embed that
   * genuinely needs its own origin, and never the default.
   */
  allowSameOrigin?: boolean;
  /** Whether the frame may go fullscreen. */
  allowFullscreen?: boolean;
}

export function renderEmbed({
  props,
  className,
}: BlockRenderArgs<EmbedProps>): ReactElement | null {
  const src = url(props.src);
  // No source means no frame. An iframe with an empty `src` loads the current
  // page inside itself in several browsers, which is a recursive render.
  if (src === undefined) return null;

  const title = text(props.title, "Embedded content");
  const sandbox = flag(props.allowSameOrigin)
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

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const embed = defineBlock<EmbedProps, PageContext>({
  name: "core/embed",
  version: 1,
  description:
    "Third-party content in a sandboxed iframe, with an accessible name and a referrer policy that does not leak the page's path.",
  props: {
    src: { type: "url" },
    title: { type: "text" },
    allowSameOrigin: { type: "checkbox" },
    allowFullscreen: { type: "checkbox" },
  },
  defaultProps: { title: "", allowFullscreen: true },
  example: {
    props: { src: "https://example.com/player", title: "A product demo" },
  },
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderEmbed,
});
