/**
 * What waits for a reviewer, in a real browser, on the playground's Reviewed
 * notes (the review workflow): the Content panel links "Waiting for my review"
 * for a person who holds a review step and not for one who doesn't, and the
 * page lists the notes in review, each linked to its editor. Then a bulk move
 * from the notes list: the summary says how many moved and names each
 * refusal.
 *
 * Notes are created and sent for review through the same REST routes the
 * editor uses, each under a stamp of its own, so the spec reads back exactly
 * what it wrote.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { signInWithRoles } from "./support/limited-user";
import { test } from "./support/test";

const API = "/admin/api";
const COLLECTION = "reviewed-notes";
const NOTES = `${API}/collections/${COLLECTION}/entries`;

/**
 * Reads notes and holds In review's steps (Approve, Request changes), and no other: a note waits
 * for this person only once it is in review, never while it is a draft (Submit needs update).
 */
const REVIEWER = ["read-reviewed-notes", "approve-reviewed-notes"];
/** Submits notes and reviews them, so every bulk move is theirs to ask for. */
const EDITOR = [
  "read-reviewed-notes",
  "update-reviewed-notes",
  "approve-reviewed-notes",
];
/** Reads notes and may take no step on them: nothing can ever wait for this person. */
const READER = ["read-reviewed-notes"];

/** The shared part of a note's review state, as the editor reads it. */
interface PartState {
  part: string | null;
  stage: string | null;
  revision: number;
  version: string | null;
}

