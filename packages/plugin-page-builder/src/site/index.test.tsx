/**
 * `<SiteCode>`: what runs or styles the page reaches it only through the
 * loader, as inert data; what is inert is written as is; nothing renders in
 * draft mode; a place with no code still writes the paths it skips; and a
 * stored entry the rules refuse is left out.
 *
 * @module site/index.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SITE_CODE_BOOTSTRAP } from "../site-code/bootstrap";

let draft = false;
vi.mock("next/headers", () => ({
  draftMode: async () => ({ isEnabled: draft }),
}));

const { SiteCode } = await import("./index");

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
