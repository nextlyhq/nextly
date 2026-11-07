/**
 * `<SiteCode>`: what runs or styles the page reaches it only through the
 * loader, as inert data; what is inert is written as is; nothing renders in
 * draft mode; a place with no code still writes the paths it skips; a
 * stored entry the rules refuse is left out; and its own read goes through
 * the app's `"use cache"` function under Cache Components, or refuses.
 *
 * @module site/index.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SITE_CODE_BOOTSTRAP } from "../site-code/bootstrap";
import { SITE_CODE_SLUG } from "../site-code/storage";

let draft = false;
vi.mock("next/headers", () => ({
  draftMode: async () => ({ isEnabled: draft }),
}));

/** What the stand-ins for Nextly's cache record, and what they answer. */
const runtime = {
  /** Whether the app has registered its `"use cache"` read function. */
  registered: false,
  /** The options each `cachedFind` call was given. */
  cachedFinds: [] as { tags: string[]; keyParts: string[] }[],
};

// `cachedFind` and the registration are stood in for, so a test decides
// whether the app registered a read function and sees what the read asked
// for; the tag helpers and `cacheComponentsEnabled` stay Nextly's own, so the
// tags asserted are the ones a Single save expires.
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    cachedReadRegistered: () => runtime.registered,
    cachedFind: async (
      reader: () => Promise<unknown>,
      options: { tags: string[]; keyParts: string[] }
    ) => {
      runtime.cachedFinds.push(options);
      return reader();
    },
  };
});

/** The stored site code document the stand-in Nextly answers with. */
let storedDocument: unknown = null;
const findSingle = vi.fn(async () => storedDocument);
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ findSingle }),
}));

const { SiteCode } = await import("./index");
const { nextlySingleTags } = await import("nextly/runtime");

/** A stored site code document holding `head` and `body`. */
const stored =
  (head: unknown[], body: unknown[] = []) =>
  async (): Promise<unknown> => ({ head, body });

/** `<SiteCode>` as the HTML it renders. */
async function html(props: Parameters<typeof SiteCode>[0]): Promise<string> {
  const element = await SiteCode(props);
  return element === null ? "" : renderToStaticMarkup(element);
}

