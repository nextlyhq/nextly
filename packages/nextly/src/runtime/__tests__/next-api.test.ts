/**
 * The one way nextly reaches a Next.js API: an API the installed Next.js lacks
 * fails naming the supported range, and only Next.js not being installed at all
 * reads as running outside a Next.js app.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { supportedFrameworkRanges } from "../framework-versions";
import {
  isMissingFromChain,
  loadNextModule,
  NEXT_NAVIGATION_SERVER_ENTRY,
  requireNextApi,
  requireNextNavigation,
} from "../next-api";

/** Node's error for `specifier` not being installed, as `require` throws it. */
function notInstalled(specifier: string): Error {
  return Object.assign(
    new Error(`Cannot find module '${specifier}'\nRequire stack:\n- /app/x.js`),
    { code: "MODULE_NOT_FOUND" }
  );
}

describe("requireNextApi", () => {
  it("hands back the API the module exports", () => {
    const after = () => undefined;
    expect(requireNextApi({ after }, "next/server", "after")).toBe(after);
  });

  it("refuses a module with the API stubbed out, naming the supported range", () => {
    expect(() =>
      requireNextApi(
        { unstable_after: () => undefined },
        "next/server",
        "after"
      )
    ).toThrow(
      expect.objectContaining({
        code: "CONFIGURATION_ERROR",
        logMessage: expect.stringContaining(
          `next/server has no after, which nextly uses: install next ${supportedFrameworkRanges().next}`
        ),
      })
    );
  });
});

describe("loadNextModule", () => {
  it("answers the module's exports when it loads", () => {
    const mod = { unstable_cache: () => undefined };
    expect(loadNextModule("next/cache", () => mod)).toBe(mod);
  });

  it("answers null when Next.js itself is not installed", () => {
    expect(
      loadNextModule("next/cache", () => {
        throw notInstalled("next/cache");
      })
    ).toBeNull();
  });

  it("rethrows a module missing deeper inside Next.js", () => {
    const deeper = notInstalled("next/dist/server/lib/incremental-cache");
    expect(() =>
      loadNextModule("next/cache", () => {
        throw deeper;
      })
    ).toThrow(deeper);
  });

  it("rethrows any other failure to load it", () => {
    const broken = new SyntaxError("Unexpected token");
    expect(() =>
      loadNextModule("next/cache", () => {
        throw broken;
      })
    ).toThrow(broken);
  });
});

describe("isMissingFromChain", () => {
  it("is a module the entry requires being missing, the entry itself found", () => {
    expect(
      isMissingFromChain(
        notInstalled(
          "next/dist/server/route-modules/pages/vendored/contexts/app-router-context"
        ),
        "next/navigation"
      )
    ).toBe(true);
  });

  it("is not the entry itself being missing", () => {
    expect(
      isMissingFromChain(notInstalled("next/navigation"), "next/navigation")
    ).toBe(false);
  });

  it("is not any other failure", () => {
    expect(
      isMissingFromChain(new SyntaxError("Unexpected token"), "next/navigation")
    ).toBe(false);
  });
});

/**
 * On the server nextly loads Next's server build of `next/navigation`, which
 * reaches none of the client contexts that, through Next's require hook, pull
 * in the pages router's runtime. Held to the installed Next.js: a release that
 * moves the file or drops one of the APIs nextly calls fails here rather than
 * falling back unnoticed.
 */
describe("requireNextNavigation", () => {
  const require = createRequire(import.meta.url);

  it("loads Next's server build, which has every navigation API nextly calls", () => {
    const serverBuild = require(NEXT_NAVIGATION_SERVER_ENTRY) as Record<
      string,
      unknown
    >;
    expect(requireNextNavigation()).toBe(serverBuild);
    for (const name of ["notFound", "permanentRedirect", "unstable_rethrow"]) {
      expect(typeof serverBuild[name]).toBe("function");
    }
  });

  it("is what loadNextModule answers for next/navigation", () => {
    expect(loadNextModule("next/navigation")).toBe(
      require(NEXT_NAVIGATION_SERVER_ENTRY)
    );
  });
});
