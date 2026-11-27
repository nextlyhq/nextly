/**
 * The share card route as a network fetches it: the current version of a
 * picture is answered as a 1200 × 630 JPEG kept for a year, an earlier
 * version is sent on to the current one, and an address naming no picture,
 * or one the site does not serve publicly, is not found or refused.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shareCardRoute } from "../card-route";
import { cardAddressOf, cardVersionOf } from "../share-card";

const PICTURE = {
  id: "f1",
  url: "/uploads/cover.png",
  filename: "cover-ab12.png",
  mimeType: "image/png",
  width: 1212,
  height: 758,
  focalX: 30,
  focalY: 50,
};

/** The route's context, its media library holding `media`. */
function context(
  params: Record<string, string>,
  media: Record<string, Record<string, unknown>> = { f1: PICTURE }
): PluginRouteContext {
  return {
    params,
    services: {
      media: {
        findById: async (id: string) => {
          const found = media[id];
          if (found === undefined) throw NextlyError.notFound();
          return found;
        },
        isImage: (mimeType: string) => mimeType.startsWith("image/"),
      },
    },
  } as unknown as PluginRouteContext;
}

/** The picture's bytes, as the site serves them. */
async function served(status = 200): Promise<Response> {
  const png = await sharp({
    create: { width: 1212, height: 758, channels: 3, background: "#3366cc" },
  })
    .png()
    .toBuffer();
  return new Response(status === 200 ? new Uint8Array(png) : null, { status });
}

const route = shareCardRoute("https://example.com");
const ask = (file: string, media = "f1") =>
  route.handler(
    new Request(`https://example.com/card/${media}/${file}`),
    context({ media, file })
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the share card route", () => {
  it("is public, held to a budget per client, and answers GET", () => {
    expect(route).toMatchObject({ method: "GET", public: true });
    expect(route.rateLimit).toMatchObject({ windowMs: 60_000 });
  });

  it("answers the current version as a 1200 × 630 JPEG kept for a year", async () => {
    const fetched = vi.fn(() => served());
    vi.stubGlobal("fetch", fetched);
    const response = await ask(`${cardVersionOf(PICTURE)}.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    const made = await sharp(
      Buffer.from(await response.arrayBuffer())
    ).metadata();
    expect([made.format, made.width, made.height]).toEqual(["jpeg", 1200, 630]);
    // Read from where the site serves its uploads.
    expect(String(fetched.mock.calls[0]?.[0])).toBe(
      "https://example.com/uploads/cover.png"
    );
  });

  it("sends an earlier version on to the current card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => served())
    );
    const response = await ask("00000000.jpg");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      cardAddressOf("f1", cardVersionOf(PICTURE))
    );
  });

  it("finds no card for an address naming no picture", async () => {
    await expect(ask("not-a-card.png")).rejects.toSatisfy(error =>
      NextlyError.isCode(error, "NOT_FOUND")
    );
    await expect(
      ask(`${cardVersionOf(PICTURE)}.jpg`, "gone")
    ).rejects.toSatisfy(error => NextlyError.isCode(error, "NOT_FOUND"));
  });

  it("cuts no card from a picture the site does not serve to anyone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => served(403))
    );
    await expect(ask(`${cardVersionOf(PICTURE)}.jpg`)).rejects.toBeInstanceOf(
      NextlyError
    );
  });
});
