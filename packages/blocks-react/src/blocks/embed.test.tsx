// @vitest-environment jsdom

/**
 * The Embed with a link a provider owns: the poster that loads nothing from
 * the provider, the player it opens, and what a new Embed starts as. The
 * plain frame's sandbox and trust rules are in `primitives.test.tsx`.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlockHostPolicy,
  BlockRenderArgs,
  PageContext,
  ResolvedMedia,
} from "../context";

import {
  embed,
  EMBED_EMPTY_ATTRIBUTE,
  posterDocument,
  renderEmbed,
  type EmbedProps,
} from "./embed";

const NODE: BlockNode = { id: "e1", type: "core/embed", version: 1, props: {} };

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  };
}

function args(
  props: EmbedProps,
  ctx: PageContext = context(),
  hostPolicy?: BlockHostPolicy
): BlockRenderArgs<EmbedProps> {
  return {
    props,
    node: NODE,
    className: "nx-e1",
    partClass: () => "",
    ctx,
    renderSlot: () => null,
    ...(hostPolicy === undefined ? {} : { hostPolicy }),
  };
}

async function html(props: EmbedProps, ...rest: [PageContext?, BlockHostPolicy?]): Promise<string> {
  const element: ReactElement | null = await renderEmbed(args(props, ...rest));
  return element === null ? "" : renderToStaticMarkup(element);
}

/** The frame's one element, read back as the browser would. */
function frameOf(markup: string): HTMLIFrameElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const frame = holder.querySelector("iframe");
  if (frame === null) throw new Error(`no frame in: ${markup}`);
  return frame;
}

/** The poster document a frame carries, parsed. */
function posterOf(frame: HTMLIFrameElement): Document {
  const doc = frame.getAttribute("srcdoc");
  if (doc === null) throw new Error("no poster");
  return new DOMParser().parseFromString(doc, "text/html");
}

describe("a new Embed", () => {
  it("stores no example address, and starts loading when played, in privacy mode", () => {
    // A block is placed with its defaults overlaid by its example: what an
    // author gets on adding one.
    const placed = { ...embed.defaultProps, ...embed.example.props };
    expect(placed).not.toHaveProperty("src");
    // No label of the example's: the frame is named for what its link is.
    expect(placed).toMatchObject({ title: "", load: "click", privacy: true });
  });

  it("draws the box for the editor's link field on the canvas, and nothing for a visitor", async () => {
    const canvas = await html({}, context({ diagnostics: true }));
    expect(canvas).toBe(`<div class="nx-e1" ${EMBED_EMPTY_ATTRIBUTE}=""></div>`);
    expect(await html({})).toBe("");
  });
});

