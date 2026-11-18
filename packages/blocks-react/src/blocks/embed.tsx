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
 * A link from a provider the block knows by name (`embed-providers.ts`) is
 * the exception to both rules above, because the block itself builds the
 * address the frame loads: the provider's player, put together from the id
 * the link carries, on that provider's own origin. That frame keeps its
 * origin, which the players need to run, and its origin counts as one the
 * site may load from. Every other link is drawn exactly as before.
 *
 * A known provider's player is not loaded with the page unless the author
 * chooses "Right away". By default ("When played") the frame holds a poster,
 * a small document written into `srcdoc` with no script in it, whose play
 * link takes the frame itself to the player. Nothing is asked of the
 * provider until the visitor presses it: no player, no cookie, no picture.
 *
 * A `title` is emitted always. An iframe without one is announced only as
 * "frame", which tells a screen-reader user nothing about whether to enter it.
 *
 * @module blocks/embed
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { MEDIA } from "./categories";
import { detectEmbed, isPlayerOf, type EmbedMatch } from "./embed-providers";
import {
  fetchableUrl,
  flag,
  isTrustedOrigin,
  oneOf,
  readClaimOf,
  text,
  url,
} from "./props";

/**
 * What an embedded document may do.
 *
 * `allow-scripts` and `allow-same-origin` together would let the frame remove
 * its own sandbox, so they are never both granted by this default: scripts run,
 * but in an opaque origin.
 */
const SANDBOX = "allow-scripts allow-popups allow-forms allow-presentation";

/** When a known provider's player loads: on the poster's play, or with the page. */
const EMBED_LOADS = ["click", "page"] as const;

/** When a known provider's player loads. */
export type EmbedLoad = (typeof EMBED_LOADS)[number];

export interface EmbedProps {
  /** The link to embed, kept as the author pasted it. */
  src?: string;
  /** An accessible name describing what is embedded. */
  title?: string;
  /** Whether the frame may go fullscreen. */
  allowFullscreen?: boolean;
  /**
   * When a known provider's player loads: `click`, when the visitor presses
   * play on the poster, or `page`, with the page. Unset reads as `page`, which
   * is how an Embed loaded before it had the choice; a new one stores `click`.
   */
  load?: EmbedLoad;
  /**
   * Use the provider's privacy-enhanced player, where it has one. Unset reads
   * as on.
   */
  privacy?: boolean;
  /** A media library picture to draw on the poster, by its id. */
  poster?: string;
}

/** The frame attributes every embed carries, whatever it loads. */
interface FrameBase {
  readonly className: string;
  readonly title: string;
  readonly sandbox: string;
  readonly allowFullscreen: boolean;
}

/** An `<iframe>` with the attributes every embed carries, and its source. */
function frame(
  base: FrameBase,
  source: { readonly src: string } | { readonly srcDoc: string },
  extra: { readonly allow?: string; readonly lazy?: boolean } = {}
): ReactElement {
  return (
    <iframe
      className={base.className}
      {...source}
      title={base.title}
      sandbox={base.sandbox}
      {...(extra.allow === undefined ? {} : { allow: extra.allow })}
      {...(extra.lazy === false ? {} : { loading: "lazy" as const })}
      // Referrer trimmed to the origin: the full path of the page an embed sits
      // on is not the embedded party's business, and a draft preview URL is
      // exactly the kind of path that must not travel.
      referrerPolicy="strict-origin-when-cross-origin"
      {...(base.allowFullscreen ? { allowFullScreen: true } : {})}
    />
  );
}

