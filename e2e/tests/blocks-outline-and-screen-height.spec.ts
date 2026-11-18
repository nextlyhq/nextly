/**
 * An outline and a screen-height unit, stored on a block, reach the published
 * page as the browser applies them.
 *
 * The compiler's own tests pin the CSS it writes. What only a browser can say
 * is that the written CSS takes effect: that every part of the outline lands
 * (its width, style, colour and offset each a longhand of its own), and that
 * `svh` resolves to the screen's height rather than being dropped.
 *
 * Safe to write against: the suite owns its database and empties it before
 * every run.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/block-pages/entries";

/** Colours as `getComputedStyle` reports them, so no parsing is needed. */
const RING = "rgb(204, 17, 85)";

const RINGED_TEXT = "Ringed by its author.";
const TALL_TEXT = "As tall as the screen.";

const id = (suffix: string) => `00000000-0000-4000-8000-00000001143${suffix}`;

function documentWith() {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: id("1"),
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: {
          children: [
            {
              id: id("2"),
              type: "core/text",
              version: 1,
              props: { text: RINGED_TEXT },
              styles: {
                base: {
                  base: {
                    outline: {
                      width: "3px",
                      style: "dashed",
                      color: RING,
                      offset: "4px",
                    },
                  },
                },
              },
            },
            {
              id: id("3"),
              type: "core/text",
              version: 1,
              props: { text: TALL_TEXT },
              styles: { base: { base: { minHeight: "100svh" } } },
            },
          ],
        },
      },
    ],
  };
}

test("a stored outline and a screen height reach the published page", async ({
  page,
}) => {
  const slug = `outline-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: "Outline and screen height",
      slug,
      status: "published",
      content: documentWith(),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await page.setViewportSize({ width: 1024, height: 700 });
  const response = await page.goto(`/blocks/${slug}`);
  expect(response?.status()).toBe(200);

  const ringed = page.getByText(RINGED_TEXT, { exact: true });
  await expect(ringed).toHaveCSS("outline-width", "3px");
  await expect(ringed).toHaveCSS("outline-style", "dashed");
  await expect(ringed).toHaveCSS("outline-color", RING);
  await expect(ringed).toHaveCSS("outline-offset", "4px");

  // A desktop browser has no moving toolbar, so the small viewport height is
  // the window's own: 700px here.
  const tall = page.getByText(TALL_TEXT, { exact: true });
  await expect(tall).toHaveCSS("min-height", "700px");
});
