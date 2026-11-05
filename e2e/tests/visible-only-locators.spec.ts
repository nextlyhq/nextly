/**
 * The page every spec is handed finds visible elements only, for the locators
 * that would otherwise match hidden ones too.
 *
 * Under Cache Components, Next.js keeps a visited page mounted but hidden, so
 * the document can hold a hidden copy of the page a spec is on, with the same
 * text, labels, test ids and placeholders. Each case here puts a hidden copy
 * beside the visible element and expects the locator to find one element, the
 * visible one, where Playwright's own would find both.
 */
import { expect } from "@playwright/test";

import { includingHidden, test } from "./support/test";

/** A hidden copy of the page, then the page itself, holding the same element. */
function hiddenCopyBeside(element: string): string {
  return `<main hidden>${element}</main><main>${element}</main>`;
}

test("finds a visible element by its text, not its hidden copy's", async ({
  page,
}) => {
  await page.setContent(hiddenCopyBeside("<p>Saved</p>"));
  await expect(page.getByText("Saved")).toHaveCount(1);
  await expect(page.getByText("Saved")).toBeVisible();
});

test("finds a visible field by its label, not its hidden copy's", async ({
  page,
}) => {
  await page.setContent(
    hiddenCopyBeside("<label>Title <input name='title' /></label>")
  );
  await expect(page.getByLabel("Title")).toHaveCount(1);
  await expect(page.getByLabel("Title")).toBeVisible();
});

test("finds a visible element by its test id, not its hidden copy's", async ({
  page,
}) => {
  await page.setContent(hiddenCopyBeside("<div data-testid='bar'>Bar</div>"));
  await expect(page.getByTestId("bar")).toHaveCount(1);
  await expect(page.getByTestId("bar")).toBeVisible();
});

test("finds a visible field by its placeholder, not its hidden copy's", async ({
  page,
}) => {
  await page.setContent(hiddenCopyBeside("<input placeholder='Search' />"));
  await expect(page.getByPlaceholder("Search")).toHaveCount(1);
  await expect(page.getByPlaceholder("Search")).toBeVisible();
});

test("holds a page its context opens to visible elements too", async ({
  context,
}) => {
  const page = await context.newPage();
  try {
    await page.setContent(hiddenCopyBeside("<p>Saved</p>"));
    await expect(page.getByText("Saved")).toHaveCount(1);
  } finally {
    await page.close();
  }
});

test("holds a page of a context the spec makes itself to visible elements", async ({
  browser,
}) => {
  // As a second user's sign-in makes one.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(hiddenCopyBeside("<p>Saved</p>"));
    await expect(page.getByText("Saved")).toHaveCount(1);
  } finally {
    await context.close();
  }
});

// The control: what each of the four finds when it may see hidden elements,
// so a page that stopped filtering cannot pass the cases above unnoticed.
test("each would find the hidden copy too, through includingHidden", async ({
  page,
}) => {
  await page.setContent(
    hiddenCopyBeside(
      "<p>Saved</p><label>Title <input /></label>" +
        "<div data-testid='bar'>Bar</div><input placeholder='Search' />"
    )
  );
  const whole = includingHidden(page);
  await expect(whole.getByText("Saved")).toHaveCount(2);
  await expect(whole.getByLabel("Title")).toHaveCount(2);
  await expect(whole.getByTestId("bar")).toHaveCount(2);
  await expect(whole.getByPlaceholder("Search")).toHaveCount(2);
});
