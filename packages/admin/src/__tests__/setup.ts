import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

// jest-dom's matchers, registered on the `expect` these tests import.
//
// Not through `@testing-library/jest-dom/vitest`, which registers them from
// inside jest-dom on whichever vitest resolves from jest-dom's own folder. The
// workspace installs vitest once per `@types/node` peer, so that is a second
// copy, not the one running these tests, and on Vitest 5 extending its `expect`
// breaks `rejects` here: `await expect(Promise.reject(new Error("boom")))
// .rejects.toThrow("boom")` fails with "got ''". The matchers entry imports
// no vitest at all.
expect.extend(jestDomMatchers);

// Their types, on the interface Vitest 5 reads custom matchers from.
// jest-dom's own declarations augment `Assertion<T>`, Vitest 4's shape, which no
// longer merges with Vitest 5's `Assertion<R, T>`.
declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}

// Unit tests have no network. A request no test stubbed is refused at once,
// as a server that is not there would refuse it, rather than sent: jsdom sends
// it to localhost:3000, where whatever happens to be listening answers, and a
// refusal that arrives after the file has finished is logged during Vitest's
// teardown, which fails a run whose every test passed
// (`EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
// pending`). A test that needs a response replaces `fetch` itself, as before.
globalThis.fetch = ((input: RequestInfo | URL) =>
  Promise.reject(
    new TypeError(`unit tests have no network: ${String(input)}`)
  )) as typeof fetch;

// Mock ResizeObserver for Radix UI components
global.ResizeObserver = class ResizeObserver {
  observe() {
    // do nothing
  }
  unobserve() {
    // do nothing
  }
  disconnect() {
    // do nothing
  }
};

// Pointer capture and scroll-into-view, for the same reason. jsdom implements
// neither, and Radix calls both when a Select opens, so without these any test
// that opens one dies on `hasPointerCapture is not a function` rather than
// failing an assertion. Defined here rather than per file because there is no
// behaviour to preserve: the methods are absent, not merely unimplemented.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.scrollIntoView = () => undefined;

// jsdom implements no media queries at all, and the theme provider calls matchMedia
// while mounting, so a provider test dies on `matchMedia is not a function`
// before reaching an assertion. This stub always answers "no match", which
// means the OS reports light: a test about SYSTEM theme resolution must set up
// its own matchMedia rather than trust this one, or it passes for the wrong
// reason. Tests that pin explicit modes should force the theme instead.
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Cleanup after each test
afterEach(() => {
  cleanup();
});
