/**
 * The providers an Embed knows by name, and what a pasted link from each one
 * becomes.
 *
 * A fixed table rather than a lookup: recognising a link here costs no
 * request, so the editor can say what it found as the author pastes, the
 * renderer works the player address out at every render from the link the
 * author typed, and no server ever fetches an address an author chose. A new
 * provider is a new entry.
 *
 * Shared by the renderer, the editor and the thumbnail copy, so "is this a
 * YouTube link, and which video" has one answer for all three.
 *
 * Every address this module builds is put together from parts it parsed and
 * checked (an id of the provider's own alphabet, a fixed host), never from the
 * pasted text itself, so a player address can only ever point at the
 * provider's own player.
 *
 * @module blocks/embed-providers
 */

/** The providers an Embed recognises. */
export type EmbedProviderId = "youtube" | "vimeo" | "spotify" | "google-maps";

/**
 * The shape a provider's player takes, written to the block as an ordinary
 * style value when the link is pasted: a proportion for a video, a fixed
 * height for a player that has one.
 */
export type EmbedShape =
  | { readonly aspectRatio: string }
  | { readonly height: string };

/** What a recognised link is: the provider, and what its player is built from. */
export interface EmbedMatch {
  readonly provider: EmbedProviderId;
  /** The provider's name, as a visitor reads it on the poster: "YouTube". */
  readonly name: string;
  /**
   * What is embedded, in words a screen reader announces when the author
   * gives no label of their own: "YouTube video".
   */
  readonly kind: string;
  /** The shape to give the block for this link. */
  readonly shape: EmbedShape;
  /**
   * Whether the provider has a player that sets no tracking cookies until
   * played (YouTube's no-cookie player, Vimeo's do-not-track), so "Privacy
   * mode" means something for it.
   */
  readonly privacyMode: boolean;
  /**
   * Where the provider keeps a picture of the video, which "Use the video's
   * thumbnail" copies into the media library; absent for a provider with
   * none to copy.
   */
  readonly thumbnail?: ThumbnailSource;
  /** The player's address for these choices. */
  playerAddress(options: PlayerOptions): string;
}

/**
 * Where a video's picture is fetched from, by the editor's thumbnail copy and
 * never by a visitor's page.
 *
 * - `direct`: the picture's own addresses, best first; the next is tried
 *   when one is missing (YouTube has no full-size picture for some videos).
 * - `oembed`: the provider's oEmbed answer names the picture, which must then
 *   be on `pictureHost`.
 *
 * `key` names the video for good, so a second copy of the same video's
 * picture finds the first rather than making another.
 */
export type ThumbnailSource =
  | {
      readonly kind: "direct";
      readonly key: string;
      readonly addresses: readonly string[];
    }
  | {
      readonly kind: "oembed";
      readonly key: string;
      readonly address: string;
      readonly pictureHost: string;
    };

/** How the player is asked for. */
export interface PlayerOptions {
  /** Use the provider's privacy-enhanced player, where it has one. */
  readonly privacy: boolean;
  /**
   * Start playing as soon as it loads: the visitor has just pressed play on
   * the poster, so the press they made is the one that plays it.
   */
  readonly autoplay: boolean;
}

/** The origins a built-in provider's player is served from. */
export const EMBED_PLAYER_ORIGINS: Readonly<
  Record<EmbedProviderId, readonly string[]>
> = {
  youtube: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
  vimeo: ["https://player.vimeo.com"],
  spotify: ["https://open.spotify.com"],
  "google-maps": ["https://www.google.com"],
};

/** A YouTube video id: eleven characters of its URL-safe alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** A Vimeo video id, and the private hash an unlisted video carries. */
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;

/** A Spotify id: 22 base-62 characters. */
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/**
 * The Spotify things that have a player, and the height Spotify's own embed
 * code gives each: the compact player for one track or episode, the list
 * player for everything that holds several.
 */
const SPOTIFY_HEIGHTS: Readonly<Record<string, string>> = {
  track: "152px",
  episode: "152px",
  album: "352px",
  playlist: "352px",
  show: "352px",
  artist: "352px",
};

/** The 16:9 shape of a landscape video. */
const LANDSCAPE: EmbedShape = { aspectRatio: "16 / 9" };

/** The 9:16 shape of a YouTube Short. */
const PORTRAIT: EmbedShape = { aspectRatio: "9 / 16" };

/**
 * The 4:3 shape of Google Maps' "Embed a map" code, which hands out a
 * 600 by 450 frame.
 */
const MAP_SHAPE: EmbedShape = { aspectRatio: "4 / 3" };

/** The hosts each provider's links arrive on, by the provider. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const GOOGLE_MAPS_HOSTS = new Set(["www.google.com", "google.com"]);

/**
 * Which provider a pasted link is from, and what to build its player from;
 * `undefined` for a link no built-in provider owns.
 *
 * Only `https` links are recognised (a provider's player is only ever served
 * over it), with the host compared exactly, so a look-alike host such as
 * `youtube.com.example.net` is nobody's.
 */
