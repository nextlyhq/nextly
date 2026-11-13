/**
 * The inspector's anatomy, in the real editor.
 *
 * - Selecting a heading shows its card (icon, type, description, menu), two
 *   tabs, and on Style a bar naming the target, the device and the state; the
 *   bar follows a change of state.
 * - The Style tab orders its sections Layout to Effects and places each
 *   property as the placement table says, for a section, a heading and an
 *   image: the common controls show, the rest wait behind "+ More".
 * - A block stored with a CSS id and attributes reopens with them under
 *   Content → Advanced, and an edit there survives a save and a reload.
 * - Locking from the card's menu makes every control read-only and says so;
 *   Unlock from the same menu gives them back.
 * - With the inspector open on each tab, axe finds nothing at WCAG 2.2 AA.
 * - A Style section's header opens it from anywhere on it, its label's text
 *   included, and a click on a header while the section above it is still
 *   opening lands on that header, not on the opening section's fields.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";
import { canvasFrame } from "./support/canvas-frame";

// Reads the site's devices, which a spec storing breakpoints changes.
test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const HEADING = "00000000-0000-4000-8000-00000000a001";
const IMAGE = "00000000-0000-4000-8000-00000000a002";
const SECTION = "00000000-0000-4000-8000-00000000a003";

const SITE_STYLE = "/admin/api/singles/site-style";

/** The shared style the lock test's heading wears, so it has a chip to hold. */
const CARD = {
  id: "e2e-inspector-card",
  slug: "inspector-card",
  label: "Inspector card",
  orderIndex: 0,
  styles: { base: { base: { color: "#112233" } } },
};

/**
 * The page this spec edits: a heading with an id and attributes, an image, a
 * section. The heading wears the given shared styles, when there are any.
 */
function pageDocument(headingClasses: readonly string[] = []): unknown {
  const pad = "24px";
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Inspector heading", level: "h2" },
        cssId: "intro",
        attributes: { "data-track": "hero" },
        ...(headingClasses.length === 0 ? {} : { classes: headingClasses }),
      },
      {
        id: IMAGE,
        type: "core/image",
        version: 1,
        props: { src: "/example.jpg", alt: "An example image" },
        // A size of its own: the file is not served, and an image that never
        // loads has no box to click.
        styles: { base: { base: { width: "240px", height: "160px" } } },
      },
      {
        id: SECTION,
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        // Padding, so the section has a surface of its own to click.
        styles: {
          base: {
            base: {
              padding: {
                blockStart: pad,
                blockEnd: pad,
                inlineStart: pad,
                inlineEnd: pad,
              },
            },
          },
        },
        slots: { children: [] },
      },
    ],
  };
}

/** A draft page of its own, holding the document above, and its id. */
async function createPage(
  request: APIRequestContext,
  headingClasses: readonly string[] = []
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Inspector ${stamp}`,
      slug: `inspector-${stamp}`,
      status: "draft",
      content: pageDocument(headingClasses),
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The page's stored nodes, read back through the API. */
async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>[]> {
  return await storedPageNodes(request, ENTRIES, id);
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Select one block by clicking it on the canvas: at its centre, or near its
 * top-left corner for a container, whose centre holds its empty slot.
 */
async function select(
  page: Page,
  id: string,
  at: "centre" | "corner" = "centre"
): Promise<void> {
  // Cleared first: the selected block's toolbar is drawn over the canvas, and
  // over the block below it, so a click aimed there would land on the toolbar.
  await page.keyboard.press("Escape");
  await canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${id}"]`)
    .first()
    .click(at === "corner" ? { position: { x: 4, y: 4 } } : {});
  await expect(page.locator("[data-block-card]")).toBeVisible();
}

async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

