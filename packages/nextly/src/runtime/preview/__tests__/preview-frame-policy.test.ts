/**
 * Whether the preview session reaches a frame.
 *
 * The cases that matter are the two directions of error, and they do not cost
 * the same. Answering `true` wrongly puts a frame on screen that renders the
 * PUBLISHED page under a draft caption — the silent wrong answer the whole gate
 * exists to prevent. Answering `false` wrongly costs a new tab, which works
 * everywhere. So the deliberate refusals below are asserted as decisions, with
 * the reason they are the affordable error.
 */
import { describe, expect, it } from "vitest";

import {
  PREVIEW_COOKIE_SAME_SITE,
  previewSessionReachesFrame,
} from "../preview-frame-policy";

describe("the preview cookie's policy", () => {
  it("is Lax, which is what makes the frame question a same-site question", () => {
    /*
     * Stated once, here, because everything below reasons FROM it: a `Lax`
     * cookie is withheld from a nested cross-site navigation, so "does the
     * session reach the frame" is exactly "is the frame same-site". The route's
     * own test asserts its `Set-Cookie` against this constant rather than
     * against a literal, so the two cannot drift apart.
     */
    expect(PREVIEW_COOKIE_SAME_SITE).toBe("Lax");
  });
});

describe("previewSessionReachesFrame", () => {
  it("carries the session to a frame on the same origin", () => {
    expect(
      previewSessionReachesFrame(
        "https://site.example/preview?token=t",
        "https://site.example"
      )
    ).toBe(true);
  });

  it("ignores the port, because same-site does", () => {
    // A contributor on :3000 previewing a site on :3100. Cookies are not
    // port-scoped and neither is same-site, so the session does reach it.
    expect(
      previewSessionReachesFrame(
        "http://localhost:3100/preview?token=t",
        "http://localhost:3000"
      )
    ).toBe(true);
  });

  it("refuses across schemes, because browsers apply schemeful same-site", () => {
    expect(
      previewSessionReachesFrame(
        "https://site.example/preview?token=t",
        "http://site.example"
      )
    ).toBe(false);
  });

  it("refuses an unrelated host", () => {
    expect(
      previewSessionReachesFrame(
        "https://site.example/preview?token=t",
        "https://admin.elsewhere.test"
      )
    ).toBe(false);
  });

  it("refuses a SUBDOMAIN split it cannot prove, rather than guessing", () => {
    /*
     * `admin.example.com` and `example.com` ARE same-site, so `true` would be
     * the correct answer and this is a deliberate miss. Deciding it needs a
     * public-suffix list — `foo.github.io` and `bar.github.io` share a suffix
     * and are NOT same-site, and no rule over the label structure alone
     * separates the two shapes. Without that list the only sound direction is
     * to refuse, because the wrong `true` is the silent one.
     *
     * This test exists so the limit is a recorded decision rather than an
     * oversight: whoever adds the list should expect to change it.
     */
    expect(
      previewSessionReachesFrame(
        "https://example.com/preview?token=t",
        "https://admin.example.com"
      )
    ).toBe(false);
  });

  it("refuses when there is no address to frame", () => {
    // A site URL that is unset or unparseable reaches here as null. A different
    // reason from a cross-site one, and the same answer to this question.
    expect(previewSessionReachesFrame(null, "https://site.example")).toBe(
      false
    );
  });

  it("refuses an unparseable address or origin rather than throwing", () => {
    expect(
      previewSessionReachesFrame("not a url", "https://site.example")
    ).toBe(false);
    // An opaque origin serialises as the STRING "null", which is not a URL.
    expect(
      previewSessionReachesFrame("https://site.example/preview", "null")
    ).toBe(false);
  });

  it("refuses a scheme with no cookie behaviour worth reasoning about", () => {
    /*
     * Two `file:` URLs would otherwise compare equal on an empty hostname and
     * an equal protocol, which is `true` reached by an accident of the
     * comparison rather than by anything about cookies.
     */
    expect(
      previewSessionReachesFrame("file:///tmp/a.html", "file:///tmp")
    ).toBe(false);
  });
});