beforeEach(() => {
  draft = false;
  runtime.registered = false;
  runtime.cachedFinds = [];
  storedDocument = null;
  findSingle.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("<SiteCode>", () => {
  it("writes what runs only as data, with the loader after it", async () => {
    const markup = await html({
      slot: "head",
      read: stored([
        {
          tag: "script",
          attrs: { async: "", src: "https://cdn.example/a.js" },
        },
        { tag: "script", attrs: {}, text: "if (a < b) run()" },
      ]),
    });
    // No executable script carries the site's code: it is in the data block.
    expect(markup).not.toContain('<script async="" src=');
    expect(markup).toContain(
      '<script type="application/json" data-nx-site-code="head">'
    );
    // Every < in the data is escaped, so no text can close the block.
    expect(markup).toContain("if (a \\u003c b) run()");
    expect(markup).toContain(SITE_CODE_BOOTSTRAP);
    expect(markup.indexOf("application/json")).toBeLessThan(
      markup.indexOf(SITE_CODE_BOOTSTRAP)
    );
  });

  it("writes what is inert as is", async () => {
    const markup = await html({
      slot: "head",
      read: stored([
        {
          tag: "meta",
          attrs: { name: "google-site-verification", content: "abc" },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: "",
          },
        },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          text: '{"@type":"Organization"}',
        },
      ]),
    });
    expect(markup).toContain(
      '<meta name="google-site-verification" content="abc"/>'
    );
    expect(markup).toContain('rel="preconnect"');
    expect(markup).toContain('crossorigin=""');
    expect(markup).toContain(
      '<script type="application/ld+json">{"@type":"Organization"}</script>'
    );
    // Nothing to start, so no loader.
    expect(markup).not.toContain(SITE_CODE_BOOTSTRAP);
  });

  it("writes a no-script pixel for pages without script, its values escaped", async () => {
    const markup = await html({
      slot: "body",
      read: stored(
        [],
        [
          {
            tag: "noscript",
            child: {
              tag: "img",
              attrs: {
                src: "https://www.facebook.com/tr?id=1&ev=PageView",
                style: "display:none",
              },
            },
          },
        ]
      ),
    });
    expect(markup).toContain(
      '<noscript><img src="https://www.facebook.com/tr?id=1&amp;ev=PageView" style="display:none"></noscript>'
    );
  });

  it("skips the admin under the app's base path", async () => {
    const markup = await html({
      slot: "head",
      basePath: "/site",
      read: stored([{ tag: "style", attrs: {}, text: "a{}" }]),
    });
    expect(markup).toContain('"skip":["/site/admin"]');
  });

  it("skips the admin at the root where the app has no base path", async () => {
    const markup = await html({
      slot: "head",
      read: stored([{ tag: "style", attrs: {}, text: "a{}" }]),
    });
    expect(markup).toContain('"skip":["/admin"]');
  });

  it("gives the loader the site's nonce", async () => {
    const markup = await html({
      slot: "head",
      nonce: "n0nce",
      read: stored([{ tag: "style", attrs: {}, text: "a{}" }]),
    });
    expect(markup).toContain('<script nonce="n0nce">');
  });

  it("renders nothing in draft mode", async () => {
    draft = true;
    const read = vi.fn(stored([{ tag: "style", attrs: {}, text: "a{}" }]));
    expect(await SiteCode({ slot: "head", read })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("leaves out a stored entry the rules refuse, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const markup = await html({
      slot: "head",
      read: stored([
        { tag: "style", attrs: {}, text: "a{}</style><script>x()</script>" },
        { tag: "meta", attrs: { name: "a", content: "b" } },
      ]),
    });
    expect(markup).toContain('<meta name="a" content="b"/>');
    // The refused style is in neither the page nor the data block.
    expect(markup).not.toContain("x()");
    expect(markup).toContain('"entries":[]');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("writes only the paths it skips where nothing is stored", async () => {
    const markup = await html({
      slot: "head",
      skip: ["/admin", "/studio"],
      read: async () => null,
    });
    // The other place's loader reads this block, so an empty head's skip
    // list still keeps the body's scripts off /studio.
    expect(markup).toBe(
      '<script type="application/json" data-nx-site-code="head">' +
        '{"slot":"head","skip":["/admin","/studio"],"entries":[]}</script>'
    );
  });
});

describe("<SiteCode> reading the stored code itself", () => {
  /** A stored document whose head holds one meta tag. */
  const META = { tag: "meta", attrs: { name: "a", content: "b" } };

  it("refuses under Cache Components with no read function registered, naming the fix", async () => {
    // The value Next.js inlines into the app's bundle when Cache Components is on.
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    storedDocument = { head: [META], body: [] };
    const read = SiteCode({ slot: "head" });
    await expect(read).rejects.toThrow("src/nextly/cached-read.ts");
    await expect(read).rejects.toThrow('import "@/nextly/cached-read";');
    await expect(read).rejects.toThrow(
      "https://nextlyhq.com/docs/page-builder/site-code#with-cache-components"
    );
    // Refused before reading: no unstable_cache read is left pending.
    expect(runtime.cachedFinds).toEqual([]);
    expect(findSingle).not.toHaveBeenCalled();
  });

  it("reads through the cache under Cache Components once a read function is registered", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    runtime.registered = true;
    storedDocument = { head: [META], body: [] };
    const element = await SiteCode({ slot: "head" });
    expect(renderToStaticMarkup(element ?? <></>)).toContain(
      '<meta name="a" content="b"/>'
    );
    expect(runtime.cachedFinds).toHaveLength(1);
    expect(findSingle).toHaveBeenCalledWith(
      expect.objectContaining({ slug: SITE_CODE_SLUG, overrideAccess: true })
    );
  });

  it("reads through the cache as before without Cache Components, with nothing registered", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "false");
    storedDocument = { head: [META], body: [] };
    const element = await SiteCode({ slot: "head" });
    expect(renderToStaticMarkup(element ?? <></>)).toContain(
      '<meta name="a" content="b"/>'
    );
    expect(runtime.cachedFinds).toHaveLength(1);
  });

  it("reads through the caller's own read under Cache Components without asking", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    const read = vi.fn(async () => ({ head: [META], body: [] }));
    const element = await SiteCode({ slot: "head", read });
    expect(renderToStaticMarkup(element ?? <></>)).toContain(
      '<meta name="a" content="b"/>'
    );
    expect(read).toHaveBeenCalledWith(SITE_CODE_SLUG);
    expect(runtime.cachedFinds).toEqual([]);
  });

  it("tags the read with exactly the Single's tags, which a site code save expires", async () => {
    // A save to the site code Single expires `nextlySingleTags(slug)`: core
    // proves a Single update flushes that tag in
    // packages/nextly/src/domains/collections/__tests__/cache-revalidation.integration.test.ts
    // ("flushes the single tag on a single update"). Tagged with exactly
    // those, the cached read is what that save refreshes, and nothing else's.
    runtime.registered = true;
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    await SiteCode({ slot: "head" });
    await SiteCode({ slot: "body", slug: "renamed-site-code" });
    expect(runtime.cachedFinds.map(options => options.tags)).toEqual([
      nextlySingleTags(SITE_CODE_SLUG),
      nextlySingleTags("renamed-site-code"),
    ]);
    expect(nextlySingleTags(SITE_CODE_SLUG)).toEqual([
      `nextly:single:${SITE_CODE_SLUG}`,
    ]);
  });
});