/** The Style tab's section labels, in order, without the "has values" words. */
async function sectionLabels(page: Page): Promise<string[]> {
  // The dot sits inside the label, beside the name, and carries its own
  // words for a screen reader; the name is the label without it.
  return page
    .locator(
      ".nx-style-inspector [data-section] .nx-style-inspector__section-label"
    )
    .evaluateAll(labels =>
      labels.map(label => {
        const name = label.cloneNode(true) as HTMLElement;
        name.querySelector(".nx-style-inspector__section-dot")?.remove();
        return name.textContent ?? "";
      })
    );
}

/** The properties a section draws at once, by catalog key. */
async function shownProperties(page: Page, section: string): Promise<string[]> {
  const item = page.locator(`.nx-style-inspector [data-section="${section}"]`);
  if ((await item.getAttribute("data-state")) !== "open") {
    await item.locator("button").first().click();
  }
  return item
    .locator("[data-property]")
    .evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-property") ?? "")
    );
}

/** What a section's "+ More" lists. */
async function moreProperties(page: Page, label: string): Promise<string[]> {
  await page
    .getByRole("button", { name: `More ${label.toLowerCase()} properties` })
    .click();
  // Read once the menu is drawn: reading at once can find none yet.
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  const items = await page.getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  return items;
}

/** The reason a locked block is held, as the inspector says it. */
const LOCKED_REASON = /^Locked: it can't be moved, deleted or edited/;

/**
 * Lock the selected heading from its card's menu, check that it reads as
 * locked with every control read-only, and unlock it again.
 */