export function detectEmbed(link: unknown): EmbedMatch | undefined {
  if (typeof link !== "string") return undefined;
  const parsed = parseLink(link.trim());
  if (parsed === undefined) return undefined;
  const host = parsed.hostname.toLowerCase();
  if (host === "youtu.be" || YOUTUBE_HOSTS.has(host)) return youtube(parsed);
  if (VIMEO_HOSTS.has(host)) return vimeo(parsed);
  if (host === "open.spotify.com") return spotify(parsed);
  if (GOOGLE_MAPS_HOSTS.has(host)) return googleMaps(parsed);
  return undefined;
}

/** The link as an `https` URL, or nothing. */
function parseLink(link: string): URL | undefined {
  if (link === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return undefined;
  }
  // A link carrying a user name or password is not a provider's link, and
  // would only travel to the provider if it were passed along.
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return undefined;
  }
  return parsed;
}

/** The path's segments, without empty ones. */
function segmentsOf(parsed: URL): string[] {
  return parsed.pathname.split("/").filter(segment => segment !== "");
}

/**
 * A YouTube link: a watch page, a `youtu.be` share, a Short, a live stream,
 * or a player address someone copied from embed code.
 */
function youtube(parsed: URL): EmbedMatch | undefined {
  const host = parsed.hostname.toLowerCase();
  const [first, second] = segmentsOf(parsed);
  let id: string | null | undefined;
  let short = false;
  if (host === "youtu.be") id = first;
  else if (first === "watch") id = parsed.searchParams.get("v");
  else if (first === "shorts") {
    id = second;
    short = true;
  } else if (first === "embed" || first === "live") id = second;
  if (typeof id !== "string" || !YOUTUBE_ID.test(id)) return undefined;
  const videoId = id;
  const start = startSeconds(
    parsed.searchParams.get("t") ?? parsed.searchParams.get("start")
  );
  // The player's own settings a link already carries (an embed code's
  // `controls=0`, `loop=1&playlist=…`), kept so a stored player address
  // plays as it did; the start, autoplay and privacy are the block's.
  const options = keptOptions(parsed, YOUTUBE_OPTIONS);
  return {
    provider: "youtube",
    name: "YouTube",
    kind: "YouTube video",
    shape: short ? PORTRAIT : LANDSCAPE,
    privacyMode: true,
    thumbnail: {
      kind: "direct",
      key: `youtube-${videoId}`,
      addresses: [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      ],
    },
    playerAddress: ({ privacy, autoplay }) => {
      const origin = privacy
        ? "https://www.youtube-nocookie.com"
        : "https://www.youtube.com";
      return withQuery(`${origin}/embed/${videoId}`, {
        ...options,
        ...(start === undefined ? {} : { start: String(start) }),
        ...(autoplay ? { autoplay: "1" } : {}),
      });
    },
  };
}

/**
 * A start time as YouTube links write it, in whole seconds: `90`, `90s` or
 * `1h2m3s`. Anything else starts at the beginning.
 */
function startSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (match === null || value === "") return undefined;
  const [, hours, minutes, seconds] = match;
  const total =
    Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return total > 0 ? total : undefined;
}

/**
 * A Vimeo link: a video page (`vimeo.com/123`, an unlisted
 * `vimeo.com/123/abcdef`, one inside a channel or a group), or a player
 * address (`player.vimeo.com/video/123?h=abcdef`).
 */
function vimeo(parsed: URL): EmbedMatch | undefined {
  const segments = segmentsOf(parsed);
  let id: string | undefined;
  let hash: string | undefined;
  if (parsed.hostname.toLowerCase() === "player.vimeo.com") {
    if (segments[0] !== "video") return undefined;
    id = segments[1];
    hash = parsed.searchParams.get("h") ?? undefined;
  } else {
    // The video id is the first all-digit segment: `channels/<name>/<id>`
    // and `groups/<name>/videos/<id>` both end there, and a page with no
    // such segment (a profile, a search) holds no video.
    const at = segments.findIndex(segment => VIMEO_ID.test(segment));
    if (at === -1) return undefined;
    id = segments[at];
    hash = segments[at + 1] ?? parsed.searchParams.get("h") ?? undefined;
  }
  if (id === undefined || !VIMEO_ID.test(id)) return undefined;
  const videoId = id;
  const privateHash =
    hash !== undefined && VIMEO_HASH.test(hash) ? hash : undefined;
  // The player's own settings the link carries, as for YouTube; privacy and
  // autoplay are the block's.
  const options = keptOptions(parsed, VIMEO_OPTIONS);
  return {
    provider: "vimeo",
    name: "Vimeo",
    kind: "Vimeo video",
    shape: LANDSCAPE,
    privacyMode: true,
    thumbnail: {
      kind: "oembed",
      key: `vimeo-${videoId}`,
      address: withQuery("https://vimeo.com/api/oembed.json", {
        url:
          privateHash === undefined
            ? `https://vimeo.com/${videoId}`
            : `https://vimeo.com/${videoId}/${privateHash}`,
      }),
      pictureHost: "i.vimeocdn.com",
    },
    playerAddress: ({ privacy, autoplay }) =>
      withQuery(`https://player.vimeo.com/video/${videoId}`, {
        ...options,
        ...(privateHash === undefined ? {} : { h: privateHash }),
        ...(privacy ? { dnt: "1" } : {}),
        ...(autoplay ? { autoplay: "1" } : {}),
      }),
  };
}

