/**
 * Which media item an address names through the media routes: the one
 * reading both usage tracking and a copy's source use.
 */
import { describe, expect, it } from "vitest";

import { mediaIdOfCopySource } from "../copies/media-copies";
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

  it("takes no address off the api path as an item, whatever host it is on", () => {
    for (const url of [
      `/media/${ID}`,
      `/admin/media/${ID}`,
      `https://images.example.com/media/${ID}`,
      `https://cdn.example.com/uploads/media/${ID}/photo.jpg`,
      `/myapi/media/${ID}/raw`,
    ]) {
      expect(mediaIdOfRouteAddress(url)).toBeUndefined();
    }
  });

  it("reads only the address's path, never a route inside its query or fragment", () => {
    for (const url of [
      `/search?next=/api/media/${ID}/raw`,
      `https://example.com/login?return=/admin/api/media/${ID}`,
      `/page#/api/media/${ID}/raw`,
    ]) {
      expect(mediaIdOfRouteAddress(url)).toBeUndefined();
    }
  });
});

describe("mediaIdOfCopySource", () => {
  it("finds the item an id or a media route on this site names", () => {
    expect(mediaIdOfCopySource({ id: ID })).toBe(ID);
    expect(mediaIdOfCopySource({ url: `/api/media/${ID}/raw` })).toBe(ID);
    expect(mediaIdOfCopySource({ url: `/admin/api/media/${ID}` })).toBe(ID);
  });

  it("takes no address on another host as an item, even on the api path", () => {
    for (const url of [
      `https://other.example/api/media/${ID}/raw`,
      `http://other.example/api/media/${ID}`,
      `//other.example/api/media/${ID}`,
      `https://images.example.com/media/${ID}`,
      `/media/${ID}`,
    ]) {
      expect(mediaIdOfCopySource({ url })).toBeUndefined();
    }
  });
});
