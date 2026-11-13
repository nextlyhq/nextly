/**
 * A not-found page and a permanent redirect reach Next.js however
 * `next/navigation` loads.
 *
 * A deployment whose trace left out a module `next/navigation` requires (a
 * Next.js site deployed on Vercel, where Next's require hook sends it on to
 * files no trace names) answered every unknown address with a 500: the
 * require threw, and so did `notFound()`. There the helpers now throw Next's
 * own errors, built by digest; where Next.js is not installed at all they
 * still refuse, since there is no response to answer. The errors built are
 * held to the installed Next.js's own checks and to what its own helpers
 * throw, so a change to the digest format fails here.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { notFoundFrom, permanentRedirectFrom } from "../not-found";

/** Node's error for `missing` not being found, as `require` throws it. */
function moduleNotFound(missing: string): Error {
  return Object.assign(
    new Error(
      `Cannot find module '${missing}'\nRequire stack:\n- /var/task/node_modules/next/dist/client/components/navigation.js`
    ),
    { code: "MODULE_NOT_FOUND" }
  );
}

/** A loader whose `next/navigation` fails with `error`. */
const failingWith = (error: Error) => () => {
  throw error;
};

/** A deployment missing a file `next/navigation` requires. */
const incomplete = failingWith(
  moduleNotFound(
    "next/dist/server/route-modules/pages/vendored/contexts/app-router-context"
  )
);

/** What calling `fn` threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

const require = createRequire(import.meta.url);
const nextNavigation = require("next/navigation") as {
  notFound: () => never;
  permanentRedirect: (url: string) => never;
};
const { isHTTPAccessFallbackError, getAccessFallbackHTTPStatus } =
  require("next/dist/client/components/http-access-fallback/http-access-fallback") as {
    isHTTPAccessFallbackError: (error: unknown) => boolean;
    getAccessFallbackHTTPStatus: (error: unknown) => number;
  };
const { isRedirectError } =
  require("next/dist/client/components/redirect-error") as {
    isRedirectError: (error: unknown) => boolean;
  };
const { getURLFromRedirectError, getRedirectStatusCodeFromError } =
  require("next/dist/client/components/redirect") as {
    getURLFromRedirectError: (error: unknown) => string | null;
    getRedirectStatusCodeFromError: (error: unknown) => number;
  };

describe("notFoundFrom", () => {
  it("uses Next's own notFound when next/navigation loads", () => {
    const notFound = () => {
      throw new Error("next's own");
    };
    const trigger = notFoundFrom(() => ({ notFound }));
    expect(trigger).toBe(notFound);
  });

  it("throws Next's not-found error by digest when a module next/navigation requires is missing", () => {
    const error = thrown(notFoundFrom(incomplete));
    expect(isHTTPAccessFallbackError(error)).toBe(true);
    expect(getAccessFallbackHTTPStatus(error)).toBe(404);
    // What Next's own notFound() throws, digest for digest.
    const own = thrown(nextNavigation.notFound) as { digest: string };
    expect(error).toMatchObject({ digest: own.digest });
  });

  it("refuses where Next.js is not installed at all", () => {
    const trigger = notFoundFrom(
      failingWith(moduleNotFound("next/navigation"))
    );
    expect(thrown(trigger)).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("rethrows any other failure to load next/navigation", () => {
    const broken = new SyntaxError("Unexpected token");
    expect(() => notFoundFrom(failingWith(broken))).toThrow(broken);
  });
});

describe("permanentRedirectFrom", () => {
  it("uses Next's own permanentRedirect when next/navigation loads", () => {
    const permanentRedirect = (_url: string): never => {
      throw new Error("next's own");
    };
    expect(permanentRedirectFrom(() => ({ permanentRedirect }))).toBe(
      permanentRedirect
    );
  });

  it("throws Next's 308 redirect by digest when a module next/navigation requires is missing", () => {
    const error = thrown(() =>
      permanentRedirectFrom(incomplete)("/blog/a;b?page=2")
    );
    expect(isRedirectError(error)).toBe(true);
    expect(getURLFromRedirectError(error)).toBe("/blog/a;b?page=2");
    expect(getRedirectStatusCodeFromError(error)).toBe(308);
    // What Next's own permanentRedirect() throws, digest for digest.
    const own = thrown(() =>
      nextNavigation.permanentRedirect("/blog/a;b?page=2")
    ) as {
      digest: string;
    };
    expect(error).toMatchObject({ digest: own.digest });
  });

  it("refuses where Next.js is not installed at all", () => {
    const redirect = permanentRedirectFrom(
      failingWith(moduleNotFound("next/navigation"))
    );
    expect(thrown(() => redirect("/blog"))).toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
