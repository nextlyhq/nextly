/**
 * Which media item an address names through the media routes: the one
 * reading both usage tracking and a copy's source use.
 */
import { describe, expect, it } from "vitest";

import { mediaIdOfRouteAddress } from "../media-route-address";

const ID = "0b6f6c2e-3c3a-4b8e-9d2f-1f2e3d4c5b6a";

describe("mediaIdOfRouteAddress", () => {
  it("finds the item a media route names, on either mount and absolute", () => {
    for (const url of [
      `/api/media/${ID}/raw`,
      `/api/media/${ID}`,
      `/api/media/${ID}/copy/640?v=abc`,
      `/admin/api/media/${ID}#frag`,
      `https://example.com/api/media/${ID}`,
    ]) {
      expect(mediaIdOfRouteAddress(url)).toBe(ID);
    }
  });

  it("finds no item in an address outside the media routes", () => {
    for (const url of [
      "https://images.example.com/photo.jpg",
      "/uploads/2026/11/photo.jpg",
      "/api/media/not-an-id/raw",
      `/api/media/${ID}extra`,
      "",
    ]) {
      expect(mediaIdOfRouteAddress(url)).toBeUndefined();
    }
  });
});