export async function renderEmbed({
  props,
  className,
  hostPolicy,
  ctx,
  node,
}: BlockRenderArgs<EmbedProps>): Promise<ReactElement | null> {
  const src = url(props.src);
  // No source means no frame. An iframe with an empty `src` loads the current
  // page inside itself in several browsers, which is a recursive render. Where
  // an author is looking, the block draws the box the editor puts its "paste
  // a link" field on instead.
  if (src === undefined) return emptyEmbed(ctx, className);
  const allowFullscreen = flag(props.allowFullscreen);

  const match = detectEmbed(src);
  if (match !== undefined) {
    const known = await providerFrame(match, {
      props,
      className,
      allowFullscreen,
      ctx,
      hostPolicy,
      claimant: node,
    });
    if (known !== null) return known;
  }

  // The host's fetch list, asked here rather than at the boundary: the boundary
  // sees the element this returns, not the URL chosen to build it. An unlisted
  // host renders nothing at all rather than an empty frame, for the same reason
  // as above — a frame with no usable source is worse than no frame.
  if (fetchableUrl(src, hostPolicy?.remotePatterns) === undefined) return null;

  // Keeping its own origin is the host's decision about this URL, not the page
  // editor's about this block. Granted only when the origin was named in
  // configuration, so the answer cannot be reached by typing a URL into a
  // field, and it is scoped to the origin that was trusted rather than to
  // whatever the field happens to hold now.
  const sandbox = isTrustedOrigin(src, hostPolicy?.trustedFrameOrigins)
    ? `${SANDBOX} allow-same-origin`
    : SANDBOX;
  return frame(
    {
      className,
      title: frameTitle(props.title, "Embedded content"),
      sandbox,
      allowFullscreen,
    },
    { src }
  );
}

/**
 * The frame's title: the author's label, or `fallback` when they left it
 * blank. A new Embed stores an empty label, and an empty `title` is announced
 * as no title at all, so blank is read as "not given" rather than as a label.
 */
function frameTitle(label: unknown, fallback: string): string {
  const given = text(label).trim();
  return given === "" ? fallback : given;
}

/**
 * The attribute on the box an Embed with no link draws on the editor's canvas.
 * The editor finds the box by it and draws its "paste a link" field over it;
 * its test draws this block to find it, so the two spellings cannot drift
 * apart unseen.
 */
export const EMBED_EMPTY_ATTRIBUTE = "data-nx-embed-empty";

/**
 * What an Embed with no link draws: nothing on a page a visitor is served,
 * and, where an author is looking (`diagnostics`), a box in the block's own
 * classes, so it takes the size and proportion the frame would.
 */
function emptyEmbed(
  ctx: PageContext | undefined,
  className: string
): ReactElement | null {
  if (ctx?.diagnostics !== true) return null;
  return <div className={className} {...{ [EMBED_EMPTY_ATTRIBUTE]: "" }} />;
}

/**
 * The permissions a known provider's player is given: today's set, and its
 * own origin, which the players need to run (YouTube's and Vimeo's refuse to
 * play in an opaque origin).
 *
 * Granted only to a frame whose address the block built for that provider, on
 * the provider's own player origin, so no link an author types can reach it.
 * The poster shares the grant because the play link takes the same frame to
 * the player, and a frame's sandbox is fixed by its element, not by the
 * document in it. The poster holds no script, so in its own document the
 * grant has nothing to act on.
 */
const PLAYER_SANDBOX = `${SANDBOX} allow-same-origin`;

/** The features a player may use: playing on the press that loaded it. */
const PLAYER_ALLOW = "autoplay; encrypted-media; picture-in-picture";

/** What drawing a known provider's frame needs. */
interface ProviderFrameArgs {
  readonly props: EmbedProps;
  readonly className: string;
  readonly allowFullscreen: boolean;
  readonly ctx: PageContext | undefined;
  readonly hostPolicy: BlockRenderArgs<EmbedProps>["hostPolicy"];
  readonly claimant: BlockRenderArgs<EmbedProps>["node"];
}

/**
 * A known provider's frame: the poster, or the player with the page.
 *
 * `null` when the address built is not on the provider's player origin, which
 * the table never builds; the link is then drawn as any other link is, with
 * no grant.
 */
