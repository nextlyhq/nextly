/**
 * A Card and a Button on a site that hides its unused built-in colours.
 *
 * Hiding is the Design panel's and the colour pickers' alone. Both blocks
 * read built-in colours from their own default styles (the Card its surface
 * and border, the Button primary and background), so the page must draw
 * them exactly as before: every built-in colour still declared, each block
 * still reading it, the markup byte for byte the same.
 */
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockDocument, SiteTokenSet } from "@nextlyhq/blocks-engine";

import { button } from "./blocks/button";
import { card } from "./blocks/card";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const DOC: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "card",
      type: "core/card",
      version: 1,
      props: {},
    },
    {
      id: "button",
      type: "core/button",
      version: 1,
      props: { label: "Get started", href: "/signup" },
    },
  ],
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

/** The page as a route streams it, once every part of it is ready. */
async function html(tokens: SiteTokenSet): Promise<string> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={DOC}
      blocks={createBlockResolver([card, button])}
      styleContext={{ breakpoints: BREAKPOINTS }}
      siteStyles={{ breakpoints: BREAKPOINTS, tokens }}
    />,
    {
      onError(error) {
        throw error;
      },
    }
  );
  await stream.allReady;
  return await new Response(stream).text();
}

describe("a Card and a Button while the built-in colours are hidden", () => {
  const hidden = (): Promise<string> =>
    html({ tokens: [], builtInColoursShown: false });

  it("still declares the built-in colours they read, and they still read them", async () => {
    const page = await hidden();
    for (const colour of ["surface", "border", "primary", "background"]) {
      expect(page).toContain(`--site-color-${colour}:`);
      expect(page).toContain(`var(--site-color-${colour})`);
    }
    expect(page).toContain("Get started");
  });

  it("draws the page byte for byte as with the built-in colours shown", async () => {
    const page = await hidden();
    expect(page).toBe(await html({ tokens: [] }));
    expect(page).toBe(await html({ tokens: [], builtInColoursShown: true }));
  });
});
