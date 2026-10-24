/**
 * The shared axe helper, held to what it is for: it measures the colours a reader actually sees.
 *
 * It waits for running colour transitions before scanning, so a scan never measures text halfway
 * between two themes. These pin both halves of that: a real low-contrast element still fails, a
 * transition that ends on low contrast still fails, and one that ends readable passes.
 *
 * @module tests/axe-helper.spec
 */
import { expect } from "@playwright/test";

import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

/** Scoped to the content, as a page's own region would be: the scan must measure its contrast. */
const MAIN = { include: "main" };

/** A page whose paragraph eases its colour to `to` over 400ms, on a dark background. */
async function easingTo(page: import("@playwright/test").Page, to: string) {
  await page.setContent(`
    <style>
      body { background: #111111; }
      h1 { color: #eeeeee; }
      p { color: #111111; transition: color 400ms linear; }
      p.settled { color: ${to}; }
    </style>
    <main><h1>Settings</h1><p>Some text to read</p></main>
  `);
  await page.evaluate(() => {
    const paragraph = document.querySelector("p");
    // Laid out first, so the class change starts a transition rather than landing at once.
    void paragraph?.getBoundingClientRect();
    paragraph?.classList.add("settled");
  });
}

test.describe("the axe helper", () => {
  test("still fails on low-contrast text a reader would see", async ({
    page,
  }) => {
    await page.setContent(`
      <main>
        <h1>Settings</h1>
        <p style="color: #bbbbbb; background: #ffffff">Hard to read</p>
      </main>
    `);
    await expect(expectNoAxeViolations(page, MAIN)).rejects.toThrow(
      /color-contrast/
    );
  });

  test("measures a colour transition once it has finished", async ({
    page,
  }) => {
    // 🔴 Scanned mid-way, the paragraph is near-black on near-black.
    await easingTo(page, "#eeeeee");
    await expectNoAxeViolations(page, MAIN);
  });

  test("still fails when a transition finishes on a colour too faint to read", async ({
    page,
  }) => {
    await easingTo(page, "#333333");
    await expect(expectNoAxeViolations(page, MAIN)).rejects.toThrow(
      /color-contrast/
    );
  });
});
