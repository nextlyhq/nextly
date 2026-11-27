/**
 * A translation is written by one person and approved by another, on the page
 * of that language alone: the writer submits Spanish, the reviewer approves it,
 * and the writer publishes it. English and the shared fields stay as they are.
 *
 * Runs on the playground's Reviewed translations, which the preset `review`
 * workflow holds and whose title and summary are kept per language.
 *
 * @module tests/translation-page-review
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInWithRoles } from "./support/limited-user";
import { createEntry, expectOk } from "./support/runtime-collection";
import { ownSeat, test } from "./support/test";

const COLLECTION = "reviewed-translations";
const ENTRIES = `/admin/api/collections/${COLLECTION}/entries`;

/** Writes and publishes, and may approve nothing. */
const WRITER = [
  `read-${COLLECTION}`,
  `update-${COLLECTION}`,
  `publish-${COLLECTION}`,
];
/** Approves, and may write nothing. */
const REVIEWER = [`read-${COLLECTION}`, `approve-${COLLECTION}`];

/** A part of a document as its review state tells it. */
interface PartState {
  part: string | null;
  stage: string | null;
}

/** The stage each part stands in, by its language; the shared fields under "". */
async function stagesOf(
  api: APIRequestContext,
  id: string
): Promise<Record<string, string | null>> {
  const search = new URLSearchParams({ collection: COLLECTION, id });
  const read = await api.get(`/admin/api/workflows/review-state?${search}`);
  await expectOk(read, "reading the review state");
  const { parts } = (await read.json()) as { parts: PartState[] };
  return Object.fromEntries(parts.map(each => [each.part ?? "", each.stage]));
}

/** A note live in English, with a Spanish draft nobody has submitted. */
async function noteWithSpanishDraft(api: APIRequestContext): Promise<string> {
  const title = `Reviewed translation ${uniqueTag()}`;
  const id = await createEntry(api, COLLECTION, {
    title,
    summary: "What changes for readers.",
  });
  // Past the workflow, as an administrator may: this is what the reviewed
  // Spanish is added to, and not what the test is about.
  await expectOk(
    await api.post(`${ENTRIES}/${id}/publish`, {
      data: {
        locales: ["en"],
        shared: true,
        withoutReview: { reason: "The English the Spanish is made from." },
        _overwrite: true,
      },
    }),
    "publishing the English"
  );
  await expectOk(
    await api.patch(`${ENTRIES}/${id}?locale=es`, {
      data: {
        title: `${title} (es)`,
        summary: "Lo que cambia.",
        _overwrite: true,
      },
    }),
    "writing the Spanish draft"
  );
  return id;
}

/** What a visitor is served in one language, with nothing in its place. */
async function servedIn(
  api: APIRequestContext,
  id: string,
  language: string
): Promise<Record<string, unknown>> {
  const read = await api.get(
    `${ENTRIES}/${id}?locale=${language}&fallback-locale=none&status=published`
  );
  await expectOk(read, `reading what is published in ${language}`);
  return (await read.json()) as Record<string, unknown>;
}

const openSpanish = (page: Page, id: string) =>
  gotoAdmin(page, `/translations/collections/${COLLECTION}/${id}?locale=es`);

const actions = (page: Page): Locator =>
  page.getByRole("group", { name: "Spanish actions" });
const action = (page: Page, name: string): Locator =>
  actions(page).getByRole("button", { name, exact: true });
/** The main button's arrow, which holds Save and the rest. */
const openMenu = async (page: Page): Promise<Locator> => {
  await actions(page)
    .getByRole("button", { name: /^More / })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
};
const stage = (page: Page): Locator =>
  page.getByRole("region", { name: "Stage", exact: true });
const summary = (page: Page): Locator =>
  page
    .getByRole("group", { name: "Summary", exact: true })
    .locator('[data-slot="translation-target"]')
    .getByRole("textbox");

