import { describe, expect, it } from "vitest";

import {
  detectEmbed,
  EMBED_PLAYER_ORIGINS,
  isPlayerOf,
  type EmbedMatch,
} from "./embed-providers";

/** The match for a link the test expects to be recognised. */
function matched(link: string): EmbedMatch {
  const match = detectEmbed(link);
  if (match === undefined) throw new Error(`not recognised: ${link}`);
  return match;
}

const PLAIN = { privacy: false, autoplay: false } as const;
const PRIVATE = { privacy: true, autoplay: false } as const;

describe("detectEmbed: YouTube", () => {
  it.each([
    ["a watch page", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a watch page with more parameters", "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&list=PL1"],
    ["the mobile site", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a share link", "https://youtu.be/dQw4w9WgXcQ?si=abc123"],
    ["a player address", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["a no-cookie player address", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["a live stream", "https://www.youtube.com/live/dQw4w9WgXcQ"],
    ["a link with spaces around it", "  https://youtu.be/dQw4w9WgXcQ \n"],
  ])("recognises %s, landscape", (_label, link) => {
    const match = matched(link);
    expect(match.provider).toBe("youtube");
    expect(match.kind).toBe("YouTube video");
    expect(match.shape).toEqual({ aspectRatio: "16 / 9" });
    expect(match.playerAddress(PLAIN)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
  });

  it("gives a Short the portrait shape", () => {
    const match = matched("https://www.youtube.com/shorts/aqz-KE-bpKQ");
    expect(match.shape).toEqual({ aspectRatio: "9 / 16" });
    expect(match.playerAddress(PLAIN)).toBe(
      "https://www.youtube.com/embed/aqz-KE-bpKQ"
    );
  });

  it("uses the no-cookie player in privacy mode, and the normal one without", () => {
    const match = matched("https://youtu.be/dQw4w9WgXcQ");
    expect(match.privacyMode).toBe(true);
    expect(match.playerAddress(PRIVATE)).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
    expect(match.playerAddress(PLAIN)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
    // A no-cookie link pasted with privacy off still gets the normal player:
    // the choice is the block's, not the link's.
    expect(
      matched("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ").playerAddress(PLAIN)
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("asks the player to start when played, and keeps a start time", () => {
    expect(
      matched("https://youtu.be/dQw4w9WgXcQ?t=1m30s").playerAddress({
        privacy: true,
        autoplay: true,
      })
    ).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90&autoplay=1"
    );
    expect(
      matched("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45").playerAddress(PLAIN)
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=45");
    // A start time it cannot read is left out, not passed through.
    expect(
      matched("https://youtu.be/dQw4w9WgXcQ?t=soon").playerAddress(PLAIN)
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("names the video's pictures on YouTube's picture host only", () => {
    const { thumbnail } = matched("https://youtu.be/dQw4w9WgXcQ");
    expect(thumbnail).toEqual({
      kind: "direct",
      key: "youtube-dQw4w9WgXcQ",
      addresses: [
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      ],
    });
  });
});

describe("detectEmbed: Vimeo", () => {
  it.each([
    ["a video page", "https://vimeo.com/76979871", undefined],
    ["a video in a channel", "https://vimeo.com/channels/staffpicks/76979871", undefined],
    ["an unlisted video", "https://vimeo.com/76979871/8272103f6e", "8272103f6e"],
    ["a player address", "https://player.vimeo.com/video/76979871", undefined],
    ["an unlisted player address", "https://player.vimeo.com/video/76979871?h=8272103f6e", "8272103f6e"],
  ])("recognises %s", (_label, link, hash) => {
    const match = matched(link);
    expect(match.provider).toBe("vimeo");
    expect(match.kind).toBe("Vimeo video");
    expect(match.shape).toEqual({ aspectRatio: "16 / 9" });
    const query = hash === undefined ? "" : `?h=${hash}`;
    expect(match.playerAddress(PLAIN)).toBe(
      `https://player.vimeo.com/video/76979871${query}`
    );
  });

  it("asks for do-not-track in privacy mode, and not without", () => {
    const match = matched("https://vimeo.com/76979871");
    expect(match.privacyMode).toBe(true);
    expect(match.playerAddress(PRIVATE)).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1"
    );
    expect(match.playerAddress({ privacy: true, autoplay: true })).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&autoplay=1"
    );
    expect(match.playerAddress(PLAIN)).not.toContain("dnt");
  });

  it("finds the picture through Vimeo's oEmbed, on Vimeo's picture host", () => {
    expect(matched("https://vimeo.com/76979871/8272103f6e").thumbnail).toEqual({
      kind: "oembed",
      key: "vimeo-76979871",
      address:
        "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2F8272103f6e",
      pictureHost: "i.vimeocdn.com",
    });
  });
});

describe("detectEmbed: Spotify", () => {
  it.each([
    ["a track", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "track", "152px"],
    ["a track with a language prefix", "https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x", "track", "152px"],
    ["an album", "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3", "album", "352px"],
    ["a playlist from embed code", "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M", "playlist", "352px"],
    ["an episode", "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ", "episode", "152px"],
  ])("recognises %s, at Spotify's own height", (_label, link, type, height) => {
    const match = matched(link);
    expect(match.provider).toBe("spotify");
    expect(match.shape).toEqual({ height });
    expect(match.playerAddress(PLAIN)).toMatch(
      new RegExp(`^https://open\\.spotify\\.com/embed/${type}/[A-Za-z0-9]{22}$`)
    );
  });

  it("has no privacy mode and no picture to copy", () => {
    const match = matched("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(match.privacyMode).toBe(false);
    expect(match.thumbnail).toBeUndefined();
    // Asking for privacy changes nothing where there is none.
    expect(match.playerAddress(PRIVATE)).toBe(match.playerAddress(PLAIN));
  });
});

describe("detectEmbed: Google Maps", () => {
  const link =
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.2!2d-73.98!3d40.75!2m3!1f0!2f0!3f0";

  it("recognises the Embed a map link, at 4:3", () => {
    const match = matched(link);
    expect(match.provider).toBe("google-maps");
    expect(match.kind).toBe("Google map");
    expect(match.shape).toEqual({ aspectRatio: "4 / 3" });
    expect(match.privacyMode).toBe(false);
    expect(match.playerAddress(PLAIN)).toBe(
      `https://www.google.com/maps/embed?pb=${encodeURIComponent(
        "!1m18!1m12!1m3!1d3022.2!2d-73.98!3d40.75!2m3!1f0!2f0!3f0"
      )}`
    );
  });

  it("does not take a link to a place, which Google does not let a site frame", () => {
    expect(detectEmbed("https://www.google.com/maps/place/Times+Square")).toBeUndefined();
    expect(detectEmbed("https://www.google.com/maps/embed")).toBeUndefined();
    // A description carrying characters Maps never writes is not a map's.
    expect(
      detectEmbed('https://www.google.com/maps/embed?pb=!1m2"><script>')
    ).toBeUndefined();
  });
});

describe("detectEmbed: links no provider owns", () => {
  it.each([
    ["an ordinary page", "https://example.com/page"],
    ["plain http", "http://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a look-alike host", "https://youtube.com.example.net/watch?v=dQw4w9WgXcQ"],
    ["a sub-domain that is not the provider's", "https://evil.youtu.be.example/dQw4w9WgXcQ"],
    ["a video id of the wrong shape", "https://youtu.be/short"],
    ["an id carrying markup", 'https://www.youtube.com/watch?v=abc"><script'],
    ["a YouTube page with no video", "https://www.youtube.com/@channel"],
    ["a Vimeo profile", "https://vimeo.com/staff"],
    ["a Spotify page with no player", "https://open.spotify.com/user/abc"],
    ["a link with credentials", "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a relative link", "/watch?v=dQw4w9WgXcQ"],
    ["something not text", 42],
  ])("leaves %s to the plain frame", (_label, link) => {
    expect(detectEmbed(link)).toBeUndefined();
  });
});

describe("player addresses", () => {
  const links = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
    "https://www.youtube.com/shorts/aqz-KE-bpKQ",
    "https://vimeo.com/76979871/8272103f6e",
    "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    "https://www.google.com/maps/embed?pb=!1m18!1m12",
  ];

  it("are always on the provider's own player origin, whatever is chosen", () => {
    // The renderer grants a frame its origin only on this answer, so every
    // address the table can build must give it.
    for (const link of links) {
      const match = matched(link);
      for (const privacy of [true, false]) {
        for (const autoplay of [true, false]) {
          const address = match.playerAddress({ privacy, autoplay });
          expect(isPlayerOf(match.provider, address), address).toBe(true);
        }
      }
    }
  });

  it("are not another provider's", () => {
    expect(
      isPlayerOf("vimeo", "https://www.youtube.com/embed/dQw4w9WgXcQ")
    ).toBe(false);
    expect(isPlayerOf("youtube", "not a url")).toBe(false);
    expect(Object.keys(EMBED_PLAYER_ORIGINS).sort()).toEqual(
      ["google-maps", "spotify", "vimeo", "youtube"]
    );
  });
});
