/**
 * The thumbnail copy: what it fetches, from where, what it stores, and when
 * it answers an earlier copy instead.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  copyEmbedThumbnail,
  embedThumbnailRoute,
  type EmbedThumbnailContext,
  type ThumbnailFetch,
} from "./route";

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VIMEO = "https://vimeo.com/76979871";

interface Stored {
  readonly id: string;
  readonly originalFilename: string;
  readonly url: string;
}

/** A media library holding `files`, recording uploads and how they ran. */
function library(files: Stored[] = []) {
  const uploads: { input: Record<string, unknown>; opts: unknown }[] = [];
  const media = {
    // Newest first, a page at a time, as the library answers a search.
    listMedia: vi.fn(
      (options: { search?: string; limit?: number; page?: number }) => {
        const matching = [...files]
          .reverse()
          .filter(file => file.originalFilename.includes(options.search ?? ""));
        const limit = options.limit ?? 24;
        const offset = ((options.page ?? 1) - 1) * limit;
        const data = matching.slice(offset, offset + limit);
        return Promise.resolve({
          data,
          pagination: {
            total: matching.length,
            limit,
            offset,
            hasMore: offset + data.length < matching.length,
          },
        });
      }
    ),
    upload: vi.fn((input: Record<string, unknown>, opts: unknown) => {
      uploads.push({ input, opts });
      const made: Stored = {
        id: `m${String(files.length + 1)}`,
        originalFilename: String(input.filename),
        url: `/media/m${String(files.length + 1)}`,
      };
      files.push(made);
      return Promise.resolve(made);
    }),
  };
  const ctx = {
    user: { id: "u1" },
    services: { media },
  } as unknown as EmbedThumbnailContext;
  return { ctx, media, uploads, files };
}

/** A fetch answering each address from `answers`, recording what it asked. */
function provider(answers: Record<string, () => Response>) {
  const asked: { address: string; init: RequestInit }[] = [];
  const fetchFrom: ThumbnailFetch = (address, init) => {
    asked.push({ address, init });
    const answer = answers[address];
    return Promise.resolve(answer === undefined ? new Response(null, { status: 404 }) : answer());
  };
  return { fetchFrom, asked };
}

const jpeg = (bytes = 4): Response =>
  new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } });

