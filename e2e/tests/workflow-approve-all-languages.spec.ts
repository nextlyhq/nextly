/**
 * Approving every language of a translated document at once, in a real browser. A reviewer
 * opens a page whose English, Spanish and shared fields wait for approval; "Approve all
 * languages…" lists each part with its changes and names the language left out, and one
 * approval moves every listed part. A part that changes while the dialog is open refuses the
 * whole step: nothing is approved, the dialog says which part changed, and approving again
 * approves what is shown now. The dialog is held to WCAG 2.2 AA.
 *
 * The playground's `reviewed-pages` collection has a workflow of its own (`translated-review`),
 * so this spec shares nothing with the notes' review workflow and holds no lock.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const API = "/admin/api";
const COLLECTION = "reviewed-pages";
const PAGES = `${API}/collections/${COLLECTION}/entries`;

/** One part of the page's review state, as `GET /workflows/review-state` answers it. */
interface PartState {
  part: string | null;
  stage: string | null;
  revision: number;
  version: string | null;
}

/** The page's parts as the review state reads them now. */
async function partsOf(page: Page, id: string): Promise<PartState[]> {
  const search = new URLSearchParams({ collection: COLLECTION, id });
  const read = await page.request.get(
    `${API}/workflows/review-state?${search.toString()}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  return ((await read.json()) as { parts: PartState[] }).parts;
}

/** Writes the page's translatable fields in `locale`. */
async function written(
  page: Page,
  id: string,
  locale: string,
  data: { title?: string; summary?: string }
): Promise<void> {
  // A write names the version it changes; this one replaces whatever is
  // stored, as seeding does.
  const saved = await page.request.patch(`${PAGES}/${id}?locale=${locale}`, {
    data: { ...data, _overwrite: true },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/** Submits the named parts for review, with what each reads now. */
async function submitted(
  page: Page,
  id: string,
  parts: (string | null)[]
): Promise<void> {
  const read = await partsOf(page, id);
  const seen = parts.map(name => {
    const part = read.find(candidate => candidate.part === name);
    if (part === undefined || part.version === null) {
      throw new Error(
        `[e2e] The part ${String(name)} of ${id} has no version.`
      );
    }
    return { part: name, revision: part.revision, version: part.version };
  });
  const taken = await page.request.post(`${API}/workflows/steps`, {
    data: {
      document: { collection: COLLECTION, id },
      step: "submit",
      parts,
      seen,
    },
  });
  expect(taken.ok(), await taken.text()).toBe(true);
}

/** Polls until every named part stands in `stage`. */
async function expectStages(
  page: Page,
  id: string,
  parts: (string | null)[],
  stage: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const read = await partsOf(page, id);
        return parts.map(name => read.find(part => part.part === name)?.stage);
      },
      { message: `the parts stand in ${stage}`, timeout: 15_000 }
    )
    .toEqual(parts.map(() => stage));
}

test("a reviewer approves every language of a page from one dialog, and is refused what changed while they looked", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now().toString(36);
  const waiting = ["en", "es", null];

  // A page written in English and Spanish, each language and the shared fields sent for review.
  const created = await page.request.post(PAGES, {
    data: {
      title: `Workflow page ${stamp}`,
      summary: `What changes for readers, ${stamp}.`,
      reference: `REF-${stamp}`,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  const id = String(item.id);
  await written(page, id, "es", {
    title: `Página ${stamp}`,
    summary: `Lo que cambia para los lectores, ${stamp}.`,
  });
  await submitted(page, id, waiting);
  await expectStages(page, id, waiting, "inReview");

  await gotoAdmin(page, `/collections/${COLLECTION}/${id}`);
  const changes = page.getByRole("region", { name: "Changes to review" });
  await expect(changes).toBeVisible({ timeout: 30_000 });
  await changes.getByRole("button", { name: "Approve all languages…" }).click();

  const dialog = page.getByRole("dialog", { name: "Approve all languages" });
  await expect(dialog).toBeVisible();
  const listed = dialog.getByRole("list", { name: "Parts to approve" });
  for (const name of ["English", "Spanish", "Shared fields"]) {
    await expect(
      listed.getByText(name, { exact: false }).first()
    ).toBeVisible();
  }
  // Arabic has nothing of its own in review, so it is named as left out, not approved.
  await expect(dialog.getByText("Left out")).toBeVisible();
  await expect(dialog.getByText(/Arabic/)).toBeVisible();
  await expectNoAxeViolations(page, { include: '[role="dialog"]' });

  // Spanish changes while the dialog is open: the step refuses every part, and says which.
  await written(page, id, "es", {
    summary: `Lo que cambia, revisado, ${stamp}.`,
  });
  const approve = dialog.getByRole("button", { name: /^Approve / });
  await approve.click();
  const refusal = dialog.getByRole("alert");
  await expect(refusal).toContainText("changed while you looked");
  await expect(refusal).toContainText("Spanish");
  await expectStages(page, id, waiting, "inReview");
  await expectNoAxeViolations(page, { include: '[role="dialog"]' });

  // Approving again approves what is shown now, every listed part in one step.
  await approve.click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expectStages(page, id, waiting, "approved");
});
