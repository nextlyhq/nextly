// @vitest-environment jsdom
/**
 * Every error boundary a template ships, rendered and clicked: its one button
 * calls the `retry` Next.js hands it. `retry()` fetches the failed segment
 * again, so a transient server failure can recover from the button; the
 * browser test proves that on a playground boundary, and this ties the
 * shipped ones to it, so a button wired to anything else fails here.
 */
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// From the file's own folder: under jsdom, `URL` is jsdom's, which
// `fileURLToPath` refuses.
const TEMPLATES = resolve(import.meta.dirname, "../../../../templates");

/** Every `error.tsx` and `global-error.tsx` under the templates. */
function boundaryFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : boundaryFiles(path);
    }
    return /^(?:global-)?error\.tsx$/.test(entry.name) ? [path] : [];
  });
}

const boundaries = boundaryFiles(TEMPLATES).map(path =>
  relative(TEMPLATES, path)
);

type Boundary = ComponentType<{ error: Error; retry: () => void }>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("template error boundaries", () => {
  it("are found where the blog ships them", () => {
    // Without this, a walk that found nothing would pass every case below.
    expect(boundaries).toEqual(
      expect.arrayContaining([
        "blog/src/app/(frontend)/error.tsx",
        "blog/src/app/error.tsx",
        "blog/src/app/global-error.tsx",
      ])
    );
  });

  it.each(boundaries)("%s retries from its button", async file => {
    // Each boundary logs the error it was given, and `global-error` renders
    // its own <html>, which React reports inside a test container.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: Boundary } = (await import(join(TEMPLATES, file))) as {
      default: Boundary;
    };
    const retry = vi.fn();

    render(
      createElement(Boundary, { error: new Error("render failed"), retry })
    );
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
