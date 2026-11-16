/**
 * The loader that starts site code, run as a browser runs it: it starts the
 * code in order on a public page, and starts nothing under a path it skips
 * or on the canvas. (A page framed by its own site is proved in a browser,
 * end to end, since a frame's parent can't be faked here.)
 *
 * @module site-code/bootstrap.test
 */
import { JSDOM, ResourceLoader, VirtualConsole } from "jsdom";
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

describe("the loader, in order and kept out of the admin", () => {
  /** A page at `url` starting `entries`, loading what they name. */
  async function pageWith(
    url: string,
    entries: SiteCodeEntry[],
    virtualConsole?: VirtualConsole
  ): Promise<JSDOM["window"] & { ran?: string[] }> {
    const data = JSON.stringify({ slot: "head", skip: ["/admin"], entries });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${data}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body></body></html>`,
      {
        url,
        runScripts: "dangerously",
        resources: "usable",
        ...(virtualConsole === undefined ? {} : { virtualConsole }),
      }
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    return dom.window as JSDOM["window"] & { ran?: string[] };
  }

  it("waits for an external script before starting what follows it", async () => {
    const window = await pageWith("https://acme.example/", [
      {
        tag: "script",
        attrs: {
          src: "data:text/javascript,window.ran=(window.ran||[]).concat('library')",
        },
      },
      {
        tag: "script",
        attrs: {},
        text: "window.ran = (window.ran || []).concat(typeof window.ran)",
      },
    ]);
    // The inline script ran after the library, and saw what it set.
    expect(window.ran).toEqual(["library", "object"]);
  });

  it("finishes the head's code before the body's starts", async () => {
    const head = JSON.stringify({
      slot: "head",
      skip: ["/admin"],
      entries: [
        {
          tag: "script",
          attrs: {
            src: "data:text/javascript,window.ran=(window.ran||[]).concat('head library')",
          },
        },
      ],
    });
    const body = JSON.stringify({
      slot: "body",
      skip: ["/admin"],
      entries: [
        {
          tag: "script",
          attrs: {},
          text: "window.ran = (window.ran || []).concat('body')",
        },
      ],
    });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${head}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="body">${body}</script><script>${SITE_CODE_BOOTSTRAP}</script></body></html>`,
      {
        url: "https://acme.example/",
        runScripts: "dangerously",
        resources: "usable",
      }
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    // Each loader on its own would start the body's script while the head's
    // library is still loading.
    expect((dom.window as unknown as { ran?: string[] }).ran).toEqual([
      "head library",
      "body",
    ]);
  });

  it("still waits on a module script that says nomodule, which is fetched", async () => {
    // The module bundle never answers, so whatever follows must wait.
    class NeverForModule extends ResourceLoader {
      override fetch(
        url: string,
        options: Parameters<ResourceLoader["fetch"]>[1]
      ) {
        if (url.includes("bundle")) {
          return Object.assign(new Promise<Buffer>(() => undefined), {
            abort: () => undefined,
          });
        }
        return super.fetch(url, options);
      }
    }
    const head = JSON.stringify({
      slot: "head",
      skip: ["/admin"],
      entries: [
        {
          tag: "script",
          attrs: {
            src: "https://cdn.example/bundle.js",
            type: "module",
            nomodule: "",
          },
        },
        { tag: "script", attrs: {}, text: "window.ran = ['after']" },
      ],
    });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${head}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body></body></html>`,
      {
        url: "https://acme.example/",
        runScripts: "dangerously",
        resources: new NeverForModule(),
        beforeParse: window => {
          Object.defineProperty(
            window.HTMLScriptElement.prototype,
            "noModule",
            { configurable: true, get: () => false }
          );
        },
      }
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    expect((dom.window as unknown as { ran?: string[] }).ran).toBeUndefined();
  });

  it("waits on no nomodule script where modules run, which is never fetched there", async () => {
    // A loader that fetches nothing for the legacy bundle, as a module-capable
    // browser never fetches it: no load or error ever comes. Answering with
    // a promise that never settles would hold jsdom's own script queue, which
    // knows nothing of `nomodule`, and stop the next script for that reason.
    class NeverForLegacy extends ResourceLoader {
      override fetch(
        url: string,
        options: Parameters<ResourceLoader["fetch"]>[1]
      ) {
        return url.includes("legacy") ? null : super.fetch(url, options);
      }
    }
    const head = JSON.stringify({
      slot: "head",
      skip: ["/admin"],
      entries: [
        {
          tag: "script",
          attrs: { src: "https://cdn.example/legacy.js", nomodule: "" },
        },
      ],
    });
    const body = JSON.stringify({
      slot: "body",
      skip: ["/admin"],
      entries: [{ tag: "script", attrs: {}, text: "window.ran = ['body']" }],
    });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${head}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="body">${body}</script><script>${SITE_CODE_BOOTSTRAP}</script></body></html>`,
      {
        url: "https://acme.example/",
        runScripts: "dangerously",
        resources: new NeverForLegacy(),
        // A browser that runs modules has noModule on its scripts.
        beforeParse: window => {
          Object.defineProperty(
            window.HTMLScriptElement.prototype,
            "noModule",
            {
              configurable: true,
              get: () => false,
            }
          );
        },
      }
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    expect((dom.window as unknown as { ran?: string[] }).ran).toEqual(["body"]);
  });

  it("loads the admin afresh when the page moves into it within the app", async () => {
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    // jsdom can't navigate, and says so: that is the reload being asked for.
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    const window = await pageWith(
      "https://acme.example/pricing",
      [{ tag: "script", attrs: {}, text: "window.ran = ['site']" }],
      virtualConsole
    );
    expect(window.ran).toEqual(["site"]);
    window.history.pushState({}, "", "/blog");
    expect(errors.filter(message => message.includes("navigation"))).toEqual(
      []
    );
    window.history.pushState({}, "", "/admin/collections/pages");
    expect(errors.some(message => message.includes("navigation"))).toBe(true);
  });

  it("keeps the paths it skips when code removes the data blocks", async () => {
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    const window = await pageWith(
      "https://acme.example/pricing",
      [
        {
          tag: "script",
          attrs: {},
          text: "document.querySelectorAll('script[type=\"application/json\"]').forEach(function (block) { block.remove(); })",
        },
      ],
      virtualConsole
    );
    expect(
      window.document.querySelectorAll('script[type="application/json"]')
    ).toHaveLength(0);
    // The guard read /admin before the code ran, so moving in still reloads.
    window.history.pushState({}, "", "/admin/collections/pages");
    expect(errors.some(message => message.includes("navigation"))).toBe(true);
  });

  it("loads a public page afresh when the admin moves out to it within the app", async () => {
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    const window = await pageWith(
      "https://acme.example/admin",
      [{ tag: "script", attrs: {}, text: "window.ran = ['site']" }],
      virtualConsole
    );
    // Nothing starts in the admin, and moving within it reloads nothing.
    expect(window.ran).toBeUndefined();
    window.history.pushState({}, "", "/admin/collections/pages");
    expect(errors.filter(message => message.includes("navigation"))).toEqual(
      []
    );
    // Out onto the site: a fresh document, where the code starts.
    window.history.pushState({}, "", "/pricing");
    expect(errors.some(message => message.includes("navigation"))).toBe(true);
  });
});

