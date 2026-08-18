/**
 * The one place this package reaches for sharp.
 *
 * It is an optional peer dependency, so it can be absent at runtime while the
 * code that uses it is compiled and registered. What matters here is that the
 * absence arrives as a value the caller can act on rather than as an exception
 * every call site has to catch.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  SHARP_INSTALL_COMMAND,
  isSharpAvailable,
  loadSharp,
  setSharp,
} from "../sharp-loader";

afterEach(() => setSharp(null));

describe("the sharp loader", () => {
  it("names a command a user can actually run", () => {
    expect(SHARP_INSTALL_COMMAND).toContain("sharp");
    expect(SHARP_INSTALL_COMMAND).toMatch(/install|add/);
  });

  it("finds the library here, where it stays a devDependency", () => {
    // The repository keeps testing against the real library after it stops
    // being shipped to users. A false here would mean the image suites are
    // silently exercising nothing.
    expect(isSharpAvailable()).toBe(true);
  });

  it("loads a callable image factory", async () => {
    const sharp = await loadSharp();

    // Asserting the CALLABLE rather than a shape: sharp is published as
    // CommonJS, so which interop form arrives depends on the host's bundler.
    expect(typeof sharp).toBe("function");
  });

  it("prefers an injected module over resolution", async () => {
    const injected = (() => ({})) as unknown as Parameters<typeof setSharp>[0];
    setSharp(injected);

    expect(await loadSharp()).toBe(injected);
  });

  it("reports availability once a module is injected", () => {
    const injected = (() => ({})) as unknown as Parameters<typeof setSharp>[0];
    setSharp(injected);

    expect(isSharpAvailable()).toBe(true);
  });

  it("returns null rather than throwing when it cannot be had", async () => {
    // The caller decides what a missing library means: an upload degrades, a
    // thumbnail is skipped. Throwing would force every call site into a
    // try/catch and invite one of them to report the wrong cause.
    setSharp(null);

    await expect(loadSharp({ resolver: () => null })).resolves.toBeNull();
  });

  it("returns null when resolution throws", async () => {
    setSharp(null);

    await expect(
      loadSharp({
        resolver: () => {
          throw new Error("ERR_MODULE_NOT_FOUND");
        },
      })
    ).resolves.toBeNull();
  });

  it("survives a namespace that throws on unknown exports", async () => {
    setSharp(null);
    const real = (() => ({})) as unknown as Parameters<typeof setSharp>[0];

    // A module namespace is not always a plain object: a test double or a
    // bundler shim can be a proxy that throws on reading a name it was not
    // given. This asserts the loader never puts such a namespace into a state
    // where it reads one, whichever order the two shapes are tried in.
    const namespace = new Proxy(
      { default: real },
      {
        get(target, prop) {
          if (prop === "default") return target.default;
          // `then` and the tag are how a value is AWAITED and printed, and no
          // real namespace refuses them. Throwing on those would model a value
          // that cannot be awaited at all, which is a different failure from
          // the one under test.
          if (prop === "then" || typeof prop === "symbol") return undefined;
          throw new Error(`No "${String(prop)}" export is defined`);
        },
      }
    );

    await expect(loadSharp({ resolver: () => namespace })).resolves.toBe(real);
  });
});