async function lockAndUnlock(page: Page): Promise<void> {
  const content = page.getByRole("tabpanel", { name: "Content" });
  await expect(content.getByLabel("Text", { exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "Style" }).click();
  const style = page.locator(".nx-style-inspector");
  // A control of the open section, enabled before the lock, so its being
  // disabled after is the lock's doing.
  const field = style
    .locator('[data-section][data-state="open"]')
    .first()
    .getByRole("textbox")
    .first();
  await expect(field).toBeEnabled();
  await page.getByRole("tab", { name: "Content" }).click();

  await page.getByRole("button", { name: "Actions for Heading" }).click();
  await page.getByRole("menuitem", { name: "Lock", exact: true }).click();

  // The reason is said once, on the card; the Style tab does not repeat it.
  const lock = page.locator('[data-lock="layers"]');
  await expect(lock).toContainText("Locked");
  await expect(content.getByLabel("Text", { exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Style" }).click();
  await expect(field).toBeDisabled();
  await expect(page.getByText(LOCKED_REASON)).toHaveCount(1);
  // The shared style's chip is held, and its tooltip says why.
  const chip = page.locator(`[data-target-chip="${CARD.id}"]`);
  await expect(chip).toHaveAttribute("aria-disabled", "true");
  await chip.focus();
  await expect(page.getByRole("tooltip")).toContainText(LOCKED_REASON);
  await chip.blur();

  await page.getByRole("button", { name: "Actions for Heading" }).click();
  await page.getByRole("menuitem", { name: "Unlock", exact: true }).click();
  await expect(lock).toHaveCount(0);
  await expect(field).toBeEnabled();
  await page.getByRole("tab", { name: "Content" }).click();
  await expect(content.getByLabel("Text", { exact: true })).toBeEnabled();
}

/** A Style section's header, by catalog key. */
function sectionHeader(page: Page, section: string) {
  return page.locator(
    `.nx-style-inspector [data-section="${section}"] .nx-style-inspector__section-trigger`
  );
}

/** The Style sections open now, by catalog key. */
async function openSections(page: Page): Promise<string[]> {
  return page
    .locator('.nx-style-inspector [data-section][data-state="open"]')
    .evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-section") ?? "")
    );
}

/** The Style tab on the section block, settled, with Layout open. */
async function sectionStyleTab(page: Page): Promise<void> {
  const id = await createPage(page.request);
  await openBuilder(page, id);
  await select(page, SECTION, "corner");
  await page.getByRole("tab", { name: "Style" }).click();
  await expect
    .poll(async () => (await openSections(page)).includes("layout"))
    .toBe(true);
  // The tab's own opening motion done, so the first click starts the only one.
  await page.waitForFunction(
    () =>
      document
        .querySelector(".nx-style-inspector")
        ?.getAnimations({ subtree: true }).length === 0
  );
}

async function axe(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .include(".nx-inspector")
    .withTags(AA_TAGS)
    .analyze();
  // A scan that reached nothing passes exactly as a clean one does.
  expect(results.passes.length).toBeGreaterThan(5);
  return results.violations.map(violation => ({
    id: violation.id,
    help: violation.help,
    targets: violation.nodes.flatMap(node => node.target.map(String)),
    // axe's own account of each node, so a contrast finding names its colours.
    detail: violation.nodes.map(node => node.failureSummary ?? ""),
  }));
}

test.describe("the inspector", () => {
  test.describe.configure({ timeout: 180_000 });

  test("shows the card, two tabs, and a bar that follows the state and device", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HEADING);

    const card = page.locator("[data-block-card]");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Heading");
    await expect(card).toContainText("A title for a page or section.");
    await expect(card.locator(".nx-block-icon")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Actions for Heading" })
    ).toBeVisible();

    const tabs = page.locator(".nx-inspector").getByRole("tab");
    await expect(tabs).toHaveText(["Content", "Style"]);

    await page.getByRole("tab", { name: "Style" }).click();
    const bar = page.getByRole("region", { name: "What you're editing" });
    await expect(bar.locator("[data-edit-target]")).toHaveText("This block");
    await expect(bar.locator("[data-edit-state]")).toHaveText("Normal");
    // The device is the canvas's own, said as the devices an edit there
    // reaches. Moving the canvas to a device moves the bar with it.
    await expect(bar.locator("[data-edit-device]")).toHaveText("All devices");
    const widths = page.getByRole("radiogroup", { name: "Device" });
    for (const [device, reach] of [
      ["Mobile", "Mobile"],
      ["Tablet", "Tablet and smaller"],
    ]) {
      await widths
        .getByRole("radio", { name: new RegExp(`^${device}`) })
        .click();
      await expect(bar.locator("[data-edit-device]")).toHaveText(reach);
    }

    // The state is a compact menu named State on the bar's second line.
    await bar.getByRole("button", { name: /^State: / }).click();
    await page.getByRole("menuitemradio", { name: /^Hover/ }).click();
    await expect(bar.locator("[data-edit-state]")).toHaveText("Hover");
  });

  test("places sections and properties as the catalogue states", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    // A heading: no Layout, Typography's common controls first.
    await select(page, HEADING);
    await page.getByRole("tab", { name: "Style" }).click();
    await expect
      .poll(() => sectionLabels(page))
      .toEqual([
        "Spacing",
        "Size",
        "Position",
        "Typography",
        "Border",
        "Effects",
      ]);
    expect(await shownProperties(page, "typography")).toEqual([
      "fontFamily",
      "fontWeight",
      "fontSize",
      "lineHeight",
      "color",
      "textAlign",
    ]);
    expect(await moreProperties(page, "Typography")).toContain(
      "Letter spacing"
    );

    // An image: the media fit controls show at once in Size.
    await select(page, IMAGE);
    await expect
      .poll(() => sectionLabels(page))
      .toEqual(["Spacing", "Size", "Position", "Border", "Effects"]);
    const size = await shownProperties(page, "size");
    expect(size).toEqual(expect.arrayContaining(["aspectRatio", "objectFit"]));

    // A section: Layout first; the container query and box sizing wait in More.
    await select(page, SECTION, "corner");
    await expect
      .poll(() => sectionLabels(page))
      .toEqual([
        "Layout",
        "Spacing",
        "Size",
        "Position",
        "Background",
        "Border",
        "Effects",
      ]);
    expect(await shownProperties(page, "layout")).toEqual(["display"]);
    expect(await moreProperties(page, "Layout")).toContain("Container type");
    await shownProperties(page, "size");
    expect(await moreProperties(page, "Size")).toContain("Box sizing");
    // And no style section is called Advanced.
    expect(await sectionLabels(page)).not.toContain("Advanced");
  });

  test("keeps a stored CSS id and attributes under Content → Advanced, through a save and reload", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HEADING);

    await page.getByText("Advanced", { exact: true }).click();
    const cssId = page.getByRole("textbox", { name: "CSS id" });
    await expect(cssId).toHaveValue("intro");
    await expect(
      page.getByRole("textbox", { name: "Name of attribute 1" })
    ).toHaveValue("data-track");
    const value = page.getByRole("textbox", { name: "Value of attribute 1" });
    await expect(value).toHaveValue("hero");

    await cssId.fill("intro-two");
    await cssId.press("Enter");
    await value.fill("hero-two");
    await value.press("Tab");

    await saveDraft(page);
    await expect
      .poll(async () => {
        const heading = (await storedNodes(page.request, id)).find(
          node => node.id === HEADING
        );
        return [heading?.cssId, heading?.attributes];
      })
      .toEqual(["intro-two", { "data-track": "hero-two" }]);

    await page.reload();
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await select(page, HEADING);
    await page.getByText("Advanced", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "CSS id" })).toHaveValue(
      "intro-two"
    );
    await expect(
      page.getByRole("textbox", { name: "Value of attribute 1" })
    ).toHaveValue("hero-two");
  });

  test("marks a section never to be quoted after Show when, through a save and reload", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    // Offered on a container, not on a heading.
    await select(page, HEADING);
    await expect(
      page.getByRole("switch", { name: "Never quote this" })
    ).toHaveCount(0);

    await select(page, SECTION);
    const never = page.getByRole("switch", { name: "Never quote this" });
    await expect(never).toHaveAttribute("aria-checked", "false");
    // After the block's own fields and Visible on, before Advanced.
    const order = await page
      .locator("[data-visible-on], [data-never-quote], .nx-inspector__advanced")
      .evaluateAll(elements =>
        elements.map(element =>
          element.hasAttribute("data-visible-on")
            ? "visible-on"
            : element.hasAttribute("data-never-quote")
              ? "never-quote"
              : "advanced"
        )
      );
    expect(order).toEqual(["visible-on", "never-quote", "advanced"]);

    await never.click();
    await expect(page.getByText("On: marked")).toBeVisible();
    // The canvas draws through the page's own renderer, so the section's
    // element carries the mark as the published page will.
    await expect(
      canvasFrame(page)
        .locator(`.nx-canvas [data-nx-node="${SECTION}"][data-nosnippet]`)
        .first()
    ).toBeAttached();

    await saveDraft(page);
    await expect
      .poll(async () => {
        const section = (await storedNodes(page.request, id)).find(
          node => node.id === SECTION
        );
        return section?.nosnippet;
      })
      .toBe(true);

    await page.reload();
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await select(page, SECTION);
    await expect(
      page.getByRole("switch", { name: "Never quote this" })
    ).toHaveAttribute("aria-checked", "true");
  });

  test("locks from the card's menu, reads as locked with every control read-only, and unlocks", async ({
    page,
  }) => {
    // The site's shared styles, restored after: the heading wears one, so the
    // Style tab has a chip for the lock to hold.
    const before = await page.request.get(SITE_STYLE);
    expect(before.ok(), `reading the site style: ${before.status()}`).toBe(
      true
    );
    const site = (await before.json()) as Record<string, unknown>;
    const classes =
      ((site.item ?? site) as Record<string, unknown>).classes ?? [];
    const storeClasses = async (value: unknown): Promise<void> => {
      const stored = await page.request.patch(SITE_STYLE, {
        data: { classes: value, _overwrite: true },
      });
      expect(stored.ok(), `storing shared styles: ${stored.status()}`).toBe(
        true
      );
    };
    await storeClasses([CARD]);
    let id: string | undefined;
    try {
      id = await createPage(page.request, [CARD.id]);
      await openBuilder(page, id);
      await select(page, HEADING);
      await lockAndUnlock(page);
    } finally {
      // The page goes first: a shared style still in use cannot be removed.
      if (id !== undefined) await page.request.delete(`${ENTRIES}/${id}`);
      await storeClasses(classes);
    }
  });

  test("renames from a double-click on the title, shown in the card", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HEADING);

    await page
      .locator("[data-block-card]")
      .getByRole("heading", { level: 2 })
      .dblclick();
    const label = page.getByRole("textbox", { name: "Label" });
    await expect(label).toBeFocused();
    await label.fill("Hero title");
    await label.press("Enter");

    await expect(
      page.locator("[data-block-card]").getByRole("heading", { level: 2 })
    ).toHaveText("Hero title · Heading");
  });

  test("opens a Style section from its label's text", async ({ page }) => {
    await sectionStyleTab(page);
    await page
      .locator(
        '.nx-style-inspector [data-section="spacing"] .nx-style-inspector__section-label'
      )
      .click();
    await expect
      .poll(async () => (await openSections(page)).includes("spacing"))
      .toBe(true);
  });

  test("lands a click on the header it is aimed at while the section above it opens", async ({
    page,
  }) => {
    await sectionStyleTab(page);
    const spacing = await sectionHeader(page, "spacing").boundingBox();
    if (spacing === null) throw new Error("the Spacing header has no box");
    // A mouse click, not a locator's: a locator waits for the motion to end,
    // and the motion is what this is about. Spacing opens as Layout closes.
    await page.mouse.click(spacing.x + 20, spacing.y + spacing.height / 2);
    // Mid-motion: the 150ms opening and closing have started, not ended.
    await page.waitForTimeout(40);
    const moving = await page.evaluate(
      () =>
        document
          .querySelector(".nx-style-inspector")
          ?.getAnimations({ subtree: true }).length ?? 0
    );
    expect(moving, "a section is still moving").toBeGreaterThan(0);

    // The header below the opening section, where it is drawn now. An
    // opening section's fields left unclipped while it grows are drawn over
    // it, and take the click.
    //
    // Measured and hit-tested in ONE evaluation, so in one frame: the header
    // moves throughout the motion, and two round trips — its box, then the
    // element at that point — let it move between them, which under a loaded
    // machine sent the probe to where the header had been.
    //
    // And pressed in that same frame, by the element found at that point, so
    // the press happens while the section above is still opening and cannot
    // lag behind the header it was aimed at.
    const hit = await page.evaluate(() => {
      const header = document.querySelector(
        '.nx-style-inspector [data-section="size"] .nx-style-inspector__section-trigger'
      );
      if (header === null) throw new Error("the Size header is not drawn");
      const box = header.getBoundingClientRect();
      const under = document.elementFromPoint(
        box.x + 20,
        box.y + box.height / 2
      );
      const trigger = under?.closest(".nx-style-inspector__section-trigger");
      const section =
        trigger?.closest("[data-section]")?.getAttribute("data-section") ??
        null;
      // Read BEFORE the press: the press starts Size's own animation, which
      // would otherwise answer "still moving" for a section above that had
      // already come to rest.
      const stillMoving =
        (document
          .querySelector(".nx-style-inspector")
          ?.getAnimations({ subtree: true }).length ?? 0) > 0;
      if (trigger instanceof HTMLElement) trigger.click();
      return { section, stillMoving };
    });
    expect(hit.section).toBe("size");
    expect(hit.stillMoving, "pressed while the section above opens").toBe(true);
    await expect
      .poll(async () => (await openSections(page)).includes("size"))
      .toBe(true);
  });

  test("has no WCAG 2.2 AA violations with the inspector open on each tab", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HEADING);

    expect(await axe(page), "Content").toEqual([]);
    await page.getByText("Advanced", { exact: true }).click();
    expect(await axe(page), "Content with Advanced open").toEqual([]);
    await page.getByRole("tab", { name: "Style" }).click();
    expect(await axe(page), "Style").toEqual([]);
  });
});
