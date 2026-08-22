/**
 * The host-fetch policy, read back from the wire.
 *
 * The claim this file exists to hold up is a ROUND TRIP: what the plugin
 * publishes onto `clientConfig` can be read back in the browser into a
 * predicate that answers the same way the published compiler does. Testing the
 * two helpers alone would pass on a build where the plugin published nothing,
 * which was the state before this change — the value was on the wire and no
 * surface read it.
 *
 * ## What this file does NOT cover
 *
 * The three JSX assignments in `BlocksField` — `hostPolicy` onto the canvas,
 * `policy` onto the inspector, and the `useMemo` that derives them. This
 * package has no React test environment (vitest runs `environment: "node"`,
 * there is no `@testing-library/react`, and no `.test.tsx` file exists here),
 * so a mount would mean standing up jsdom, a form context and a branding
 * provider inside a change that already spans three packages. Stated rather
 * than left for a reader to assume: the derivation is covered, the wiring is
 * covered on the builder side where a harness exists, and the prop assignment
 * itself is read by review.
 */
import { isFetchableUrl } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { hostFetchPolicy, readRemotePatterns } from "./host-policy";
import { pageBuilder } from "./plugin";

/** What the plugin factory puts in front of the browser. */
function publishedConfig(
  options: Parameters<typeof pageBuilder>[0]
): Record<string, unknown> | undefined {
  return pageBuilder(options).contributes?.admin?.clientConfig;
}

describe("readRemotePatterns", () => {
  it("answers undefined for a site that declared nothing, so it stays unasked", () => {
    // The distinction the whole module turns on. `undefined` reaches the canvas
    // and the inspector as an absent policy, which is what leaves a site that
    // never configured a host list exactly as permissive as it is today.
    expect(readRemotePatterns(undefined)).toBeUndefined();
  });

  it("answers an EMPTY list for a value that is present and unreadable", () => {
    // Not `undefined`, which would be "nobody asked" and would let every remote
    // URL through. A host that stated something this build cannot parse gets
    // the closed reading, and the observable failure is remote images
    // disappearing from the canvas rather than a policy silently switching off.
    expect(readRemotePatterns("cdn.example")).toEqual([]);
    expect(readRemotePatterns({ hostname: "cdn.example" })).toEqual([]);
    expect(readRemotePatterns(null)).toEqual([]);
  });

  it("keeps the entries it can read and drops the ones it cannot", () => {
    expect(
      readRemotePatterns([
        { hostname: "cdn.example" },
        "not-a-pattern",
        { protocol: "https" },
        { hostname: "img.example", protocol: "https", port: "8443" },
      ])
    ).toEqual([
      { hostname: "cdn.example" },
      { hostname: "img.example", protocol: "https", port: "8443" },
    ]);
  });

  it("refuses an entry whose CONSTRAINT is malformed rather than widening it", () => {
    // The direction that matters. `isAllowedRemoteUrl` reads an omitted
    // `pathname` as `**`, so dropping a malformed one would turn a pattern
    // naming one directory into one naming the whole host — the client would
    // then accept URLs the published page refuses. Every optional field is a
    // constraint and behaves the same way.
    for (const bad of [
      { hostname: "cdn.example", pathname: 5 },
      { hostname: "cdn.example", port: 8443 },
      { hostname: "cdn.example", search: ["a=1"] },
      { hostname: "cdn.example", protocol: "ftp" },
    ]) {
      expect(readRemotePatterns([bad])).toEqual([]);
    }
  });

  it("ignores a key it does not know, because the matcher ignores it too", () => {
    // `isAllowedRemoteUrl` reads protocol, port, hostname, search and pathname
    // and nothing else, so an unknown key constrains nothing on the server
    // either. Refusing over one would reject a pattern the published page
    // honours, which is the opposite failure from the case above.
    expect(
      readRemotePatterns([{ hostname: "cdn.example", sizes: [640] }])
    ).toEqual([{ hostname: "cdn.example" }]);
  });
});

describe("hostFetchPolicy", () => {
  it("withholds the predicate entirely when there are no patterns", () => {
    // An absent key rather than `mayFetchUrl: undefined`, because consumers
    // spread this and the engine documents absence as "the question was never
    // asked".
    expect(hostFetchPolicy(undefined)).toEqual({});
    expect("mayFetchUrl" in hostFetchPolicy(undefined)).toBe(false);
  });

  it("answers exactly as the engine's own matcher does", () => {
    const patterns = [{ hostname: "cdn.example", protocol: "https" }] as const;
    const { mayFetchUrl } = hostFetchPolicy(patterns);

    // Compared against `isFetchableUrl` rather than against hand-written
    // expectations, because agreeing with the engine IS the property — a
    // hand-written table would be a second definition of the rule and could
    // drift from the compiler this is supposed to match.
    for (const url of [
      "https://cdn.example/a.png",
      "http://cdn.example/a.png",
      "https://evil.example/a.png",
      "/local.png",
      "//cdn.example/a.png",
    ]) {
      expect(mayFetchUrl?.(url)).toBe(isFetchableUrl(url, patterns));
    }
  });

  it("refuses every remote URL under the empty list an unreadable value produces", () => {
    // The two halves joined: a malformed config narrows to `[]`, and `[]` is a
    // real closed policy rather than an absent one.
    const { mayFetchUrl } = hostFetchPolicy(readRemotePatterns("nonsense"));

    expect(mayFetchUrl).toBeDefined();
    expect(mayFetchUrl?.("https://cdn.example/a.png")).toBe(false);
    // Relative paths survive, which is what locally-uploaded media is, so the
    // closed reading does not blank the canvas.
    expect(mayFetchUrl?.("/uploads/a.png")).toBe(true);
  });
});

describe("the round trip from the plugin factory to a verdict", () => {
  it("publishes the patterns where the browser can read them back", () => {
    const config = publishedConfig({
      remotePatterns: [{ hostname: "cdn.example", protocol: "https" }],
    });

    // The step that was missing. The value being ON the wire was already true
    // before this change; that nothing read it is what made the canvas and the
    // inspector permissive while the published page was strict.
    const patterns = readRemotePatterns(config?.remotePatterns);
    const { mayFetchUrl } = hostFetchPolicy(patterns);

    expect(mayFetchUrl?.("https://cdn.example/a.png")).toBe(true);
    expect(mayFetchUrl?.("https://evil.example/a.png")).toBe(false);
  });

  it("leaves a host that configured nothing with no policy at all", () => {
    // Not the empty list. A site that never opted in must keep rendering every
    // remote image it renders today, on the canvas and on the page alike.
    const config = publishedConfig({ checklist: false });

    expect(config?.remotePatterns).toBeUndefined();
    expect(readRemotePatterns(config?.remotePatterns)).toBeUndefined();
    expect(hostFetchPolicy(readRemotePatterns(config?.remotePatterns))).toEqual(
      {}
    );
  });

  it("agrees with the policy the Site Style write gate was given", () => {
    // Both sides of the wire derive from ONE function now, where the server
    // previously had a private copy. This is what makes "a class refused on the
    // canvas and served from the site sheet" unreachable rather than merely
    // unobserved.
    const declared = [{ hostname: "cdn.example" }] as const;
    const server = hostFetchPolicy(declared);
    const browser = hostFetchPolicy(
      readRemotePatterns(
        publishedConfig({ remotePatterns: declared })?.remotePatterns
      )
    );

    for (const url of [
      "https://cdn.example/a.png",
      "https://evil.example/a.png",
      "/local.png",
    ]) {
      expect(browser.mayFetchUrl?.(url)).toBe(server.mayFetchUrl?.(url));
    }
  });
});
