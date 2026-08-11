import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

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

// jsdom implements no media queries at all, and next-themes calls matchMedia
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
