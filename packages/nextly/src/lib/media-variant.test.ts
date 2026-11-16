// Why: the local storage adapter writes media URLs on its own base, a path
// (`/uploads/...`) by default, and cloud adapters write absolute URLs. Reads
// hand them back as stored, so the app's own pages show them on whatever host
// and port serve the request. A consumer that must hand a URL to something
// outside the app asks toPublicMediaUrl, which resolves a relative URL
// against a public origin it is given or configured with, and never against
// one it guessed. These tests lock both, with the environment stood in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv: { NEXT_PUBLIC_APP_URL?: string; NODE_ENV?: string } = {};
vi.mock("../shared/lib/env", () => ({
  get env() {
    return mockEnv;
  },
}));

import { setNextlyLogger } from "../observability/logger";

import { normalizeMediaUrls, toPublicMediaUrl } from "./media-variant";

const logged = { warn: [] as string[], error: [] as string[] };
beforeEach(() => {
  mockEnv.NEXT_PUBLIC_APP_URL = undefined;
  mockEnv.NODE_ENV = "development";
  logged.warn.length = 0;
  logged.error.length = 0;
  setNextlyLogger({
    warn: payload => logged.warn.push(JSON.stringify(payload)),
    error: payload => logged.error.push(JSON.stringify(payload)),
    info: () => {},
    debug: () => {},
  });
});
afterEach(() => setNextlyLogger(undefined));

describe("normalizeMediaUrls", () => {
  it("hands back local URLs as stored, whatever NEXT_PUBLIC_APP_URL holds", () => {
    mockEnv.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const row = { url: "/uploads/a.jpg", thumbnailUrl: "/uploads/a-thumb.jpg" };
    expect(normalizeMediaUrls(row)).toEqual(row);
  });

  it("hands back cloud URLs as stored", () => {
    const row = { url: "https://cdn.example.com/a.jpg" };
    expect(normalizeMediaUrls(row)).toEqual(row);
  });

  // Image sizes are no longer made or offered. A row stored before then still
  // carries its `sizes` column, in whichever form its dialect returns it, and
  // no reader hands it on.
  it.each([
    ["an object", { card: { url: "/uploads/a-card.jpg", width: 400 } }],
    ["a JSON string (SQLite)", JSON.stringify({ card: { url: "/c.jpg" } })],
    ["null", null],
  ])("leaves out stored sizes held as %s", (_form, sizes) => {
    const out = normalizeMediaUrls({ url: "/uploads/a.jpg", sizes });
    expect("sizes" in out).toBe(false);
    // The control: the row's own URL still comes through, so the absence is
    // the key being dropped rather than the row being lost.
    expect(out.url).toBe("/uploads/a.jpg");
  });

  it("does not mutate the input row, and keeps its other fields", () => {
    const row = {
      id: "abc",
      url: "/uploads/a.jpg",
      sizes: { card: { url: "/uploads/a-card.jpg" } },
    };
    const snapshot = JSON.parse(JSON.stringify(row));
    const out = normalizeMediaUrls(row);
    expect(row).toEqual(snapshot);
    expect(out.id).toBe("abc");
  });

  // A local storage `baseUrl` written without its leading slash (`uploads`)
  // stores `uploads/<key>`, which a page at `/admin/media` would resolve to
  // `/admin/media/uploads/<key>`. Read as a path from the site's root.
  it("reads a URL stored without its leading slash from the site's root", () => {
    const row = normalizeMediaUrls({
      url: "uploads/2026/10/a.png",
      thumbnailUrl: "uploads/2026/10/a-thumb.png",
    });

    expect(row.url).toBe("/uploads/2026/10/a.png");
    expect(row.thumbnailUrl).toBe("/uploads/2026/10/a-thumb.png");
  });

  it.each([
    "/uploads/2026/10/a.png",
    "https://cdn.example.com/a.png",
    "//cdn.example.com/a.png",
  ])("leaves %s as it is", url => {
    const row = normalizeMediaUrls({ url, thumbnailUrl: url });
    expect(row.url).toBe(url);
    expect(row.thumbnailUrl).toBe(url);
  });
});

describe("toPublicMediaUrl", () => {
  it("passes an absolute URL through, without needing an origin", () => {
    expect(toPublicMediaUrl("https://cdn.example.com/a.jpg")).toBe(
      "https://cdn.example.com/a.jpg"
    );
    expect(toPublicMediaUrl("//cdn.example.com/a.jpg")).toBe(
      "//cdn.example.com/a.jpg"
    );
    expect(logged.warn).toEqual([]);
  });

  it("passes null, undefined and an empty string through", () => {
    expect(toPublicMediaUrl(null)).toBeNull();
    expect(toPublicMediaUrl(undefined)).toBeUndefined();
    expect(toPublicMediaUrl("")).toBe("");
  });

  it("resolves a relative URL against the base it is given", () => {
    expect(
      toPublicMediaUrl("/uploads/a.jpg", {
        baseUrl: "https://mail.example.com/",
      })
    ).toBe("https://mail.example.com/uploads/a.jpg");
  });

  it("resolves a relative URL against NEXT_PUBLIC_APP_URL when given none", () => {
    mockEnv.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(toPublicMediaUrl("uploads/a.jpg")).toBe(
      "https://app.example.com/uploads/a.jpg"
    );
  });

  it("prefers the base it is given over NEXT_PUBLIC_APP_URL", () => {
    mockEnv.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(
      toPublicMediaUrl("/uploads/a.jpg", {
        baseUrl: "https://mail.example.com",
      })
    ).toBe("https://mail.example.com/uploads/a.jpg");
  });

  it("in development, with no origin, warns naming both settings and guesses no host", () => {
    const out = toPublicMediaUrl("/uploads/a.jpg");
    expect(out).toBe("/uploads/a.jpg");
    expect(String(out)).not.toMatch(/localhost|https?:/);
    expect(logged.warn.join("\n")).toMatch(/baseUrl/);
    expect(logged.warn.join("\n")).toMatch(/NEXT_PUBLIC_APP_URL/);
  });

  it("in production, with no origin, logs an error naming both settings and leaves the medium out", () => {
    mockEnv.NODE_ENV = "production";
    expect(toPublicMediaUrl("/uploads/a.jpg")).toBeNull();
    expect(logged.error.join("\n")).toMatch(/baseUrl/);
    expect(logged.error.join("\n")).toMatch(/NEXT_PUBLIC_APP_URL/);
  });
});