describe("a known provider, when played", () => {
  it("draws a poster and asks nothing of the provider", async () => {
    const frame = frameOf(await html({ src: WATCH, title: "Our launch", load: "click", privacy: true }));
    // No address on the frame itself: the only thing the page loads is the
    // poster, which is the site's own document.
    expect(frame.hasAttribute("src")).toBe(false);
    const poster = posterOf(frame);
    expect(poster.querySelectorAll("script")).toHaveLength(0);
    expect(poster.querySelectorAll("img")).toHaveLength(0);
    const play = poster.querySelector("a");
    expect(play?.getAttribute("aria-label")).toBe("Play: Our launch");
    // The play link takes the frame to the no-cookie player, asked to start.
    expect(play?.getAttribute("href")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
    );
    expect(play?.hasAttribute("target")).toBe(false);
    expect(poster.body.textContent).toContain("Our launch");
    expect(poster.body.textContent).toContain("YouTube");
    // Everything else in the poster is the site's own: no other address in it.
    const addresses = [...poster.querySelectorAll("[src],[href]")].flatMap(each =>
      [each.getAttribute("src"), each.getAttribute("href")].filter(Boolean)
    );
    expect(addresses).toEqual([
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    ]);
  });

  it("uses the normal player with privacy mode off", async () => {
    const poster = posterOf(frameOf(await html({ src: WATCH, load: "click", privacy: false })));
    expect(poster.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"
    );
  });

  it("draws the poster picture from the media library, by this site's address", async () => {
    const media: ResolvedMedia = { url: "https://site.example/media/launch.jpg" };
    const asked: string[] = [];
    const ctx = context({
      resolveMedia: id => {
        asked.push(id);
        return Promise.resolve(media);
      },
    });
    const poster = posterOf(frameOf(await html({ src: WATCH, load: "click", poster: "m7" }, ctx)));
    expect(asked).toEqual(["m7"]);
    expect(poster.querySelector("img")?.getAttribute("src")).toBe(media.url);
    expect(poster.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("draws a poster bound to an address from that address, without asking the library", async () => {
    const asked: string[] = [];
    const ctx = context({
      resolveMedia: id => {
        asked.push(id);
        return Promise.resolve(null);
      },
    });
    const element = await renderEmbed({
      ...args({ src: WATCH, load: "click", poster: "https://site.example/covers/launch.jpg" }, ctx),
      bound: { poster: { kind: "image", holds: "address", from: "value" } },
    } as BlockRenderArgs<EmbedProps>);
    const poster = posterOf(frameOf(element === null ? "" : renderToStaticMarkup(element)));
    expect(poster.querySelector("img")?.getAttribute("src")).toBe(
      "https://site.example/covers/launch.jpg"
    );
    expect(asked).toEqual([]);
  });

  it("draws the binding's fallback where the bound value draws nothing", async () => {
    const element = await renderEmbed({
      ...args({ src: WATCH, load: "click", poster: "javascript:alert(1)" }),
      bound: {
        poster: {
          kind: "image",
          holds: "address",
          from: "value",
          fallback: { holds: "address", value: "https://site.example/fallback.jpg" },
        },
      },
    } as BlockRenderArgs<EmbedProps>);
    const poster = posterOf(frameOf(element === null ? "" : renderToStaticMarkup(element)));
    expect(poster.querySelector("img")?.getAttribute("src")).toBe(
      "https://site.example/fallback.jpg"
    );
  });

  it("draws the plain poster for a missing picture or one the site does not load", async () => {
    const missing = context({ resolveMedia: () => Promise.resolve(null) });
    expect(posterOf(frameOf(await html({ src: WATCH, load: "click", poster: "gone" }, missing))).querySelector("img")).toBeNull();

    const failing = context({ resolveMedia: () => Promise.reject(new Error("down")) });
    expect(posterOf(frameOf(await html({ src: WATCH, load: "click", poster: "m7" }, failing))).querySelector("img")).toBeNull();

    const elsewhere = context({
      resolveMedia: () => Promise.resolve({ url: "https://cdn.other.example/a.jpg" }),
    });
    const policy: BlockHostPolicy = {
      remotePatterns: [{ protocol: "https", hostname: "site.example" }],
    };
    expect(
      posterOf(frameOf(await html({ src: WATCH, load: "click", poster: "m7" }, elsewhere, policy))).querySelector("img")
    ).toBeNull();
  });

  it("grants the player its origin, which the poster's frame becomes", async () => {
    const frame = frameOf(await html({ src: WATCH, load: "click" }));
    expect(frame.getAttribute("sandbox")?.split(" ")).toContain("allow-same-origin");
    expect(frame.getAttribute("allow")).toContain("autoplay");
  });
});

describe("a known provider, right away", () => {
  it("loads the player lazily with the page", async () => {
    const frame = frameOf(await html({ src: WATCH, load: "page", privacy: true }));
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
  });

  it("is how an Embed stored before the choice reads, with privacy on", async () => {
    // Stored with neither `load` nor `privacy`: it loaded with the page then,
    // and still does, now from the no-cookie player.
    const frame = frameOf(await html({ src: WATCH }));
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
  });

  it("loads a known provider's player though the site's fetch list does not name it", async () => {
    const policy: BlockHostPolicy = {
      remotePatterns: [{ protocol: "https", hostname: "site.example" }],
    };
    expect(frameOf(await html({ src: WATCH, load: "page" }, context(), policy)).getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
    // While a link nobody owns stays refused by it.
    expect(await html({ src: "https://example.com/page" }, context(), policy)).toBe("");
  });
});

describe("the frame's title", () => {
  it("says what the link is when the author gives no label", async () => {
    expect(frameOf(await html({ src: WATCH, title: "" })).getAttribute("title")).toBe("YouTube video");
    expect(
      frameOf(await html({ src: "https://vimeo.com/76979871", title: "  " })).getAttribute("title")
    ).toBe("Vimeo video");
  });

  it("never draws an empty title, which a new Embed's blank label would be", async () => {
    expect(
      frameOf(await html({ src: "https://example.com/page", title: "" })).getAttribute("title")
    ).toBe("Embedded content");
  });

  it("keeps the author's label", async () => {
    expect(frameOf(await html({ src: WATCH, title: "Our launch" })).getAttribute("title")).toBe("Our launch");
  });
});

describe("a link no provider owns", () => {
  it("stays a plain sandboxed frame, loaded as typed", async () => {
    const frame = frameOf(await html({ src: "https://example.com/page", load: "click", privacy: true }));
    expect(frame.getAttribute("src")).toBe("https://example.com/page");
    expect(frame.getAttribute("sandbox")?.split(" ")).not.toContain("allow-same-origin");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(frame.getAttribute("title")).toBe("Embedded content");
  });

  it("gets no grant on a host made to look like a provider's", async () => {
    const frame = frameOf(await html({ src: "https://www.youtube.com.example.net/embed/dQw4w9WgXcQ" }));
    expect(frame.getAttribute("sandbox")?.split(" ")).not.toContain("allow-same-origin");
  });
});

describe("posterDocument", () => {
  it("escapes every value it writes, so none becomes markup", () => {
    const hostile = `"><script>alert(1)</script><img src=x onerror=alert(2)>&'`;
    const doc = posterDocument({
      title: hostile,
      provider: hostile,
      player: `https://www.youtube.com/embed/x?a="><script>alert(3)</script>`,
      picture: `https://site.example/a.jpg" onerror="alert(4)`,
      lang: `en"><script>`,
    });
    const parsed = new DOMParser().parseFromString(doc, "text/html");
    expect(parsed.querySelectorAll("script")).toHaveLength(0);
    // The only element with a handler-like attribute would be an injected one.
    const attributes = [...parsed.querySelectorAll("*")].flatMap(each =>
      [...each.attributes].map(attribute => attribute.name)
    );
    expect(attributes.filter(name => name.startsWith("on"))).toEqual([]);
    expect(parsed.querySelectorAll("img")).toHaveLength(1);
    expect(parsed.querySelector("img")?.getAttribute("src")).toBe(
      `https://site.example/a.jpg" onerror="alert(4)`
    );
    expect(parsed.querySelector("a")?.getAttribute("aria-label")).toBe(`Play: ${hostile}`);
    // A language that is not one is left out rather than written.
    expect(parsed.documentElement.hasAttribute("lang")).toBe(false);
  });

  it("holds no script and keeps the play button at least 44px", () => {
    const doc = posterDocument({
      title: "Our launch",
      provider: "YouTube",
      player: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
      lang: "en-GB",
    });
    expect(doc.toLowerCase()).not.toContain("<script");
    expect(doc).toContain("min-width:44px;min-height:44px");
    // Its scheme follows the device's, as the site's frame does, so the
    // browser draws no opaque backdrop over the site's colour behind it.
    expect(
      new DOMParser()
        .parseFromString(doc, "text/html")
        .querySelector('meta[name="color-scheme"]')
        ?.getAttribute("content")
    ).toBe("light dark");
    expect(new DOMParser().parseFromString(doc, "text/html").documentElement.lang).toBe("en-GB");
  });
});