test("a writer hands Spanish to a reviewer, and publishes it once it is approved", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const id = await noteWithSpanishDraft(page.request);
  const english = await servedIn(page.request, id, "en");
  const before = await stagesOf(page.request, id);
  const writer = await signInWithRoles(browser, page.request, baseURL ?? "", [
    WRITER,
  ]);
  const reviewer = await signInWithRoles(browser, page.request, baseURL ?? "", [
    REVIEWER,
  ]);
  try {
    const writing = await writer.context.newPage();
    await openSpanish(writing, id);

    // The writer's step leads, and there is no Publish beside it.
    const submit = action(writing, "Submit for review");
    await expect(submit).toHaveAttribute("data-primary", "true");
    await expect(stage(writing)).toContainText("Drafting");
    await expect(action(writing, "Publish Spanish")).toHaveCount(0);

    // Unsaved words are saved first, by the writer, on the same menu.
    await summary(writing).fill("Lo que cambia para los lectores.");
    await expect(submit).toHaveAttribute("data-held", "");
    const saved = writing.waitForResponse(
      response =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `${ENTRIES}/${id}`
    );
    const menu = await openMenu(writing);
    await menu.getByRole("menuitem", { name: /^Save Spanish/ }).click();
    expect((await saved).ok()).toBe(true);
    await expect(submit).not.toHaveAttribute("data-held");

    const sent = writing.waitForRequest(
      request =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/admin/api/workflows/steps"
    );
    await submit.click();
    // Spanish alone, whatever stage the rest of the document stands in.
    expect((await sent).postDataJSON()).toMatchObject({
      step: "submit",
      parts: ["es"],
    });
    await expect(stage(writing)).toContainText("In review");

    // Publish now leads, held, and says why.
    const publish = action(writing, "Publish Spanish");
    await expect(publish).toHaveAttribute("data-held", "");
    await expect(publish).toHaveAccessibleDescription(
      /^Needs approval: In review/
    );

    // The reviewer may write nothing, and is offered the step all the same.
    const reviewing = await reviewer.context.newPage();
    await openSpanish(reviewing, id);
    const approve = action(reviewing, "Approve");
    await expect(approve).toHaveAttribute("data-primary", "true");
    const reviewMenu = await openMenu(reviewing);
    await expect(
      reviewMenu.getByRole("menuitem", { name: /^Save/ })
    ).toHaveCount(0);
    await reviewing.keyboard.press("Escape");
    await approve.click();
    await expect(stage(reviewing)).toContainText("Approved");

    expect(await stagesOf(page.request, id)).toEqual({
      ...before,
      es: "approved",
    });
    // Nothing is live by a step.
    expect((await servedIn(page.request, id, "es")).summary ?? null).toBeNull();

    await openSpanish(writing, id);
    await expect(publish).not.toHaveAttribute("data-held");
    await publish.click();
    const dialog = writing.getByRole("dialog", { name: "Publish Spanish?" });
    await expect(dialog).toContainText(
      "Spanish readers will see this translation."
    );
    await dialog
      .getByRole("button", { name: "Publish Spanish", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expect
      .poll(async () => (await servedIn(page.request, id, "es")).summary)
      .toBe("Lo que cambia para los lectores.");
    expect(await servedIn(page.request, id, "en")).toMatchObject({
      title: english.title,
      summary: english.summary,
    });
  } finally {
    await writer.context.close();
    await reviewer.context.close();
  }
});

test.describe("the page under a workflow", () => {
  ownSeat(1);

  for (const theme of ["light", "dark"] satisfies Theme[]) {
    test(`meets the accessibility rules in the ${theme} theme`, async ({
      page,
    }) => {
      const id = await noteWithSpanishDraft(page.request);
      await gotoAdmin(
        page,
        `/translations/collections/${COLLECTION}/${id}?locale=es`,
        theme
      );
      await expect(action(page, "Submit for review")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test("on a phone every control is on screen", async ({ page }) => {
    const width = 390;
    await page.setViewportSize({ width, height: 844 });
    const id = await noteWithSpanishDraft(page.request);
    await openSpanish(page, id);
    await expect(action(page, "Submit for review")).toBeVisible();

    const controls = await actions(page)
      .locator("button, a[href]")
      .filter({ visible: true })
      .evaluateAll(nodes =>
        nodes.map(node => {
          const { left, right } = node.getBoundingClientRect();
          const name = node.getAttribute("aria-label") ?? node.textContent;
          return { name: name?.trim() ?? "", left, right };
        })
      );
    // Both among those measured, so finding none off the screen says something.
    expect(controls.map(control => control.name)).toEqual(
      expect.arrayContaining(["Submit for review", "History"])
    );
    expect(
      controls.filter(({ left, right }) => left < 0 || right > width),
      "controls past the edge of the screen"
    ).toEqual([]);
  });
});
