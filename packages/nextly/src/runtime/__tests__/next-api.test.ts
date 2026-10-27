/**
 * The one way nextly reaches a Next.js API: an API the installed Next.js lacks
 * fails naming the supported range, and only Next.js not being installed at all
 * reads as running outside a Next.js app.
 */
import { describe, expect, it } from "vitest";

import { SUPPORTED_FRAMEWORK_RANGES } from "../framework-versions";
import { loadNextModule, requireNextApi } from "../next-api";

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
          `next/server has no after, which nextly uses: install next ${SUPPORTED_FRAMEWORK_RANGES.next}`
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