/** A new note titled `title`, by its id. */
async function note(api: APIRequestContext, title: string): Promise<string> {
  const created = await api.post(NOTES, {
    data: { title, summary: `What changes for readers in ${title}.` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  return String(item.id);
}

/** The note's shared part, as `GET /workflows/review-state` answers it now. */
async function sharedPartOf(
  api: APIRequestContext,
  id: string
): Promise<PartState> {
  const search = new URLSearchParams({ collection: COLLECTION, id });
  const read = await api.get(
    `${API}/workflows/review-state?${search.toString()}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  const { parts } = (await read.json()) as { parts: PartState[] };
  const shared = parts.find(part => part.part === null);
  if (shared === undefined) {
    throw new Error(`[e2e] No shared part in the review state of ${id}.`);
  }
  return shared;
}

/** Sends a note for review, with what its shared part reads now. */
async function submitted(api: APIRequestContext, id: string): Promise<void> {
  const part = await sharedPartOf(api, id);
  const taken = await api.post(`${API}/workflows/steps`, {
    data: {
      document: { collection: COLLECTION, id },
      step: "submit",
      parts: [null],
      seen: [{ part: null, revision: part.revision, version: part.version }],
    },
  });
  expect(taken.ok(), await taken.text()).toBe(true);
}

test("a reviewer finds the notes waiting for review from the Content panel", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const tag = uniqueTag();
  const titles = [`Waiting note A ${tag}`, `Waiting note B ${tag}`];
  const ids: string[] = [];
  for (const title of titles) {
    const id = await note(page.request, title);
    await submitted(page.request, id);
    ids.push(id);
  }

  const reviewer = await signInWithRoles(browser, page.request, baseURL ?? "", [
    REVIEWER,
  ]);
  const reader = await signInWithRoles(browser, page.request, baseURL ?? "", [
    READER,
  ]);
  try {
    const reviewerPage = await reviewer.context.newPage();
    await reviewerPage.setViewportSize({ width: 1440, height: 900 });
    // Linked from the Content panel for a person who holds a review step.
    await gotoAdmin(reviewerPage, "/collections/reviewed-notes");
    const link = reviewerPage.getByRole("link", {
      name: "Waiting for my review",
    });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    await expect(
      reviewerPage.getByRole("heading", {
        level: 1,
        name: "Waiting for my review",
      })
    ).toBeVisible();
    await expect(reviewerPage.getByText(/^\d+\+? waiting$/)).toBeVisible();
    const table = reviewerPage.getByRole("table", {
      name: "Waiting for my review",
    });
    for (const column of [
      "Title",
      "Collection",
      "Review",
      "Waiting for",
      "Submitted",
    ]) {
      await expect(
        table.getByRole("columnheader", { name: column })
      ).toBeVisible();
    }
    // Each note in review, unassigned, waits for every holder of the step: its
    // title links to its editor.
    for (const [index, title] of titles.entries()) {
      const row = table.getByRole("row").filter({ hasText: title });
      await expect(row).toHaveCount(1);
      // Its collection by the plural label, as the sidebar names it; its stage.
      const cells = row.getByRole("cell");
      await expect(cells.nth(1)).toHaveText("Reviewed notes");
      await expect(cells.nth(2)).toHaveText("In review");
      await expect(row.getByRole("link", { name: title })).toHaveAttribute(
        "href",
        new RegExp(`/collections/${COLLECTION}/${ids[index]}$`)
      );
    }

    // A person who may take no step is offered no such link, once the panel has drawn.
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize({ width: 1440, height: 900 });
    // The link is drawn from the scope's answer, so the absence below is judged after it arrives.
    const scopeRead = readerPage.waitForResponse(response =>
      response.url().includes("/workflows/waiting/scope")
    );
    await gotoAdmin(readerPage, "/collections/reviewed-notes");
    expect((await scopeRead).ok()).toBe(true);
    await expect(
      readerPage.getByRole("navigation", { name: "Content" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      readerPage
        .getByRole("navigation", { name: "Content" })
        .getByRole("link", { name: "Reviewed notes" })
    ).toBeVisible();
    await expect(
      readerPage.getByRole("link", { name: "Waiting for my review" })
    ).toHaveCount(0);
  } finally {
    await reviewer.context.close();
    await reader.context.close();
  }
});

// The list's bulk moves are wired in a later change: this runs once they are.
// TODO: the row selection's accessible names and the summary's container,
// once the wiring lands.
test.fixme(
  "an editor submits notes in bulk from the list, each refusal named",
  async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const tag = uniqueTag();
    const fresh = [`Bulk note A ${tag}`, `Bulk note B ${tag}`];
    const already = `Bulk note in review ${tag}`;
    for (const title of fresh) await note(page.request, title);
    // Already in review, so submitting it again is refused, by name.
    await submitted(page.request, await note(page.request, already));

    const reviewer = await signInWithRoles(
      browser,
      page.request,
      baseURL ?? "",
      [EDITOR]
    );
    try {
      const list = await reviewer.context.newPage();
      await list.setViewportSize({ width: 1440, height: 900 });
      await gotoAdmin(list, "/collections/reviewed-notes");
      for (const title of [...fresh, already]) {
        await list
          .getByRole("row")
          .filter({ hasText: title })
          .getByRole("checkbox")
          .check();
      }
      const bulk = list.getByRole("region", { name: "Bulk actions" });
      await expect(
        bulk.getByRole("button", { name: "Submit for review" })
      ).toBeVisible();
      await expect(bulk.getByRole("button", { name: "Assign…" })).toBeVisible();
      await expect(
        bulk.getByRole("button", { name: "Send back…" })
      ).toBeVisible();
      // Approving is a reviewer's own act on each document, never a bulk one.
      await expect(
        bulk.getByText("Approve from each document's review.")
      ).toBeVisible();
      await expect(bulk.getByRole("button", { name: /^Approve/ })).toHaveCount(
        0
      );

      await bulk.getByRole("button", { name: "Submit for review" }).click();
      // TODO: scope these to the summary's container once its selector lands.
      await expect(list.getByText("2 moved; 1 refused.")).toBeVisible();
      await expect(list.getByText(new RegExp(`^${already}: `))).toBeVisible();
    } finally {
      await reviewer.context.close();
    }
  }
);
