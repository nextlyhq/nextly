import { describe, expect, it } from "vitest";

import {
  hasPreviewConfigured,
  resolvePreviewUrl,
} from "../preview-url-resolver";

const SITE = "https://example.com";

describe("hasPreviewConfigured", () => {
  it("is false for a collection that declares no preview", () => {
    expect(hasPreviewConfigured(undefined)).toBe(false);
    expect(hasPreviewConfigured({})).toBe(false);
  });

  it("is true for either authoring path", () => {
    expect(hasPreviewConfigured({ url: () => "/p" })).toBe(true);
    expect(hasPreviewConfigured({ urlTemplate: "/p/{slug}" })).toBe(true);
  });

  it("is false for an empty template rather than merely present", () => {
    // A stored empty string is what a UI field yields when it is cleared, and
    // treating it as "configured" would persist hasPreview: true for a
    // collection whose button can never resolve.
    expect(hasPreviewConfigured({ urlTemplate: "" })).toBe(false);
  });

  it("agrees with the resolver about what counts as configured", () => {
    // The stored boolean and the resolution must not drift: anything this
    // predicate calls configured must resolve to something other than
    // notConfigured, and vice versa.
    const cases: Parameters<typeof hasPreviewConfigured>[0][] = [
      undefined,
      {},
      { urlTemplate: "" },
      { url: () => "/p" },
      { urlTemplate: "/p/{slug}" },
    ];

    expect(cases.length).toBeGreaterThan(0);
    for (const preview of cases) {
      const resolution = resolvePreviewUrl({
        preview,
        entry: { slug: "hello" },
        siteUrl: SITE,
      });
      expect(resolution.status === "notConfigured").toBe(
        !hasPreviewConfigured(preview)
      );
    }
  });
});

