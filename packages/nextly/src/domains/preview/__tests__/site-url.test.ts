/**
 * Where a preview link's host comes from.
 *
 * The setting is the only value that can name a site on a DIFFERENT origin from
 * the admin, so it wins. Absent, the application's own URL answers — which is
 * correct wherever the admin is mounted inside the site's own app, and is the
 * ordinary case. Before that fallback existed the feature was unreachable on a
 * new installation: nothing prompts an operator to fill the setting in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The real module validates the WHOLE environment on import and throws without
// a database URL, which has nothing to do with what these cover. The stub reads
// `process.env` on every access rather than snapshotting it, so `stubEnv` below
// still drives the value under test.
vi.mock("../../../lib/env", () => ({
  get env() {
    return { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
  },
}));

const { resolvePreviewSiteUrl } = await import("../site-url");

/** The environment variable under test, set for one case at a time. */
function withAppUrl(value: string | undefined): void {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", value ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePreviewSiteUrl", () => {
  it("prefers the configured setting, which is the only split-deployment answer", () => {
    withAppUrl("https://admin.example");

    expect(resolvePreviewSiteUrl("https://site.example")).toBe(
      "https://site.example/"
    );
  });

  it("falls back to the application's own url when nothing is configured", () => {
    withAppUrl("https://site.example");

    expect(resolvePreviewSiteUrl(null)).toBe("https://site.example/");
  });

  // A stored empty string is what an operator leaves behind by clearing the
  // field, and it is not a site URL. Treating it as one produces `new URL("")`,
  // which throws where it is joined rather than here.
  it("treats a blank setting as unset rather than as an address", () => {
    withAppUrl("https://site.example");

    expect(resolvePreviewSiteUrl("   ")).toBe("https://site.example/");
  });

  it("answers null when neither source names anywhere", () => {
    withAppUrl(undefined);

    expect(resolvePreviewSiteUrl(null)).toBeNull();
  });

  // The setting's own API refuses these now, but that check is newer than the
  // column — and the environment schema validates with `z.string().url()`,
  // which accepts any scheme the WHATWG parser does. A link built from one is
  // copied to a clipboard and pasted into an address bar.
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["file:", "file:///etc/passwd"],
  ])("refuses a %s setting and falls through to the app url", (_label, bad) => {
    withAppUrl("https://site.example");

    expect(resolvePreviewSiteUrl(bad)).toBe("https://site.example/");
  });

  it("refuses an unnavigable app url rather than handing one out", () => {
    withAppUrl("javascript:alert(1)");

    expect(resolvePreviewSiteUrl(null)).toBeNull();
  });

  it("refuses a value that is not a url at all", () => {
    withAppUrl(undefined);

    expect(resolvePreviewSiteUrl("site.example")).toBeNull();
  });
});