/**
 * A Spotify link to a track, an album, a playlist, an episode, a show or an
 * artist, as shared (`open.spotify.com/track/<id>`, with or without a
 * language prefix such as `intl-de`) or from embed code
 * (`open.spotify.com/embed/track/<id>`).
 */
function spotify(parsed: URL): EmbedMatch | undefined {
  const segments = segmentsOf(parsed);
  if (segments[0]?.startsWith("intl-") === true) segments.shift();
  if (segments[0] === "embed") segments.shift();
  const [type, id] = segments;
  if (type === undefined || id === undefined) return undefined;
  const height = SPOTIFY_HEIGHTS[type];
  if (height === undefined || !SPOTIFY_ID.test(id)) return undefined;
  return {
    provider: "spotify",
    name: "Spotify",
    kind: type === "episode" || type === "show" ? "Spotify podcast" : "Spotify player",
    shape: { height },
    privacyMode: false,
    playerAddress: () => `https://open.spotify.com/embed/${type}/${id}`,
  };
}

/**
 * Google Maps' "Embed a map" link: `https://www.google.com/maps/embed?pb=…`,
 * the address in the embed code Maps hands out. A link to a place on Maps
 * itself is a page, not a player, and Google does not let it be framed, so
 * it is not recognised.
 */
function googleMaps(parsed: URL): EmbedMatch | undefined {
  const segments = segmentsOf(parsed);
  if (segments[0] !== "maps" || segments[1] !== "embed") return undefined;
  if (segments.length !== 2) return undefined;
  // The map's description as the link writes it, percent-escapes kept:
  // `!`-separated fields whose place names and ids carry escaped spaces,
  // colons and any script. Read from the raw query, because the decoded
  // value is not the one Maps' player takes back. Only these characters,
  // with well-formed escapes, so nothing in it can end the address or the
  // attribute it is written into.
  const pb = rawQueryValue(parsed.search, "pb");
  if (
    pb === undefined ||
    !/^(?:[A-Za-z0-9!._~*:,+-]|%[0-9A-Fa-f]{2})+$/.test(pb)
  ) {
    return undefined;
  }
  return {
    provider: "google-maps",
    name: "Google Maps",
    kind: "Google map",
    shape: MAP_SHAPE,
    privacyMode: false,
    playerAddress: () => `https://www.google.com/maps/embed?pb=${pb}`,
  };
}

/**
 * The player settings each provider documents for its embed address, which a
 * pasted player link may carry and the block keeps. Anything else in a link
 * (a watch page's `v`, `list`, `si`, tracking parameters) is not a setting of
 * the player and is left out.
 */
const YOUTUBE_OPTIONS: ReadonlySet<string> = new Set([
  "cc_lang_pref",
  "cc_load_policy",
  "color",
  "controls",
  "disablekb",
  "end",
  "fs",
  "hl",
  "iv_load_policy",
  "loop",
  "mute",
  "playlist",
  "playsinline",
  "rel",
]);
const VIMEO_OPTIONS: ReadonlySet<string> = new Set([
  "autopause",
  "background",
  "byline",
  "color",
  "controls",
  "loop",
  "muted",
  "playsinline",
  "portrait",
  "quality",
  "speed",
  "texttrack",
  "title",
  "transparent",
]);

/**
 * A value a kept setting may hold: short, and made of the characters the
 * providers' settings use (ids, numbers, colours, language codes, lists), so
 * nothing in it can carry anything else into the player's address.
 */
const OPTION_VALUE = /^[A-Za-z0-9_,.-]{1,64}$/;

/** The link's settings named in `allowed`, each with a value it may hold. */
function keptOptions(
  parsed: URL,
  allowed: ReadonlySet<string>
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of parsed.searchParams) {
    if (allowed.has(name) && OPTION_VALUE.test(value)) kept[name] = value;
  }
  return kept;
}

/** A query parameter's value exactly as the address writes it, undecoded. */
function rawQueryValue(search: string, name: string): string | undefined {
  for (const part of search.replace(/^\?/, "").split("&")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at) === name) return part.slice(at + 1);
  }
  return undefined;
}

/** An address with these query parameters, encoded. */
function withQuery(base: string, query: Readonly<Record<string, string>>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return base;
  return `${base}?${new URLSearchParams(entries).toString()}`;
}

/** Whether `address` is served from one of the provider's player origins. */
export function isPlayerOf(
  provider: EmbedProviderId,
  address: string
): boolean {
  let origin: string;
  try {
    origin = new URL(address).origin;
  } catch {
    return false;
  }
  return EMBED_PLAYER_ORIGINS[provider].includes(origin);
}
