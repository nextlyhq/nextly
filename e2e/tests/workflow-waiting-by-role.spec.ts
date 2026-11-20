/**
 * "Waiting for my review" as the workflows guide promises it: a part waits for whoever it is
 * assigned to, a person or a role, and where nothing is assigned, for the stage's default
 * reviewer before anyone else who holds the step. Two reviewers hold the same step through roles
 * of their own, so a part waiting for one role is told apart from one waiting for every holder.
 * The page is held to WCAG 2.2 AA and walked by keyboard alone.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInWithRoles } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  PEOPLE,
  expectStage,
  REVIEWED_NOTES,
  resetReviewSettings,
  reviewedNote,
  sharedPartOf,
  step,
} from "./support/workflow";

const API = "/admin/api";

// The default reviewer is the review workflow's setting, which every spec writing it locks.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

/** A reviewer signed in with a role of their own, and that role's id. */
interface RoleReviewer {
  page: Page;
  roleId: string;
  close: () => Promise<void>;
}

async function reviewerWithOwnRole(
  browser: Parameters<typeof signInWithRoles>[0],
  admin: Parameters<typeof signInWithRoles>[1],
  baseURL: string
): Promise<RoleReviewer> {
  const { context, roleIds } = await signInWithRoles(browser, admin, baseURL, [
    PEOPLE.reviewer,
  ]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { page, roleId: roleIds[0]!, close: () => context.close() };
}

/** Opens "Waiting for my review" from the Content panel and returns its table. */
async function waitingTable(page: Page) {
  await gotoAdmin(page, `/collections/${REVIEWED_NOTES}`);
  const link = page.getByRole("link", { name: "Waiting for my review" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Waiting for my review" })
  ).toBeVisible();
  return page.getByRole("table", { name: "Waiting for my review" });
}

/** Assigns the note's shared part to a role, as the API takes an assignment. */
async function assignToRole(
  admin: Parameters<typeof reviewedNote>[0],
  id: string,
  roleId: string
): Promise<void> {
  const part = await sharedPartOf(admin, id);
  const assigned = await admin.request.post(`${API}/workflows/assignments`, {
    data: {
      assignments: [
        {
          document: { collection: REVIEWED_NOTES, id },
          part: null,
          revision: part.revision,
          assignee: { kind: "role", id: roleId },
        },
      ],
    },
  });
  expect(assigned.ok(), await assigned.text()).toBe(true);
}

/** Makes `roleId` the In review stage's default reviewer. */
async function defaultReviewerFor(
  admin: Parameters<typeof reviewedNote>[0],
  roleId: string
): Promise<void> {
  const address = `${API}/workflows/review/settings`;
  const read = await admin.request.get(address);
  expect(read.ok(), await read.text()).toBe(true);
  const { revision } = (await read.json()) as { revision: number };
  const saved = await admin.request.patch(address, {
    data: {
      revision,
      defaultReviewers: { inReview: { kind: "role", id: roleId } },
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

test("a part assigned to a role, or waiting for the stage's default reviewer, waits for that role alone", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await resetReviewSettings(page);
  const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
  const b = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
  try {
    const stamp = Date.now().toString(36);
    // In review, assigned to A's role.
    const assigned = await reviewedNote(page, `assigned ${stamp}`);
    await step(page, assigned, "submit");
    await assignToRole(page, assigned, a.roleId);
    // In review, nothing assigned, with A's role the stage's default reviewer.
    await defaultReviewerFor(page, a.roleId);
    const byDefault = await reviewedNote(page, `default ${stamp}`);
    await step(page, byDefault, "submit");

    const forA = await waitingTable(a.page);
    const forB = await waitingTable(b.page);
    for (const title of [
      `Workflow note assigned ${stamp}`,
      `Workflow note default ${stamp}`,
    ]) {
      await expect(
        forA.getByRole("row").filter({ hasText: title })
      ).toHaveCount(1);
      // B holds the same step, but neither part waits for B's role.
      await expect(
        forB.getByRole("row").filter({ hasText: title })
      ).toHaveCount(0);
    }
    // The control: B's own list was read, not left empty by a failed load. An empty list says so.
    await expect(
      b.page.getByText(/^\d+\+? waiting$|^Nothing waits for your review\.$/)
    ).toBeVisible();
  } finally {
    await resetReviewSettings(page);
    await a.close();
    await b.close();
  }
});

test("Waiting for my review meets WCAG 2.2 AA and is used by keyboard alone", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await resetReviewSettings(page);
  const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
  try {
    const stamp = Date.now().toString(36);
    const id = await reviewedNote(page, `keyboard ${stamp}`);
    await step(page, id, "submit");
    await assignToRole(page, id, a.roleId);
    const title = `Workflow note keyboard ${stamp}`;

    const table = await waitingTable(a.page);
    await expect(table.getByRole("row").filter({ hasText: title })).toHaveCount(
      1
    );
    await expectNoAxeViolations(a.page);

    // From the top of the page, Tab reaches the note's link, and Enter opens its editor.
    const link = table.getByRole("link", { name: title });
    await a.page.locator("body").focus();
    let reached = false;
    for (let press = 0; press < 80 && !reached; press++) {
      await a.page.keyboard.press("Tab");
      reached = await link.evaluate(node => node === document.activeElement);
    }
    expect(reached, "Tab reaches the waiting note's link").toBe(true);
    await a.page.keyboard.press("Enter");
    await expect(a.page).toHaveURL(
      new RegExp(`/collections/${REVIEWED_NOTES}/${id}$`)
    );
  } finally {
    await a.close();
  }
});

/** The role's name as the admin shows it, by its id. */
async function roleName(
  admin: Parameters<typeof reviewedNote>[0],
  roleId: string
): Promise<string> {
  const listed = await admin.request.get(`${API}/roles?limit=500`);
  expect(listed.ok(), await listed.text()).toBe(true);
  const { items } = (await listed.json()) as {
    items: { id: string; name: string }[];
  };
  const found = items.find(role => role.id === roleId);
  expect(found, `the role ${roleId} is listed`).toBeDefined();
  return found!.name;
}

/** Opens the reviewed notes' list and selects the rows titled `titles`. */
async function selectNotes(page: Page, titles: readonly string[]) {
  await gotoAdmin(page, `/collections/${REVIEWED_NOTES}`);
  for (const title of titles) {
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.getByRole("checkbox").check();
  }
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toBeVisible();
  return bar;
}

/** The bulk move's result: its summary line, and one item per refusal. */
function bulkResult(page: Page) {
  return page.getByRole("status", { name: "Bulk move result" });
}

/** Who a note's shared part is assigned to, as the review state says. */
async function assigneeOf(
  admin: Parameters<typeof reviewedNote>[0],
  id: string
): Promise<unknown> {
  const search = new URLSearchParams({ collection: REVIEWED_NOTES, id });
  const read = await admin.request.get(
    `${API}/workflows/review-state?${search.toString()}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  const { parts } = (await read.json()) as {
    parts: { part: string | null; assignee?: unknown }[];
  };
  return parts.find(part => part.part === null)?.assignee ?? null;
}

// Moves over several notes from the list, as the guide promises them: one step across several
// documents with each refusal named, assignments, a send-back with its comment, and never an
// approval, which is for the one version a reviewer was shown.
test.describe("moves over several notes from the list", () => {
  test("Submit for review passes over a note already in review, which it does not leave from", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await resetReviewSettings(page);
    const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
    try {
      const stamp = Date.now().toString(36);
      // The control: one draft, so the move is seen to happen at all.
      const draft = await reviewedNote(page, `bulk draft ${stamp}`);
      // Already in review: Submit does not leave from there, so the note is passed over.
      const inReview = await reviewedNote(page, `bulk in review ${stamp}`);
      await step(page, inReview, "submit");
      const before = await sharedPartOf(page, inReview);

      const bar = await selectNotes(a.page, [
        `Workflow note bulk draft ${stamp}`,
        `Workflow note bulk in review ${stamp}`,
      ]);
      await expectNoAxeViolations(a.page, {
        include: '[aria-label="Bulk actions"]',
      });
      await bar.getByRole("button", { name: "Submit for review" }).click();

      await expect(bulkResult(a.page)).toContainText(/^1 moved\b/);
      await expectStage(page, draft, "inReview");
      // Not moved a second time: still in review, at the revision it had.
      const after = await sharedPartOf(page, inReview);
      expect(after.stage).toBe("inReview");
      expect(after.revision).toBe(before.revision);
    } finally {
      await a.close();
    }
  });

  test("Assign… gives the chosen notes to a role", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await resetReviewSettings(page);
    const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
    try {
      const stamp = Date.now().toString(36);
      const ids = [
        await reviewedNote(page, `assign first ${stamp}`),
        await reviewedNote(page, `assign second ${stamp}`),
      ];
      for (const id of ids) await step(page, id, "submit");
      const name = await roleName(page, a.roleId);

      const bar = await selectNotes(a.page, [
        `Workflow note assign first ${stamp}`,
        `Workflow note assign second ${stamp}`,
      ]);
      await bar.getByRole("button", { name: "Assign…" }).click();
      const dialog = a.page.getByRole("dialog", { name: "Assign" });
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(a.page, { include: '[role="dialog"]' });
      await dialog.getByRole("button", { name: `Assign to ${name}` }).click();

      await expect(bulkResult(a.page)).toContainText("2 assigned.");
      for (const id of ids) {
        await expect
          .poll(() => assigneeOf(page, id), { timeout: 15_000 })
          .toMatchObject({ kind: "role", id: a.roleId });
      }
    } finally {
      await a.close();
    }
  });

  test("Send back… returns the notes to drafting, with the comment it asks for", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await resetReviewSettings(page);
    const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
    try {
      const stamp = Date.now().toString(36);
      const ids = [
        await reviewedNote(page, `send back first ${stamp}`),
        await reviewedNote(page, `send back second ${stamp}`),
      ];
      for (const id of ids) await step(page, id, "submit");

      const bar = await selectNotes(a.page, [
        `Workflow note send back first ${stamp}`,
        `Workflow note send back second ${stamp}`,
      ]);
      await bar.getByRole("button", { name: "Send back…" }).click();
      const dialog = a.page.getByRole("dialog", { name: "Request changes" });
      await expect(dialog).toBeVisible();
      // Nothing can be sent while the comment is empty.
      const send = dialog.getByRole("button", { name: "Request changes" });
      await expect(send).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Comment" })
        .fill("Both need a source for the figures.");
      await send.click();

      await expect(bulkResult(a.page)).toContainText("2 sent back.");
      for (const id of ids) await expectStage(page, id, "drafting");
    } finally {
      await a.close();
    }
  });

  test("offers no Approve: an approval is for the one version a reviewer was shown", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await resetReviewSettings(page);
    const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
    try {
      const stamp = Date.now().toString(36);
      const id = await reviewedNote(page, `no approve ${stamp}`);
      await step(page, id, "submit");

      const bar = await selectNotes(a.page, [
        `Workflow note no approve ${stamp}`,
      ]);
      // The control: the bar offers this reviewer the moves it does allow.
      await expect(
        bar.getByRole("button", { name: "Send back…" })
      ).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Approve/ })).toHaveCount(
        0
      );
    } finally {
      await a.close();
    }
  });

  test("a note that moved since the list showed it is refused by name, the rest sent back", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await resetReviewSettings(page);
    const a = await reviewerWithOwnRole(browser, page.request, baseURL ?? "");
    try {
      const stamp = Date.now().toString(36);
      const steady = await reviewedNote(page, `steady ${stamp}`);
      const moved = await reviewedNote(page, `moved ${stamp}`);
      for (const id of [steady, moved]) await step(page, id, "submit");

      // The list's last answer, kept so every later read of it gets that same answer: a move
      // goes out as the list shows it, so the list must still show the notes as they were.
      const listAddress = (url: string) =>
        url.includes(`/collections/${REVIEWED_NOTES}/entries`);
      let frozen = false;
      let shown:
        | { status: number; headers: Record<string, string>; body: Buffer }
        | undefined;
      a.page.on("response", async response => {
        if (frozen) return;
        if (response.request().method() !== "GET") return;
        if (!listAddress(response.url())) return;
        shown = {
          status: response.status(),
          headers: response.headers(),
          body: await response.body(),
        };
      });
      const bar = await selectNotes(a.page, [
        `Workflow note steady ${stamp}`,
        `Workflow note moved ${stamp}`,
      ]);
      expect(shown, "the list was read").toBeDefined();
      frozen = true;
      await a.page.route(
        url => listAddress(url.toString()),
        async route => {
          if (route.request().method() !== "GET" || shown === undefined) {
            await route.continue();
            return;
          }
          await route.fulfill(shown);
        }
      );
      // Someone else assigns one of them after the list was read: same stage, a new revision.
      await assignToRole(page, moved, a.roleId);
      await bar.getByRole("button", { name: "Send back…" }).click();
      const dialog = a.page.getByRole("dialog", { name: "Request changes" });
      await dialog
        .getByRole("textbox", { name: "Comment" })
        .fill("Please add the sources.");
      await dialog.getByRole("button", { name: "Request changes" }).click();

      const result = bulkResult(a.page);
      await expect(result).toContainText("1 sent back; 1 refused.");
      await expect(result).toContainText(
        new RegExp(`Workflow note moved ${stamp}: .+\\.`)
      );
      await expectStage(page, steady, "drafting");
      await expectStage(page, moved, "inReview");
    } finally {
      await a.close();
    }
  });
});
