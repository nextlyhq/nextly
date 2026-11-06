/**
 * The loader that starts site code, run as a browser runs it: it starts the
 * code in order on a public page, and starts nothing under a path it skips
 * or on the canvas. (A page framed by its own site is proved in a browser,
 * end to end, since a frame's parent can't be faked here.)
 *
 * @module site-code/bootstrap.test
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { CANVAS_MOUNT_ATTRIBUTE } from "../canvas/attributes";

import {
  isGatedSiteCode,
  SITE_CODE_BOOTSTRAP,
  SITE_CODE_DATA_ATTRIBUTE,
} from "./bootstrap";
import type { SiteCodeEntry } from "./rules";

/** The code each test starts: two scripts, then a style. */
const ENTRIES: SiteCodeEntry[] = [
  {
    tag: "script",
    attrs: {},
    text: "window.ran = (window.ran || []).concat('first')",
  },
  {
    tag: "script",
    attrs: {},
    text: "window.ran = (window.ran || []).concat('second')",
  },
  { tag: "style", attrs: {}, text: ".marked{color:red}" },
];

/** A page at `url` carrying the head's data block and loader. */
async function page(
  url: string,
  body = ""
): Promise<{ window: JSDOM["window"] & { ran?: string[] } }> {
  const data = JSON.stringify({
    slot: "head",
    skip: ["/admin"],
    entries: ENTRIES,
  });
  const dom = new JSDOM(
    `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${data}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body>${body}</body></html>`,
    { url, runScripts: "dangerously" }
  );
  // The loader starts the code once the page has parsed.
  await new Promise(resolve => setTimeout(resolve, 50));
  return { window: dom.window as JSDOM["window"] & { ran?: string[] } };
}

describe("the site code loader", () => {
  it("starts the code in order on a public page, where its slot says", async () => {
    const { window } = await page("https://acme.example/pricing");
    expect(window.ran).toEqual(["first", "second"]);
    expect(window.document.head.querySelector("style")?.textContent).toBe(
      ".marked{color:red}"
    );
    expect(
      window.document.documentElement.getAttribute(
        `${SITE_CODE_DATA_ATTRIBUTE}-head`
      )
    ).toBe("started");
  });

  it("starts nothing under a path it skips", async () => {
    for (const url of [
      "https://acme.example/admin",
      "https://acme.example/admin/collections/pages",
    ]) {
      const { window } = await page(url);
      expect(window.ran).toBeUndefined();
      expect(window.document.head.querySelector("style")).toBeNull();
    }
  });

  it("starts code on a path that only begins like a skipped one", async () => {
    const { window } = await page("https://acme.example/administration");
    expect(window.ran).toEqual(["first", "second"]);
  });

  it("starts nothing on the canvas", async () => {
    const { window } = await page(
      "https://acme.example/page-builder-canvas",
      `<div ${CANVAS_MOUNT_ATTRIBUTE}></div>`
    );
    expect(window.ran).toBeUndefined();
  });
});

describe("what the loader starts", () => {
  it("is what runs or styles the page, and nothing inert", () => {
    expect(isGatedSiteCode({ tag: "script", attrs: {}, text: "a()" })).toBe(
      true
    );
    expect(
      isGatedSiteCode({
        tag: "script",
        attrs: { type: "application/ld+json" },
        text: "{}",
      })
    ).toBe(false);
    expect(isGatedSiteCode({ tag: "style", attrs: {}, text: "a{}" })).toBe(
      true
    );
    expect(
      isGatedSiteCode({
        tag: "link",
        attrs: { rel: "STYLESHEET", href: "https://cdn.example/a.css" },
      })
    ).toBe(true);
    expect(
      isGatedSiteCode({
        tag: "link",
        attrs: { rel: "preconnect", href: "https://cdn.example" },
      })
    ).toBe(false);
    expect(
      isGatedSiteCode({ tag: "meta", attrs: { name: "a", content: "b" } })
    ).toBe(false);
  });
});
