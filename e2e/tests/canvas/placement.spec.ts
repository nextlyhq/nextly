/**
 * The one placement rule as an author meets it on the canvas: a keyboard
 * indent onto a block that holds no blocks is refused, the author is told why,
 * and the page is left as it was.
 */
import { expect } from "@playwright/test";

import { LOCK } from "../support/locks";
import { test } from "../support/test";

import {
  announcer,
  clickBlock,
  openEditorWith,
  structure,
} from "./editor-driver";

test.describe.configure({ lock: [LOCK.homepage] });

const NODES = [
  {
    id: "pl-heading",
    type: "core/heading",
    version: 1,
    props: { text: "A heading holds no blocks", level: "h2" },
  },
  { id: "pl-text", type: "core/text", version: 1, props: { text: "Body" } },
];

test.describe("the one placement rule, driven by keyboard", () => {
  test("refuses an indent under a Heading and says why", async ({ page }) => {
    await openEditorWith(page, NODES, "pl-heading");
    await clickBlock(page, "pl-text");

    await page.keyboard.press("Alt+ArrowRight");

    await expect(announcer(page)).toHaveText(/Heading can't hold blocks\./);
    expect(await structure(page)).toEqual(["pl-heading", "pl-text"]);
  });
});
