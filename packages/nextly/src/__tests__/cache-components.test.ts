/**
 * Nextly warns about an app with Next.js Cache Components on, where the
 * setting can be read: in `withNextly()` while Next.js loads the config, and in
 * `createRegister()` before the server serves a request. A warning, not a
 * refusal: such an app is unsupported, not known to be broken.
 *
 * The second reads the value Next.js inlines into the app's own
 * `instrumentation.ts`. That name is an undocumented Next.js internal, so the
 * last case pins it to the installed Next.js: a release that renames it fails
 * here, loudly, instead of the startup warning going quiet.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { createRegister, shutdownNextly } from "../init";
import { withNextly } from "../next";

const WARNING =
  /Cache Components isn't supported by Nextly yet.*turn it off.*cacheComponents: false.*partialPrefetching.*nextlyhq\.com\/docs\/getting-started\/installation#cache-components/s;

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/** Every warning printed so far, as one string. */
const warned = () => warn.mock.calls.map(call => String(call[0])).join("\n");

describe("withNextly and Cache Components", () => {
  it("warns about a config with Cache Components on, with the way out and where it is explained", () => {
    const wrapped = withNextly<Record<string, unknown>>({
      cacheComponents: true,
    });
    expect(warned()).toMatch(WARNING);
    // Still a working config: the warning stops nothing.
    expect(wrapped.serverExternalPackages).toContain("nextly");
  });

  it("says nothing for a config with it off, or with no setting", () => {
    withNextly({ cacheComponents: false });
    withNextly({});
    expect(warned()).not.toMatch(/Cache Components/);
  });
});

describe("createRegister and Cache Components", () => {
  const config = {} as SanitizedNextlyConfig;
  afterAll(async () => {
    await shutdownNextly();
  });

  it("warns when Next.js inlined Cache Components as on, and still starts", async () => {
    await createRegister(config, { cacheComponents: "true" })();
    expect(warned()).toMatch(WARNING);
  });

  it("says nothing when Next.js inlined it as off or not at all", async () => {
    await createRegister(config, { cacheComponents: "false" })();
    await createRegister(config)();
    expect(warned()).not.toMatch(/Cache Components/);
  });
});

describe("the value Next.js inlines for Cache Components", () => {
  it("is still `process.env.__NEXT_CACHE_COMPONENTS` in the installed Next.js", () => {
    const require = createRequire(import.meta.url);
    const next = dirname(require.resolve("next/package.json"));
    const defineEnv = readFileSync(
      join(next, "dist", "build", "define-env.js"),
      "utf8"
    );
    expect(defineEnv).toContain(
      "'process.env.__NEXT_CACHE_COMPONENTS': isCacheComponentsEnabled"
    );
  });
});
