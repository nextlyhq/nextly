/**
 * The setup card as a checklist, in a browser: one line per step at every
 * width, nothing scrolling sideways on a phone, the Singles listed inside their
 * line, and Hide setup in the card's menu.
 *
 * The card is placed first with an answer of the test's choosing
 * (`support/setup-card`): whether the server offers the card depends on what
 * other specs in the run have created, and these tests are about what the
 * admin draws for a given answer. Its writes are answered in the browser, so
 * hiding it leaves the stored dashboard as it was.
 *
 * @module tests/dashboard-setup.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { answerProbe, placeSetupCard } from "./support/setup-card";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

/** A new project part way through: every kind of step, and five Singles, two filled in. */
const PART_WAY = {
  setup: {
    known: true,
    steps: [
      { kind: "sample", status: "open" },
      { kind: "collection", status: "done" },
      { kind: "entry", status: "open", collection: "posts" },
      {
        kind: "singles",
        status: "open",
        singles: [
          { slug: "homepage", filledIn: true },
          { slug: "header", filledIn: true },
          { slug: "footer", filledIn: false },
          { slug: "contact-page", filledIn: false },
          { slug: "a-single-with-a-long-name-for-a-phone", filledIn: false },
        ],
      },
      { kind: "invite", status: "open" },
    ],
    done: 1,
    total: 5,
  },
  collapsed: false,
  allSet: false,
} as const;

/** The setup card's cell on the dashboard. */
function setupCard(page: Page): Locator {
  return page.getByRole("region", { name: /Set up your project/ });
}

/** How far `element` and the page scroll sideways: zero for both where nothing overflows. */
async function sidewaysOverflow(page: Page, element: Locator) {
  const card = await element.evaluate(
    node => node.scrollWidth - node.clientWidth
  );
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  return { card, page: pageOverflow };
}

test.describe("the setup checklist", () => {
  test("draws one line per step with its buttons at 1440px, half the dashboard wide", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await answerProbe(page, 200);
    await placeSetupCard(page, PART_WAY);
    await gotoAdmin(page, "/");
    const card = setupCard(page);
    await expect(card).toBeVisible();
    // The title and the count, read together as the card's name.
    await expect(card).toHaveAccessibleName(
      /^Set up your project\s*, 1 of 5 done$/
    );
    const lines = card.locator("[data-setup-step]");
    await expect(lines).toHaveCount(5);
    await expect(
      card.getByRole("button", { name: "Add samples", exact: true })
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: "Add entry: Add your first entry" })
    ).toBeVisible();
    // Half the dashboard's width, give or take the gap between cards.
    const grid = page.getByTestId("dashboard-container");
    const [cardBox, gridBox] = await Promise.all([
      card.boundingBox(),
      grid.boundingBox(),
    ]);
    expect(cardBox!.width / gridBox!.width).toBeGreaterThan(0.45);
    expect(cardBox!.width / gridBox!.width).toBeLessThan(0.55);
  });

  test("never scrolls sideways at 390px, with the Singles open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await answerProbe(page, 200);
    await placeSetupCard(page, PART_WAY);
    await gotoAdmin(page, "/");
    const card = setupCard(page);
    await expect(
      card.getByRole("button", { name: "Add samples", exact: true })
    ).toBeVisible();
    expect(await sidewaysOverflow(page, card)).toEqual({ card: 0, page: 0 });
    await card
      .getByRole("button", { name: "Show: Fill in your Singles" })
      .click();
    const singles = card.getByRole("list", { name: /Your Singles/ });
    await expect(singles).toBeVisible();
    expect(await sidewaysOverflow(page, card)).toEqual({ card: 0, page: 0 });
    // Every button is inside the card, none cut off by its edge.
    const cardBox = (await card.boundingBox())!;
    for (const control of await card
      .locator("[data-setup-step] :is(a, button)")
      .all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width + 0.5
      );
    }
  });

  test("lists the Singles inside their line with Fill in buttons, and Hide closes the list", async ({
    page,
  }) => {
    await answerProbe(page, 200);
    await placeSetupCard(page, PART_WAY);
    await gotoAdmin(page, "/");
    const card = setupCard(page);
    const show = card.getByRole("button", {
      name: "Show: Fill in your Singles",
    });
    await show.click();
    const singles = card
      .locator('[data-setup-step="singles"]')
      .getByRole("list", { name: "Your Singles, 2 of 5 filled in" });
    await expect(singles).toBeVisible();
    await expect(singles.getByRole("link", { name: /^Fill in/ })).toHaveCount(
      3
    );
    await expect(singles.getByText("Filled in", { exact: true })).toHaveCount(
      2
    );
    // Open, the same button is named for what it now does.
    await card
      .getByRole("button", { name: "Hide: Fill in your Singles" })
      .click();
    await expect(singles).toHaveCount(0);
  });

  test("is taken off by Hide setup in its menu", async ({ page }) => {
    await answerProbe(page, 200);
    await placeSetupCard(page, PART_WAY);
    await gotoAdmin(page, "/");
    const card = setupCard(page);
    await expect(card).toBeVisible();
    await page
      .getByRole("button", { name: "Card menu for Set up your project" })
      .click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toContainText(["Hide setup"]);
    await expect(
      menu.getByRole("menuitem", { name: "Remove", exact: true })
    ).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Hide setup" }).click();
    await expect(card).toHaveCount(0);
  });
});