describe("resolvePreviewUrl", () => {
  it("reports notConfigured when nothing declares a preview", () => {
    expect(
      resolvePreviewUrl({ preview: undefined, entry: {}, siteUrl: SITE })
    ).toEqual({ status: "notConfigured" });
  });

  it("resolves a code-first function against the site URL", () => {
    expect(
      resolvePreviewUrl({
        preview: { url: entry => `/posts/${String(entry.slug)}` },
        entry: { slug: "hello" },
        siteUrl: SITE,
      })
    ).toEqual({ status: "resolved", url: "https://example.com/posts/hello" });
  });

  it("resolves a template against the site URL", () => {
    expect(
      resolvePreviewUrl({
        preview: { urlTemplate: "/preview/{slug}" },
        entry: { slug: "hello" },
        siteUrl: SITE,
      })
    ).toEqual({ status: "resolved", url: "https://example.com/preview/hello" });
  });

  it("prefers the function when a declaration somehow carries both", () => {
    expect(
      resolvePreviewUrl({
        preview: { url: () => "/from-function", urlTemplate: "/from-template" },
        entry: {},
        siteUrl: SITE,
      })
    ).toEqual({ status: "resolved", url: "https://example.com/from-function" });
  });

  it("reports unavailable when the authored function declines", () => {
    expect(
      resolvePreviewUrl({
        preview: { url: () => null },
        entry: {},
        siteUrl: SITE,
      })
    ).toEqual({ status: "unavailable" });
  });

  it("separates a THROWN declaration from one that declines", () => {
    // User code runs inside a request here. A throw is the declaration failing
    // to produce a URL, not the server failing, so it must not escape as a 500 —
    // and not as `unavailable` either, which states there is no address YET and
    // sends the editor to the field the URL is built from. A throw states only
    // that producing an address did not work, and does not say whose fault that
    // is.
    expect(
      resolvePreviewUrl({
        preview: {
          url: () => {
            throw new Error("author bug");
          },
        },
        entry: {},
        siteUrl: SITE,
      })
    ).toEqual({ status: "declarationFailed" });

    // The control: the same declaration DECLINING is still `unavailable`, so
    // the assertion above is about the throw rather than about this shape of
    // call answering `declarationFailed` whatever it does.
    expect(
      resolvePreviewUrl({
        preview: { url: () => null },
        entry: {},
        siteUrl: SITE,
      })
    ).toEqual({ status: "unavailable" });
  });

  /*
   * The resolver's other `declarationFailed` producer — a candidate that fails
   * to parse — has NO test, and that is stated rather than left as a gap for
   * someone to read as coverage. The candidate is built by prefixing the site's
   * own origin and path, so it always begins with a URL the parser already
   * accepted, and no authored path reaches the failure: `/../../elsewhere`
   * normalises to the site's root instead. The guard stays because reachability
   * is a property of that composition rather than of the function, and it costs
   * nothing to hold.
   */

  it("reports unavailable when a template placeholder has no value yet", () => {
    for (const slug of [undefined, null, ""]) {
      expect(
        resolvePreviewUrl({
          preview: { urlTemplate: "/preview/{slug}" },
          entry: { slug },
          siteUrl: SITE,
        })
      ).toEqual({ status: "unavailable" });
    }
  });

  it("interpolates falsy-but-real values instead of suppressing the URL", () => {
    // A truthiness test here would drop a legitimate id of 0, which reads as
    // "this entry cannot be previewed" for the one entry that can.
    expect(
      resolvePreviewUrl({
        preview: { urlTemplate: "/p/{id}" },
        entry: { id: 0 },
        siteUrl: SITE,
      })
    ).toEqual({ status: "resolved", url: "https://example.com/p/0" });
  });

  it("refuses an object placeholder rather than emitting [object Object]", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/p/{ref}" },
      entry: { ref: { id: 1 } },
      siteUrl: SITE,
    });
    expect(resolution).toEqual({ status: "unavailable" });
  });

  it("refuses value types with no meaningful string form", () => {
    // A denylist that excluded objects would let each of these through, and the
    // function case is the sharp one: String(fn) is the function's source text,
    // which is long, valid-looking, and silently wrong in a URL.
    const rejected: unknown[] = [
      () => "x",
      Symbol("s"),
      { id: 1 },
      [1, 2],
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];

    expect(rejected.length).toBeGreaterThan(0);
    for (const ref of rejected) {
      expect(
        resolvePreviewUrl({
          preview: { urlTemplate: "/p/{ref}" },
          entry: { ref },
          siteUrl: SITE,
        })
      ).toEqual({ status: "unavailable" });
    }
  });

  it("escapes interpolated values so they cannot alter the path shape", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/p/{slug}" },
      entry: { slug: "a/../b" },
      siteUrl: SITE,
    });
    expect(resolution).toEqual({
      status: "resolved",
      url: "https://example.com/p/a%2F..%2Fb",
    });
  });

  // The separating property. Every case below produces "no usable URL", and a
  // resolver that answered null for all of them would pass any test asserting
  // only absence. What distinguishes this one is that a host IS guessable here
  // and guessing yields the ADMIN's origin, which is confidently wrong — so the
  // status must be its own value and must carry the path forward.
  it("reports noSiteUrl, distinctly from unavailable, when no host is known", () => {
    const resolution = resolvePreviewUrl({
      preview: { url: () => "/posts/hello" },
      entry: {},
      siteUrl: null,
    });

    expect(resolution).toEqual({ status: "noSiteUrl", path: "/posts/hello" });
    expect(resolution.status).not.toBe("unavailable");
    expect(resolution.status).not.toBe("resolved");
  });

  it("refuses a site URL the browser would EXECUTE rather than navigate to", () => {
    // The resolved string is assigned to location.href by the admin, and these
    // schemes run script in the assigning document's origin — which for the
    // preview tab is the admin's own. `z.string().url()` accepts every one of
    // them, so a settings write would otherwise become script execution for
    // whoever next clicks Preview.
    const executable = [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ];

    expect(executable.length).toBeGreaterThan(0);
    for (const siteUrl of executable) {
      const resolution = resolvePreviewUrl({
        preview: { url: () => "/posts/hello" },
        entry: {},
        siteUrl,
      });

      expect(resolution).toEqual({ status: "noSiteUrl", path: "/posts/hello" });
      // Never `resolved`: a caller branching on that status navigates to it.
      expect(resolution.status).not.toBe("resolved");
    }
  });

  it("refuses an executable URL returned by the authored function too", () => {
    // The declaration is user code and may compute anything, so the same
    // standard applies to what it returns as to the configured site.
    const resolution = resolvePreviewUrl({
      preview: { url: () => "javascript:alert(1)" },
      entry: {},
      siteUrl: SITE,
    });

    // Not absolute by the navigable test, so it is joined under the site origin,
    // where the scheme is inert as an ordinary path segment.
    expect(resolution).toEqual({
      status: "resolved",
      url: "https://example.com/javascript:alert(1)",
    });
  });

  it("accepts a site URL carrying a base path", () => {
    expect(
      resolvePreviewUrl({
        preview: { url: () => "/posts/hello" },
        entry: {},
        siteUrl: "https://example.com/site/",
      })
    ).toEqual({
      status: "resolved",
      url: "https://example.com/site/posts/hello",
    });
  });

  it("passes an absolute authored URL through even with no site configured", () => {
    // An author who wrote a full URL named the host on purpose; re-basing it
    // against the configured site would override a deliberate choice.
    expect(
      resolvePreviewUrl({
        preview: { url: () => "https://staging.example.org/p/1" },
        entry: {},
        siteUrl: null,
      })
    ).toEqual({ status: "resolved", url: "https://staging.example.org/p/1" });
  });

  it("joins base and path without doubling or dropping the separator", () => {
    const cases = [
      { siteUrl: "https://example.com/", path: "/p" },
      { siteUrl: "https://example.com", path: "p" },
      { siteUrl: "https://example.com///", path: "p" },
    ];

    expect(cases.length).toBeGreaterThan(0);
    for (const { siteUrl, path } of cases) {
      expect(
        resolvePreviewUrl({ preview: { url: () => path }, entry: {}, siteUrl })
      ).toEqual({ status: "resolved", url: "https://example.com/p" });
    }
  });

  it("hands the authored function the entry it was given", () => {
    // Observed rather than reconstructed: asserting on the argument the real
    // call receives is what keeps this honest if the call site starts reshaping
    // the entry before passing it on.
    const seen: Record<string, unknown>[] = [];
    const entry = { slug: "hello", status: "draft" };

    resolvePreviewUrl({
      preview: {
        url: received => {
          seen.push(received);
          return "/p";
        },
      },
      entry,
      siteUrl: SITE,
    });

    expect(seen).toEqual([entry]);
  });
});

