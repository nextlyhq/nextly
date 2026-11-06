/**
 * A block calling `useBlockEnvironment()` renders on the server.
 *
 * Block code renders the published site too, where there is no document or
 * window. Run in the node environment, where neither global exists, so an
 * implementation that read `window` or `document` during render throws a
 * reference error here, and one that answered anything but `undefined` is
 * seen in the markup.
 *
 * Separately, the published entry carries the client directive: the module
 * creates a React context, which a server component graph cannot do, so a Next
 * host given the file without it would fail every page drawing such a block.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useBlockEnvironment } from "./environment";

/** A block that says whether it was given an environment. */
function MeasuringBlock(): React.JSX.Element {
  const environment = useBlockEnvironment();
  return (
    <div data-environment={environment === undefined ? "none" : "present"} />
  );
}

describe("useBlockEnvironment on the server", () => {
  it("has no document or window to read, in this environment", () => {
    // The control: without it, a jsdom default would make the test below
    // pass for the wrong reason.
    expect("document" in globalThis).toBe(false);
    expect("window" in globalThis).toBe(false);
  });

  it("renders a block calling it, answering nothing", () => {
    expect(renderToString(<MeasuringBlock />)).toContain(
      'data-environment="none"'
    );
  });
});

describe("the published environment entry", () => {
  it("starts with the client directive", () => {
    const built = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "dist",
      "environment.mjs"
    );
    expect(readFileSync(built, "utf8").trimStart()).toMatch(
      /^["']use client["'];/
    );
  });
});
