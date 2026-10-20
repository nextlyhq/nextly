/**
 * Media reached through a relationship carries its URLs as the storage wrote
 * them: the local adapter's own base followed by the file's path, which the
 * app's pages resolve on whatever host and port serve the request.
 *
 * The public origin points at another host than the one serving the request,
 * as a generated project's `http://localhost:3000` does on any other port: a
 * read that resolved URLs against it would show here.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/lib/get-base-url", () => ({
  getBaseUrl: () => "http://elsewhere.example:4000",
  getPublicOrigin: () => "http://elsewhere.example:4000",
}));

import { TRUSTS_EVERY_COLLECTION } from "../../../../services/collections/trust-grant";
import { CollectionRelationshipService } from "../collection-relationship-service";

/** A stored media row, with the columns the media table names them by. */
const MEDIA_ROW = {
  id: "m1",
  filename: "2026/10/a1-hero.png",
  original_filename: "hero.png",
  mime_type: "image/png",
  url: "/uploads/2026/10/a1-hero.png",
  thumbnail_url: "/uploads/2026/10/b2-thumb_hero.png",
  sizes: JSON.stringify({
    card: {
      url: "/uploads/2026/10/c3-hero-card.webp",
      path: "2026/10/c3-hero-card.webp",
    },
  }),
};

/** An adapter whose `select().from().where()` returns the media row. */
function adapterWithMedia() {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve([MEDIA_ROW]),
  };
  return {
    getDrizzle: () => chain,
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as never;
}

const silent = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

describe("media reached through a relationship", () => {
  it("carries its URLs as the storage wrote them", async () => {
    const service = new CollectionRelationshipService(
      adapterWithMedia(),
      silent,
      {} as never,
      {} as never
    );

    const entry = await service.expandRelationships(
      { id: "p1", hero: "m1" },
      "posts",
      [{ name: "hero", type: "upload", relationTo: "media" }] as never,
      { depth: 1, trusted: TRUSTS_EVERY_COLLECTION }
    );

    const hero = entry.hero as Record<string, unknown>;
    expect(hero.url).toBe("/uploads/2026/10/a1-hero.png");
    expect(hero.thumbnailUrl).toBe("/uploads/2026/10/b2-thumb_hero.png");
    expect((hero.sizes as Record<string, { url: string }>).card.url).toBe(
      "/uploads/2026/10/c3-hero-card.webp"
    );
  });
});