async function providerFrame(
  match: EmbedMatch,
  { props, className, allowFullscreen, ctx, hostPolicy, claimant }: ProviderFrameArgs
): Promise<ReactElement | null> {
  const privacy = match.privacyMode && flag(props.privacy, true);
  const load = oneOf(props.load, EMBED_LOADS, "page");
  const player = match.playerAddress({ privacy, autoplay: load === "click" });
  if (!isPlayerOf(match.provider, player)) return null;
  const base: FrameBase = {
    className,
    // The author's label, else what the link is, so a frame is never
    // announced only as "frame".
    title: frameTitle(props.title, match.kind),
    sandbox: PLAYER_SANDBOX,
    allowFullscreen,
  };
  if (load === "page") {
    return frame(base, { src: player }, { allow: PLAYER_ALLOW });
  }
  const picture = await posterPicture(props.poster, {
    ctx,
    hostPolicy,
    claimant,
  });
  return frame(
    base,
    {
      srcDoc: posterDocument({
        title: base.title,
        provider: match.name,
        player,
        picture,
        lang: ctx?.locale,
      }),
    },
    // Not lazy: the poster is the site's own document, and it is small.
    { allow: PLAYER_ALLOW, lazy: false }
  );
}

/**
 * The poster's picture: the media library file it names, by an address this
 * site may load; `undefined` for none, a missing file or one the site does
 * not load, which draws the plain poster rather than a broken picture.
 */
async function posterPicture(
  poster: unknown,
  {
    ctx,
    hostPolicy,
    claimant,
  }: Pick<ProviderFrameArgs, "ctx" | "hostPolicy" | "claimant">
): Promise<string | undefined> {
  const id = text(poster);
  if (id === "" || ctx === undefined) return undefined;
  // A resolver that throws must not take the page with it: one unreachable
  // picture is not a reason to lose the embed around it.
  const record = await ctx
    .resolveMedia(id, readClaimOf(claimant))
    .catch(() => null);
  return fetchableUrl(record?.url, hostPolicy?.remotePatterns);
}

/** What the poster document shows. */
export interface PosterContent {
  /** The frame's title: the author's label, or what the link is. */
  readonly title: string;
  /** The provider's name: "YouTube". */
  readonly provider: string;
  /** The player's address, which the play link opens in the frame. */
  readonly player: string;
  /** The poster's picture, from this site; none draws the plain poster. */
  readonly picture?: string | undefined;
  /** The page's language, which the poster's words are in. */
  readonly lang?: string | undefined;
}

/**
 * The characters that would let a value end the text or attribute it is in.
 * Every value the poster shows is written through this, the author's label
 * and the addresses alike, so none can become markup.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** A value written into the poster's HTML as text or a quoted attribute. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? "");
}

/**
 * The poster's styles, inline in its document because nothing of the page's
 * stylesheet reaches into a frame.
 *
 * The document's own background is left transparent, so the frame's, which
 * the page styles in the site's colours and its dark values, shows through.
 * The words and the play button sit on a dark scrim of their own, white on
 * near-black, so they keep their contrast on any site colour and over any
 * picture. The play button is at least 44px square; its focus ring is drawn
 * in white and black together, so it shows on a light picture and a dark one.
 */
const POSTER_STYLES = [
  "html,body{margin:0;height:100%;background:transparent}",
  "a{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;box-sizing:border-box;color:#fff;text-decoration:none;font:500 16px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}",
  "img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
  ".play{position:relative;display:grid;place-items:center;width:68px;height:48px;min-width:44px;min-height:44px;border-radius:12px;background:rgba(0,0,0,.8)}",
  ".play svg{width:24px;height:24px;fill:#fff}",
  "a:hover .play{background:#000}",
  "a:focus{outline:none}",
  "a:focus-visible .play{outline:2px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px #000}",
  ".words{position:relative;max-width:100%;padding:4px 12px;border-radius:8px;background:rgba(0,0,0,.8);text-align:center;overflow-wrap:anywhere}",
  ".provider{display:block;font-size:14px;font-weight:400}",
].join("");

/**
 * The poster: a document with no script, whose one link is the play button.
 *
 * Pressing it takes the frame itself to the player (a link in a frame opens
 * in that frame), asking the player to start, so the visitor's one press
 * both loads and plays it. Until then nothing in the document is the
 * provider's: the picture, when there is one, is a copy in this site's media
 * library.
 *
 * Exported so its guarantees (no script, every value escaped) are tested
 * against the document itself.
 */
