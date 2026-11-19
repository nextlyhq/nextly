/**
 * Settings › Workflows in a real browser, against the playground's review
 * workflow (attached to Reviewed notes for this suite): one change of each
 * kind made through the screen, each read back through the settings API, so
 * what the screen says was saved is what the server stored.
 *
 * - who takes a step: a new role ticked for Approve holds it, and Request
 *   changes, which shares its permission, with it;
 * - the default reviewer of In review, chosen among those who hold Approve;
 * - a stage's label and colour, then Reset back to the code's;
 * - an email switch, for its own trigger alone.
 *
 * The page also says where the workflow is registered, relative to the
 * playground's root, and the list how many documents each stage holds.
 *
 * What the component tests cannot see: the routes, the session and the real
 * server's answers, revision included, across four saves in a row.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

test.describe.configure({ mode: "serial" });

const SETTINGS = "/admin/api/workflows/review/settings";

interface Settings {
  revision: number;
  grants: Record<string, string[]>;
  defaultReviewers: Record<string, { kind: string; id: string }>;
  labels: Record<string, { label?: string; colour?: string }>;
  emails: Record<string, boolean>;
}

/** The review workflow's settings, as the API answers them now. */
async function settingsOf(api: APIRequestContext): Promise<Settings> {
  const read = await api.get(SETTINGS);
  expect(read.ok(), await read.text()).toBe(true);
  return (await read.json()) as Settings;
}

/** Opens the review workflow's page from the Workflows list. */
async function openReview(page: Page): Promise<void> {
  await gotoAdmin(page, "/settings/workflows");
  // The card, by its whole name: the rail also lists the Reviewed notes collection.
  const card = page
    .getByRole("list", { name: "Workflows" })
    .getByRole("link", { name: /^Review Defined in code/ });
  // No Reviewed note has moved yet, so every stage holds none.
  await expect(card).toContainText("Drafting0 documents");
  await card.click();
  await expect(
    page.getByText("nextly.config.ts", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Who takes each step" })
  ).toBeVisible({ timeout: 30_000 });
}

const saved = (page: Page) =>
  expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

const roleName = `E2E reviewers ${uniqueTag()}`;
let roleId = "";

test("who takes a step: a role ticked holds it, and the step sharing its permission", async ({
  page,
}) => {
  // A role needs one permission to be made; reading the notes is the least.
  const permissions = await page.request.get(
    "/admin/api/permissions?page=1&limit=1000"
  );
  expect(permissions.ok(), await permissions.text()).toBe(true);
  const read = (
    (await permissions.json()) as { items: { id: string; slug: string }[] }
  ).items.find(each => each.slug === "read-reviewed-notes");
  if (!read) throw new Error("[e2e] No read-reviewed-notes permission.");
  const created = await page.request.post("/admin/api/roles", {
    data: {
      name: roleName,
      slug: roleName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      permissionIds: [read.id],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  roleId = ((await created.json()) as { item: { id: string } }).item.id;

  await openReview(page);
  await page.getByRole("button", { name: "Change who takes Approve" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Also changes: Request changes/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: roleName }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await saved(page);

  const after = await settingsOf(page.request);
  expect(after.grants.approve).toContain(roleId);
  expect(after.grants.requestChanges).toContain(roleId);
});

test("the default reviewer of a review stage, chosen among those holding its step", async ({
  page,
}) => {
  await openReview(page);
  await page
    .getByRole("combobox", { name: "Default reviewer for In review" })
    .selectOption({ label: `${roleName} (the whole role)` });
  await page
    .getByRole("button", { name: "Save default reviewer for In review" })
    .click();
  await saved(page);

  expect((await settingsOf(page.request)).defaultReviewers.inReview).toEqual({
    kind: "role",
    id: roleId,
  });
});

test("a stage's label and colour, then Reset back to the code's", async ({
  page,
}) => {
  await openReview(page);
  const label = page.getByRole("textbox", { name: "Label for In review" });
  await label.fill("Waiting for review");
  await page
    .getByRole("group", { name: "Colour for In review" })
    .getByText("Amber", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save In review" }).click();
  await saved(page);
  expect((await settingsOf(page.request)).labels.inReview).toEqual({
    label: "Waiting for review",
    colour: "#d97706",
  });

  await page.getByRole("button", { name: "Reset In review" }).click();
  await expect(label).toHaveValue("In review");
  expect((await settingsOf(page.request)).labels.inReview).toBeUndefined();
});

test("an email switch, for its own trigger alone", async ({ page }) => {
  const before = await settingsOf(page.request);
  await openReview(page);
  const approved = page.getByRole("switch", { name: "Email for Approved" });
  await expect(approved).toHaveAttribute("aria-checked", "true");
  await approved.click();
  await expect(approved).toHaveAttribute("aria-checked", "false");

  const after = await settingsOf(page.request);
  expect(after.emails).toEqual({ ...before.emails, approved: false });
  expect(after.revision).toBe(before.revision + 1);
});
