/**
 * The admin looks as it does on its own in a site whose stylesheet styles bare
 * elements.
 *
 * The admin mounts inside the site's document, so the site's global CSS is in
 * the cascade with it. A site's own rules are usually unlayered (`h2 { ... }`
 * in a `globals.css`), and an unlayered rule beats every layered one whatever
 * their specificity, so it beat the admin's Tailwind-built sheet, which is all
 * layered: a blog template's `h2 { font-size: clamp(...) }` drew every
 * dashboard card title at 36px on the card's fixed 20px line, clipped.
 *
 * The site's rules are added to the site page, then the admin is opened
 * through the site's own link, as a site linking to its admin does, so the
 * rules are in the document the admin renders into. The admin's elements are
 * compared on the computed properties such rules reach with a load of the
 * admin where no site rule exists.
 *
 * One part of the admin is meant to take the site's rules: the Page Builder's
 * canvas, which draws the site's own page in the admin's document and has to
 * look like the finished page. The second test holds both sides of that.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The canvas test writes the homepage's layout, which other specs share; see
// support/locks.ts. A lock holds for the whole file.
test.describe.configure({ lock: [LOCK.homepage] });

/**
 * Rules a site's own stylesheet commonly carries, written to differ from the
 * admin's look on every property compared below. Unlayered, as a site's
 * `globals.css` is. The heading rule is the blog template's, at its widest.
 */
const SITE_RULES = `
  /* e2e: a site's element rules */
  body { line-height: 2.5; }
  h1, h2, h3, h4, h5, h6 {
    font-size: clamp(1.5rem, 4vw, 2.25rem);
    line-height: 1.1;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    margin: 0 0 1rem;
  }
  p { font-size: 1.25rem; line-height: 2; margin: 0 0 1.5rem; color: rgb(200, 0, 0); }
  a { color: rgb(0, 0, 238); text-decoration: underline; }
  button {
    padding: 1rem 2rem;
    border-radius: 9999px;
    background-color: rgb(0, 0, 0);
    color: rgb(255, 255, 255);
    font-size: 1.5rem;
    line-height: 2;
  }
`;

/** The computed properties compared: what the rules above set. */
const PROPERTIES = [
  "font-size",
  "line-height",
  "letter-spacing",
  "text-transform",
  "color",
  "background-color",
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-left",
  "border-top-left-radius",
  "text-decoration-line",
] as const;

type Styles = Record<string, Record<string, string>>;

/** One element's computed properties. */
function stylesOf(element: Locator): Promise<Record<string, string>> {
  return element.evaluate(
    (node, properties) => {
      const computed = window.getComputedStyle(node);
      return Object.fromEntries(
        properties.map(property => [
          property,
          computed.getPropertyValue(property),
        ])
      );
    },
    [...PROPERTIES]
  );
}

/** Every dashboard card's title, the heading inside its header. */
function cardTitles(page: Page): Locator {
  return page.getByTestId("widget-card-header").locator("h2");
}

/**
 * The dashboard's elements of each kind a site rule names, read once the
 * cards have drawn, keyed by what they are so two reads compare by element.
 * The pointer is moved off the page first so no reading includes a hover.
 */
async function dashboardStyles(page: Page): Promise<Styles> {
  await page.mouse.move(0, 0);
  await expect(cardTitles(page).first()).toBeVisible({ timeout: 30_000 });
  const main = page.locator("main");
  const styles: Styles = {
    heading: await stylesOf(main.getByRole("heading", { level: 1 })),
    paragraph: await stylesOf(main.locator("p").first()),
    button: await stylesOf(main.getByRole("button", { name: "Customize" })),
    link: await stylesOf(
      page.getByRole("navigation").getByRole("link", { name: "Dashboard" })
    ),
  };
  for (const title of await cardTitles(page).all()) {
    styles[`card title "${await title.getAttribute("title")}"`] =
      await stylesOf(title);
  }
  return styles;
}