export function posterDocument({
  title,
  provider,
  player,
  picture,
  lang,
}: PosterContent): string {
  const language =
    lang !== undefined && /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(lang)
      ? ` lang="${escapeHtml(lang)}"`
      : "";
  const image =
    picture === undefined ? "" : `<img src="${escapeHtml(picture)}" alt="">`;
  return (
    `<!doctype html><html${language}><head><meta charset="utf-8">` +
    // Both schemes, so the poster's document takes the device's, as the
    // site's own frame does where the site follows the device: a frame whose
    // document's scheme differs from its element's is painted with an opaque
    // backdrop, which would cover the site's colour behind the poster.
    `<meta name="color-scheme" content="light dark">` +
    `<meta name="referrer" content="strict-origin-when-cross-origin">` +
    `<style>${POSTER_STYLES}</style></head><body>` +
    `<a href="${escapeHtml(player)}" aria-label="${escapeHtml(`Play: ${title}`)}">` +
    image +
    `<span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>` +
    `<span class="words" aria-hidden="true">${escapeHtml(title)}` +
    `<span class="provider">${escapeHtml(provider)}</span></span>` +
    `</a></body></html>`
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
      // What shows through a poster, which paints nothing of its own behind
      // its words: the site's surface colour, so a poster without a picture
      // is drawn in the site's colours and follows its dark values. A player
      // covers it.
      backgroundColor: { $token: "color.surface" },
      // An iframe's default inset border, which a player hides and a poster
      // would not.
      borderStyle: "none",
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const embed: BlockDefinition<EmbedProps, PageContext> = defineBlock({
  name: "core/embed",
  version: 1,
  // What an author reads, in the Add panel and the block card: one plain line.
  // What the block does, for whoever maintains it: Third-party content in a
  // sandboxed iframe, with an accessible name and a referrer policy that does
  // not leak the page's path.
  description: "A video, map or page from another site.",
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
    src: { label: "Link", role: "content", type: "url" },
    title: { label: "Screen reader label", role: "content", type: "text" },
    // When a known provider's player loads. The editor offers it only for a
    // link a provider owns: any other link is a plain frame, loaded with the
    // page.
    load: {
      label: "Load",
      role: "content",
      type: "select",
      options: [...EMBED_LOADS],
      optionLabels: { click: "When played", page: "Right away" },
    },
    // Offered by the editor only for a provider with a privacy-enhanced player.
    privacy: { label: "Privacy mode", role: "content", type: "checkbox" },
    poster: {
      label: "Poster",
      role: "content",
      type: "media",
      accept: "image/*",
    },
    // A permission the frame is given: an HTML-level detail.
    allowFullscreen: {
      label: "Allow full screen",
      type: "checkbox",
      group: "advanced",
    },
  },
  // A new Embed loads its player when played, in privacy mode. Stored on the
  // block when it is placed, so an Embed placed before these choices existed,
  // which stores neither, keeps loading with the page.
  defaultProps: {
    title: "",
    allowFullscreen: true,
    load: "click",
    privacy: true,
  },
  // Nothing: a block is placed with its example's props, so an example
  // address would be stored on every new Embed and loaded on the canvas, and
  // an example label would name every new Embed's frame instead of what its
  // link turns out to be. A new Embed starts empty, and the editor asks for a
  // link.
  example: { props: {} },
  baseStyles: EMBED_BASE_STYLES,
  supports: {
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  // An `<iframe>` is interactive content.
  contentModel: () => ({ is: ["flow", "interactive"] }),
  render: renderEmbed,
  // No `rendersNothing`. An Embed with no link draws nothing on a page a
  // visitor is served, but on the canvas it draws the box the editor's
  // "paste a link" field sits on, in the block's own classes; declared here,
  // the stylesheet would hold back the very rules that size that box. So an
  // empty Embed draws nothing at render time instead, as an Image does.
});
