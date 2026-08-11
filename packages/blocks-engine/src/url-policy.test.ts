/**
 * Which remote hosts a pattern admits.
 *
 * The cases here are the ones where the answer is surprising, and the surprise
 * is deliberate: this type exists so an entry copied out of `next.config` behaves
 * the same, so its rules are `next/image`'s rules rather than the friendlier
 * ones. A test that only covered the obvious matches would leave the next reader
 * free to "fix" the surprising behaviour and quietly widen every site's policy.
 */
import { describe, expect, it } from "vitest";

import { isAllowedRemoteUrl, isFetchableUrl, isRemoteUrl } from "./url-policy";

describe("a URL used as a pattern", () => {
  // `next/image`'s `matchRemotePattern` takes `RemotePattern | URL` and applies
  // the same `!== undefined` tests to both. A `URL` answers `""` for a port and
  // a search it does not have, and `"" !== undefined`, so those tests RUN for a
  // URL and are skipped for the object spelling that omits them.
  const asUrl = [new URL("https://cdn.example/img/**")];
  const asObject = [
    {
      protocol: "https" as const,
      hostname: "cdn.example",
      pathname: "/img/**",
    },
  ];

  it("admits the plain case either way", () => {
    // The control. Without it every assertion below could pass because the
    // matcher rejects everything.
    expect(isAllowedRemoteUrl("https://cdn.example/img/a.png", asUrl)).toBe(
      true
    );
    expect(isAllowedRemoteUrl("https://cdn.example/img/a.png", asObject)).toBe(
      true
    );
  });

  it("refuses a query string that the object spelling admits", () => {
    // A `URL` carries `search: ""`, which means "exactly no query", while the
    // object omits `search`, which means "any query". Cache-busting an image as
    // `?v=2` is the everyday way to meet this.
    expect(isAllowedRemoteUrl("https://cdn.example/img/a.png?v=2", asUrl)).toBe(
      false
    );
    expect(
      isAllowedRemoteUrl("https://cdn.example/img/a.png?v=2", asObject)
    ).toBe(true);
  });

  it("refuses a non-default port that the object spelling admits", () => {
    // Same shape one field over: `port: ""` means the default port only.
    expect(
      isAllowedRemoteUrl("https://cdn.example:8443/img/a.png", asUrl)
    ).toBe(false);
    expect(
      isAllowedRemoteUrl("https://cdn.example:8443/img/a.png", asObject)
    ).toBe(true);
  });

  it("matches the object spelling that states the same fields", () => {
    // Which is what shows the difference is about the FIELDS being present, not
    // about the input being a `URL`.
    const explicit = [
      {
        protocol: "https" as const,
        hostname: "cdn.example",
        port: "",
        pathname: "/img/**",
        search: "",
      },
    ];
    for (const candidate of [
      "https://cdn.example/img/a.png",
      "https://cdn.example/img/a.png?v=2",
      "https://cdn.example:8443/img/a.png",
    ]) {
      expect(isAllowedRemoteUrl(candidate, explicit)).toBe(
        isAllowedRemoteUrl(candidate, asUrl)
      );
    }
  });
});

describe("what counts as reaching another host", () => {
  it("treats a scheme-less protocol-relative url as remote", () => {
    // It carries no scheme and still reaches somewhere else, inheriting only
    // the page's protocol. A check reading "no scheme, therefore this origin"
    // is wrong about exactly this value.
    expect(isRemoteUrl("//cdn.example/a.png")).toBe(true);
    expect(isRemoteUrl("/a.png")).toBe(false);
    expect(isRemoteUrl("a.png")).toBe(false);
  });

  it("reads a backslash the way the parser does", () => {
    // Backslashes are read as slashes for http(s), so this reaches another host
    // while beginning with neither `//` nor a scheme.
    expect(isRemoteUrl("/\\evil.example/a.png")).toBe(true);
  });

  it("refuses a protocol-relative url outright when fetching", () => {
    // Its scheme is the DOCUMENT's, which is not knowable at compile time.
    // Assuming https once admitted a value against an https-only pattern on a
    // page that then fetched it over http.
    expect(
      isFetchableUrl("//cdn.example/img/a.png", [
        { protocol: "https", hostname: "cdn.example" },
      ])
    ).toBe(false);
    // An author who wants that host writes the scheme, and then it matches.
    expect(
      isFetchableUrl("https://cdn.example/img/a.png", [
        { protocol: "https", hostname: "cdn.example" },
      ])
    ).toBe(true);
  });

  it("leaves a same-origin path alone whatever the patterns say", () => {
    // The list bounds where a page reaches OUT to. A path names no host, so an
    // empty list must not blank a site's own images.
    expect(isFetchableUrl("/uploads/a.png", [])).toBe(true);
    expect(isFetchableUrl("a.png", [])).toBe(true);
    // And an empty list really is a policy: it admits no remote host at all.
    expect(isFetchableUrl("https://cdn.example/a.png", [])).toBe(false);
  });
});