function request(body: unknown): Request {
  return new Request("https://site.example/api/plugins/page-builder/embed-thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("copyEmbedThumbnail", () => {
  it("fetches YouTube's largest picture from its picture host, and stores it as the caller", async () => {
    const { ctx, uploads } = library();
    const { fetchFrom, asked } = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg": () => jpeg(8),
    });
    const result = await copyEmbedThumbnail(request({ link: WATCH }), ctx, fetchFrom);
    expect(asked.map(each => each.address)).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    ]);
    // No redirect followed, no credentials sent, a time limit.
    expect(asked[0]?.init).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(asked[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.input).toMatchObject({
      filename: "youtube-dQw4w9WgXcQ-thumbnail.jpg",
      mimeType: "image/jpeg",
      size: 8,
    });
    expect(uploads[0]?.opts).toEqual({ as: "user", user: { id: "u1" } });
    expect(result).toEqual({
      id: "m1",
      url: "/media/m1",
      filename: "youtube-dQw4w9WgXcQ-thumbnail.jpg",
      reused: false,
    });
  });

  it("takes the smaller picture where a video has no large one", async () => {
    const { ctx } = library();
    const { fetchFrom, asked } = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg": () => jpeg(),
    });
    await copyEmbedThumbnail(request({ link: WATCH }), ctx, fetchFrom);
    expect(asked.map(each => each.address)).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });

  it("answers the earlier copy without fetching again", async () => {
    const { ctx, uploads } = library([
      { id: "m7", originalFilename: "youtube-dQw4w9WgXcQ-thumbnail.jpg", url: "/media/m7" },
    ]);
    const { fetchFrom, asked } = provider({});
    const result = await copyEmbedThumbnail(request({ link: "https://youtu.be/dQw4w9WgXcQ" }), ctx, fetchFrom);
    expect(asked).toEqual([]);
    expect(uploads).toEqual([]);
    expect(result).toMatchObject({ id: "m7", reused: true });
  });

  it("finds the earlier copy behind newer files that only mention its name", async () => {
    const files: Stored[] = [
      { id: "m1", originalFilename: "youtube-dQw4w9WgXcQ-thumbnail.jpg", url: "/media/m1" },
      ...Array.from({ length: 60 }, (_, at) => ({
        id: `n${String(at)}`,
        originalFilename: `notes on youtube-dQw4w9WgXcQ-thumbnail ${String(at)}.jpg`,
        url: `/media/n${String(at)}`,
      })),
    ];
    const { ctx, uploads } = library(files);
    const { fetchFrom, asked } = provider({});
    const result = await copyEmbedThumbnail(request({ link: WATCH }), ctx, fetchFrom);
    expect(result).toMatchObject({ id: "m1", reused: true });
    expect(asked).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("makes one copy for two requests for the same video at once", async () => {
    const { ctx, uploads } = library();
    let answer: (() => void) | undefined;
    const held = new Promise<void>(resolve => {
      answer = resolve;
    });
    const fetchFrom: ThumbnailFetch = async () => {
      await held;
      return jpeg();
    };
    const inFlight = new Map();
    const first = copyEmbedThumbnail(request({ link: WATCH }), ctx, fetchFrom, inFlight);
    const second = copyEmbedThumbnail(request({ link: "https://youtu.be/dQw4w9WgXcQ" }), ctx, fetchFrom, inFlight);
    answer?.();
    const [one, two] = await Promise.all([first, second]);
    expect(uploads).toHaveLength(1);
    expect(two.id).toBe(one.id);
    expect(two.reused).toBe(true);
    // Once settled, a later request is judged afresh.
    expect(inFlight.size).toBe(0);
  });

  it("is not fooled by a file whose name only contains the copy's", async () => {
    const { ctx, uploads } = library([
      { id: "m7", originalFilename: "my-youtube-dQw4w9WgXcQ-thumbnail.jpg", url: "/media/m7" },
      { id: "m8", originalFilename: "youtube-dQw4w9WgXcQ-thumbnail.jpg.exe", url: "/media/m8" },
    ]);
    const { fetchFrom } = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg": () => jpeg(),
    });
    expect(
      (await copyEmbedThumbnail(request({ link: WATCH }), ctx, fetchFrom)).reused
    ).toBe(false);
    expect(uploads).toHaveLength(1);
  });

  it("finds Vimeo's picture through its oEmbed, and fetches it only from Vimeo's picture host", async () => {
    const { ctx, uploads } = library();
    const { fetchFrom, asked } = provider({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871": () =>
        Response.json({ thumbnail_url: "https://i.vimeocdn.com/video/452001751-abc_640" }),
      "https://i.vimeocdn.com/video/452001751-abc_640": () =>
        new Response(new Uint8Array(3), { headers: { "content-type": "image/webp" } }),
    });
    await copyEmbedThumbnail(request({ link: VIMEO }), ctx, fetchFrom);
    expect(asked.map(each => each.address)).toEqual([
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871",
      "https://i.vimeocdn.com/video/452001751-abc_640",
    ]);
    expect(uploads[0]?.input).toMatchObject({ filename: "vimeo-76979871-thumbnail.webp" });
  });

  it.each([
    ["another host", "https://evil.example/picture.jpg"],
    ["the server's own network", "https://127.0.0.1/admin"],
    ["plain http on the right host", "http://i.vimeocdn.com/video/1"],
  ])("refuses an oEmbed answer naming %s", async (_label, named) => {
    const { ctx, uploads } = library();
    const { fetchFrom, asked } = provider({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871": () =>
        Response.json({ thumbnail_url: named }),
    });
    await expect(copyEmbedThumbnail(request({ link: VIMEO }), ctx, fetchFrom)).rejects.toBeInstanceOf(NextlyError);
    expect(asked).toHaveLength(1);
    expect(uploads).toEqual([]);
  });

  it("refuses what is not a picture, and a picture too large", async () => {
    const notPicture = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg": () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
    });
    await expect(
      copyEmbedThumbnail(request({ link: WATCH }), library().ctx, notPicture.fetchFrom)
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    const huge = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg": () =>
        new Response(new Uint8Array(6 * 1024 * 1024), { headers: { "content-type": "image/jpeg" } }),
    });
    const { ctx, uploads } = library();
    await expect(copyEmbedThumbnail(request({ link: WATCH }), ctx, huge.fetchFrom)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(uploads).toEqual([]);
  });

  it("refuses a link with no video picture, and fetches nothing for it", async () => {
    for (const link of [
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      "https://example.com/page",
      "http://127.0.0.1:8080/secret",
    ]) {
      const { fetchFrom, asked } = provider({});
      await expect(copyEmbedThumbnail(request({ link }), library().ctx, fetchFrom)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(asked).toEqual([]);
    }
  });

  it("refuses a body that is not only a link", async () => {
    const { fetchFrom, asked } = provider({});
    await expect(
      copyEmbedThumbnail(request({ link: WATCH, address: "https://evil.example" }), library().ctx, fetchFrom)
    ).rejects.toBeInstanceOf(NextlyError);
    expect(asked).toEqual([]);
  });
});

describe("embedThumbnailRoute", () => {
  it("is a write gated on adding media, answering the mutation envelope", async () => {
    const { ctx } = library();
    const { fetchFrom } = provider({
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg": () => jpeg(),
    });
    const route = embedThumbnailRoute({ fetch: fetchFrom });
    expect(route).toMatchObject({
      method: "POST",
      path: "/embed-thumbnail",
      requiredPermission: "create-media",
    });
    const answer = await route.handler(request({ link: WATCH }), ctx);
    const body = (await answer.json()) as { message: string; item: { id: string } };
    expect(body.message).toBe("The video's thumbnail was copied to the media library.");
    expect(body.item.id).toBe("m1");
  });
});