test("the admin's dashboard looks the same in a site that styles bare elements", async ({
  page,
}) => {
  // The admin with no site rule in the document: what it should look like.
  await gotoAdmin(page, "");
  const alone = await dashboardStyles(page);

  // The site page, with the site's rules.
  await page.goto("/e2e-site");
  await expect(page.getByTestId("site-harness")).toBeVisible();
  await page.addStyleTag({ content: SITE_RULES });
  // The positive control: the rules are live in this document. The heading is
  // drawn at the rule's 36px, the paragraph in its red.
  const site = page.getByTestId("site-harness");
  await expect(site.getByRole("heading", { level: 1 })).toHaveCSS(
    "font-size",
    "36px"
  );
  await expect(site.locator("p")).toHaveCSS("color", "rgb(200, 0, 0)");

  // Into the admin through the site's link, without a document load, so the
  // site's rules stay in the document.
  await site.getByRole("link", { name: "Open the admin" }).click();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Dashboard" })
  ).toBeVisible({ timeout: 30_000 });
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("style")].some(style =>
        style.textContent?.includes("e2e: a site's element rules")
      )
    )
  ).toBe(true);

  // Each card title in the title style of the card type ramp, and wholly
  // inside its line: the truncating span shows the whole height of the text.
  // Read once the cards have drawn, which the dashboard does after its data.
  await expect(cardTitles(page).first()).toBeVisible({ timeout: 30_000 });
  const titles = await cardTitles(page).all();
  expect(titles.length).toBeGreaterThan(0);
  for (const title of titles) {
    await expect(title).toHaveCSS("font-size", "14px");
    await expect(title).toHaveCSS("line-height", "20px");
    const fits = await title
      .locator("span.truncate")
      .first()
      .evaluate(span => span.scrollHeight <= span.clientHeight);
    expect(fits).toBe(true);
  }

  // And every element read looks as it does with no site rule at all. The
  // cards are compared where both reads drew them: another spec's content can
  // bring a card in or take one out between the reads, and what is compared
  // here is each element's look, not which cards the dashboard shows.
  const amid = await dashboardStyles(page);
  const shared = Object.keys(alone).filter(key => key in amid);
  // Never satisfied by an empty comparison: the page's own elements always,
  // and at least one card's title.
  expect(shared).toEqual(
    expect.arrayContaining(["heading", "paragraph", "button", "link"])
  );
  expect(shared.some(key => key.startsWith("card title"))).toBe(true);
  expect(Object.fromEntries(shared.map(key => [key, amid[key]]))).toEqual(
    Object.fromEntries(shared.map(key => [key, alone[key]]))
  );
});

/** The homepage single's API, whose layout the Page Builder edits. */
const HOMEPAGE_API = "/admin/api/singles/homepage";

/** The homepage form's action that opens the Page Builder. */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

/** A site rule no admin style or block style sets, so only its source decides. */
const SITE_HEADING_RULE = "h2 { text-transform: uppercase; }";

test("the Page Builder's canvas takes the site's element rules, and the rest of the admin does not", async ({
  page,
}) => {
  // The site's rule on every document this page loads, as a site's own
  // stylesheet is.
  await page.addInitScript(rule => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.dataset.e2eSiteRule = "";
      style.textContent = rule;
      document.head.append(style);
    });
  }, SITE_HEADING_RULE);

  const heading = "A heading the site styles";
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "site-styled",
            type: "core/heading",
            version: 1,
            props: { text: heading, level: "h2" },
          },
        ],
      },
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );

  // In the canvas: drawn as the site draws an `h2`.
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  const canvasHeading = page
    .locator(".nx-canvas h2")
    .filter({ hasText: heading })
    .first();
  await expect(canvasHeading).toBeVisible({ timeout: 30_000 });
  await expect(canvasHeading).toHaveCSS("text-transform", "uppercase");

  // Outside it, on the dashboard of the same admin: the rule is in the
  // document, and a card title, also an `h2`, is drawn as the admin draws it.
  await gotoAdmin(page, "");
  await expect(page.locator("style[data-e2e-site-rule]")).toHaveCount(1);
  const title = cardTitles(page).first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(title).toHaveCSS("text-transform", "none");
});
