// @vitest-environment node

/**
 * The canvas frame rendered on the server, as a host's server can render a
 * client component before the browser hydrates it.
 *
 * The server cannot know the editor's origin, so it must not choose between a
 * site's page and the blank page: whatever it chose, the browser's first render
 * has to produce the same markup, or hydration leaves the frame on a page that
 * was never asked for.
 *
 * @module canvas-frame-server.test
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasFrame, type SiteFrameSource } from "./canvas-frame";

const SITE: SiteFrameSource = {
  src: "/canvas",
  served: () => false,
  ready: () => false,
  mountPoint: () => null,
  watch: () => () => undefined,
};

describe("the canvas frame on the server", () => {
  it("chooses no page for a site source, so the browser's first render matches", () => {
    const markup = renderToString(
      <CanvasFrame width={1280} title="Home" source={SITE} />
    );
    const frame = /<iframe[^>]*>/.exec(markup)?.[0] ?? "";
    expect(frame, "the frame is rendered").not.toBe("");
    // Neither the blank page nor the site's: the browser picks once it knows
    // which origin the editor is on.
    expect(frame).not.toMatch(/srcdoc=/i);
    expect(frame).not.toMatch(/\ssrc=/i);
  });

  it("still renders the editor's own blank page, which needs no origin", () => {
    const markup = renderToString(<CanvasFrame width={1280} title="Home" />);
    expect(/<iframe[^>]*>/.exec(markup)?.[0]).toMatch(/srcdoc=/i);
  });
});
