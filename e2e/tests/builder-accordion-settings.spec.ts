/**
 * An Accordion's Titles as, Icon and Position, in the real editor and on the
 * published page.
 *
 * - On the PUBLISHED page an accordion draws each title in its summary as
 *   the heading Titles as names, with a plus after it and no browser
 *   marker; opening a section turns the plus to a minus, from the keyboard
 *   too.
 * - In the editor, Content's Icon (Chevron) and Style's Icon position
 *   (Before) draw a chevron before the title on the canvas, turned while the
 *   section is open, and are stored on the accordion; Titles as stores the
 *   level and draws it.
 *
 * @module tests/builder-accordion-settings.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const ACCORDION = "00000000-0000-4000-8000-00000000e001";
const SECTION = "00000000-0000-4000-8000-00000000e002";
const ICON = ".nx-pb-disclosure-icon";
const TITLE = ".nx-pb-disclosure-title";

/** A page of one accordion, returning its id and slug. */
async function createPage(
  request: APIRequestContext,
  accordionProps: Record<string, unknown>,
  status: "draft" | "published"
): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `accordion-${stamp}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Accordion ${stamp}`,
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: ACCORDION,
            type: "core/accordion",
            version: 1,
            props: { as: "div", contained: false, ...accordionProps },
            slots: {
              children: [
                {
                  id: SECTION,
                  type: "core/accordion-item",
                  version: 1,
                  props: { title: "What is included?", open: false },
                  slots: { children: [] },
                },
              ],
            },
          },
        ],
      },
    },
  });
  if (!created.ok()) throw new Error(`creating a page: ${created.status()}`);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return { id, slug };
}

/** The icon's mask image and transform, as the browser computes them. */
function iconLook(element: Element): { mask: string; transform: string } {
  const style = getComputedStyle(element);
  return {
    mask: style.maskImage || style.getPropertyValue("-webkit-mask-image"),
    transform: style.transform,
  };
}

/** Open the accordion in the editor, selected, on the named tab. */
async function openAccordion(page: Page, id: string, tab: string) {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  // The accordion has no padding of its own, so a click lands on its
  // section; Escape then selects the block holding it.
  await canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${SECTION}"]`)
    .first()
    .click({ position: { x: 6, y: 6 } });
  await expect.poll(() => selection(page)).toEqual([SECTION]);
  await expect(page.locator("[data-block-card]")).toContainText("Question");
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([ACCORDION]);
  await expect(page.locator("[data-block-card]")).toContainText("Accordion");
  await page.getByRole("tab", { name: tab }).click();
}

test.describe("an Accordion's titles and icon", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a published accordion draws heading titles and a plus that becomes a minus", async ({
    page,
  }) => {
    const { slug } = await createPage(
      page.request,
      { titlesAs: "h3" },
      "published"
    );
    await page.goto(`/${slug}`);
    const summary = page.locator(".nx-pb-page details > summary").first();
    // Laid out before measured: a page's first request under Cache Components
    // streams its content into a hidden container before moving it into place,
    // where every box measures zero, so the row is read once it is shown.
    await expect(summary).toBeVisible();
    await expect(summary.locator(`h3${TITLE}`)).toHaveText("What is included?");
    // A row with no browser marker: the title starts the line.
    const row = await summary.evaluate(element => {
      const title = element.querySelector(".nx-pb-disclosure-title");
      const icon = element.querySelector(".nx-pb-disclosure-icon");
      const box = element.getBoundingClientRect();
      return {
        display: getComputedStyle(element).display,
        titleStart: (title?.getBoundingClientRect().left ?? 0) - box.left,
        iconAfter:
          (icon?.getBoundingClientRect().left ?? 0) >
          (title?.getBoundingClientRect().right ?? 0),
      };
    });
    expect(row.display).toBe("flex");
    expect(row.titleStart).toBeLessThan(2);
    expect(row.iconAfter).toBe(true);
    const icon = summary.locator(ICON);
    const closed = await icon.evaluate(iconLook);
    expect(decodeURIComponent(closed.mask)).toContain("M8 3.5v9");
    // Opened from the keyboard, as the browser's own toggle is: the minus,
    // the upright stroke gone.
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => decodeURIComponent((await icon.evaluate(iconLook)).mask))
      .not.toContain("M8 3.5v9");
    expect(decodeURIComponent((await icon.evaluate(iconLook)).mask)).toContain(
      "M3.5 8h9"
    );
  });

  test("Chevron before the title, and Titles as, chosen in the editor", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, {}, "draft");
    // The icon is chosen in Content, its position in Style.
    await openAccordion(page, id, "Content");
    const iconSection = page
      .getByRole("tabpanel", { name: "Content" })
      .getByRole("button", { name: /^Icon/ });
    if ((await iconSection.getAttribute("aria-expanded")) !== "true") {
      await iconSection.click();
    }
    await page
      .getByRole("radiogroup", { name: "Icon" })
      .getByRole("radio", { name: "Chevron" })
      .click();
    await page.getByRole("tab", { name: "Style" }).click();
    const heading = page.getByRole("button", { name: /^Icon/ });
    if ((await heading.getAttribute("aria-expanded")) !== "true") {
      await heading.click();
    }
    await page.getByRole("button", { name: "Before", exact: true }).click();
    const frame = canvasFrame(page);
    const summary = frame
      .locator(`.nx-canvas [data-nx-node="${SECTION}"] > summary`)
      .first();
    await expect
      .poll(async () =>
        summary.evaluate(element => {
          const title = element.querySelector(".nx-pb-disclosure-title");
          const glyph = element.querySelector(".nx-pb-disclosure-icon");
          return (
            (glyph?.getBoundingClientRect().right ?? 0) <=
            (title?.getBoundingClientRect().left ?? 0)
          );
        })
      )
      .toBe(true);
    // The click that selected the section toggles it as a browser does, so
    // the glyph is read against the state the section is in: the chevron,
    // turned while open.
    const drawn = await summary.evaluate(element => {
      const glyph = element.querySelector(".nx-pb-disclosure-icon") ?? element;
      return {
        open:
          (element.parentElement as HTMLDetailsElement | null)?.open === true,
        mask: decodeURIComponent(getComputedStyle(glyph).maskImage),
        transform: getComputedStyle(glyph).transform,
      };
    });
    expect(drawn.mask).toContain("m4 6 4 4 4-4");
    if (drawn.open) expect(drawn.transform).toMatch(/^matrix\(-1, /);
    else expect(drawn.transform).toBe("none");

    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByRole("combobox", { name: "Titles as" }).click();
    await page.getByRole("option", { name: "Heading 2" }).click();
    await expect(summary.locator(`h2${TITLE}`)).toHaveText("What is included?");

    await pressSave(page);
    const storedAccordion = async () =>
      JSON.stringify(
        (await storedPageNodes(page.request, ENTRIES, id)).find(
          node => node.id === ACCORDION
        )
      );
    await expect.poll(storedAccordion).toContain('"titlesAs":"h2"');
    const stored = await storedAccordion();
    expect(stored).toContain('"disclosureIcon":"chevron"');
    expect(stored).toContain('"disclosurePosition":"before"');
  });
});
