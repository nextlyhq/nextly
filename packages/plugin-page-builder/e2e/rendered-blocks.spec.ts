/**
 * Render-level E2E — exercises the browser-only behaviour of the new blocks WITHOUT a
 * full playground: it renders a representative page through the built server renderer,
 * serves the static HTML from an ephemeral http server, and drives it in a real browser.
 *
 * Verifies what the node-env unit tests cannot:
 *   - Tabs switch panels on click (CSS radio-hack, zero JS)
 *   - Accordion single-open toggling via native <details name>
 *   - Entrance-motion CSS is applied
 *
 * Prereq: build the package first so `dist/` exists:
 *   pnpm --filter @nextlyhq/plugin-page-builder build
 *   pnpm --filter @nextlyhq/plugin-page-builder exec playwright test e2e/rendered-blocks.spec.ts
 */
import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Built output (plain JS) — avoids TSX transpilation in the Playwright runner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { PageRenderer } from "../dist/render/index.js";
// Types from source, values from `dist`. The built entry re-exports the renderer but not the
// document types, and a type-only import is erased anyway — so this couples the fixture to the
// shape the package actually declares rather than to whatever the bundler happened to surface.
import type { BlockDocument, BlockNode } from "../src/core/types";

let n = 0;
// `Record<string, unknown>` rather than `object`: a block node's props are an index-signature type,
// and `object` is not assignable to one — `{}` has no index signature, so a document built from
// this helper is rejected by `PageRenderer` at the type level while being perfectly valid at
// runtime.
const h = (
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode => ({
  id: `e2e-${type.replace(/\W/g, "")}-${n++}`,
  type,
  props,
  ...(slots ? { slots } : {}),
});

function buildHtml(): string {
  const doc: BlockDocument = {
    version: 1,
    root: h(
      "core/container",
      {},
      {
        default: [
          h("core/heading", { text: "E2E Demo", level: "h1" }),
          h("core/tabs", {
            items: [
              { title: "Tab A", content: "Alpha panel content" },
              { title: "Tab B", content: "Beta panel content" },
            ],
          }),
          h("core/accordion", {
            items: [
              { title: "Question one", content: "Answer one" },
              { title: "Question two", content: "Answer two" },
            ],
          }),
        ],
      }
    ),
  };
  // Entrance motion on the heading, which is what the animation assertion below reads.
  //
  // Reached through the real type rather than a cast. The cast this replaces asserted a shape the
  // document does not have, so it would have kept compiling after the fixture stopped putting a
  // heading first — and the browser assertion would then fail naming the renderer.
  const heading = doc.root.slots?.default?.[0];
  if (!heading) {
    throw new Error(
      "the fixture must put a heading first for motion to be applied to"
    );
  }
  heading.motion = { entrance: "slide-up", duration: "400ms" };
  const body = renderToStaticMarkup(
    React.createElement(PageRenderer, { document: doc })
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PB E2E</title></head><body>${body}</body></html>`;
}

let server: Server;
let baseURL = "";

test.beforeAll(async () => {
  const html = buildHtml();
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseURL = `http://127.0.0.1:${port}/`;
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test("tabs switch panels on click (no JS)", async ({ page }) => {
  await page.goto(baseURL);
  const panels = page.locator('[class^="nx-pb-tab-panels-"] > div');
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeHidden();
  await page.locator("label", { hasText: "Tab B" }).click();
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
});

test("accordion is single-open via native <details>", async ({ page }) => {
  await page.goto(baseURL);
  const items = page.locator("details");
  await expect(items.nth(0)).toHaveAttribute("open", "");
  await items.nth(1).locator("summary").click();
  await expect(items.nth(1)).toHaveAttribute("open", "");
  await expect(items.nth(0)).not.toHaveAttribute("open", "");
});

test("entrance motion CSS is applied to the heading", async ({ page }) => {
  await page.goto(baseURL);
  const anim = await page
    .locator("h1")
    .evaluate(el => getComputedStyle(el).animationName);
  expect(anim).toBe("nx-slide-up");
});