describe("a site URL that carries its own query or fragment", () => {
  // A tenant selector is the usual reason, and the settings schema accepts one.
  // Dropping it would send the visitor to the same path on a different tenant —
  // and would disagree with the minted link, which keeps it, so the reviewer's
  // first request would arrive scoped correctly and the redirect would strip it.
  it("carries the site URL's query onto the resolved path", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/{slug}" },
      entry: { slug: "about" },
      siteUrl: "https://site.example/base?tenant=a",
    });

    expect(resolution).toEqual({
      status: "resolved",
      url: "https://site.example/base/about?tenant=a",
    });
  });

  it("carries the site URL's fragment when the path declares none", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/{slug}" },
      entry: { slug: "about" },
      siteUrl: "https://site.example#top",
    });

    expect(resolution).toMatchObject({ url: "https://site.example/about#top" });
  });

  // The authored path describes ONE document; the site URL describes the
  // deployment. The narrower statement wins.
  it("lets the authored path's own query win a conflict", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/{slug}?tenant=b" },
      entry: { slug: "about" },
      siteUrl: "https://site.example?tenant=a",
    });

    expect(resolution).toMatchObject({
      url: "https://site.example/about?tenant=b",
    });
  });

  it("still resolves a site URL with no query at all", () => {
    const resolution = resolvePreviewUrl({
      preview: { urlTemplate: "/{slug}" },
      entry: { slug: "about" },
      siteUrl: "https://site.example",
    });

    expect(resolution).toMatchObject({ url: "https://site.example/about" });
  });
});