describe("where the loaders skip", () => {
  it("skips a path either place names, in both places", async () => {
    // The head skips only /admin; the end of the body also skips /studio.
    const head = JSON.stringify({
      slot: "head",
      skip: ["/admin"],
      entries: [{ tag: "script", attrs: {}, text: "window.ran = ['head']" }],
    });
    const body = JSON.stringify({
      slot: "body",
      skip: ["/admin", "/studio"],
      entries: [
        {
          tag: "script",
          attrs: {},
          text: "window.ran = (window.ran || []).concat('body')",
        },
      ],
    });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${head}</script><script>${SITE_CODE_BOOTSTRAP}</script></head><body><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="body">${body}</script><script>${SITE_CODE_BOOTSTRAP}</script></body></html>`,
      { url: "https://acme.example/studio", runScripts: "dangerously" }
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((dom.window as unknown as { ran?: string[] }).ran).toBeUndefined();
  });

  it("skips a path named by a place that holds no code", async () => {
    // The head holds no code but skips /studio; only the body has a loader.
    const head = JSON.stringify({
      slot: "head",
      skip: ["/admin", "/studio"],
      entries: [],
    });
    const body = JSON.stringify({
      slot: "body",
      skip: ["/admin"],
      entries: [{ tag: "script", attrs: {}, text: "window.ran = true" }],
    });
    const dom = new JSDOM(
      `<!doctype html><html><head><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="head">${head}</script></head><body><script type="application/json" ${SITE_CODE_DATA_ATTRIBUTE}="body">${body}</script><script>${SITE_CODE_BOOTSTRAP}</script></body></html>`,
      { url: "https://acme.example/studio", runScripts: "dangerously" }
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((dom.window as unknown as { ran?: boolean }).ran).toBeUndefined();
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
