/**
 * A `--prepare` scenario for the editor under a workflow, against the playground's
 * `reviewed-notes` collection (held by the preset `review` workflow) and, for comparison, a
 * collection with none. Each view creates its own document through the API, so no state is
 * seeded beforehand and views never share one.
 *
 * Which state a view shows is named by the `state` query of the route it captures:
 *
 * - `/admin/collections/reviewed-notes?state=header`: a note submitted for review, its editor
 *   leading with Approve, Publish held, and the status line under the title;
 * - `?state=ready`: the same, with "Choose what to publish…" open on "Ready to publish?";
 * - `?state=reason`: the same dialog asking the reason to publish without review;
 * - `?state=changes-asked`: the note sent back with a request for changes whose comment holds a
 *   long unbroken token, so the note under the title must wrap it at every width;
 * - `/admin/collections/history-notes?state=no-workflow`: an editor no workflow holds.
 *
 *   pnpm visual-check "/admin/collections/reviewed-notes?state=header" \
 *     --prepare scripts/visual-check/scenarios/workflow-editor.mjs
 *
 * @module scripts/visual-check/scenarios/workflow-editor
 */

const API = "/admin/api";

/** Answers the JSON of a write, or throws naming what failed. */
async function sent(response, what) {
  if (!response.ok()) {
    throw new Error(`${what}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

/** A new document of `collection`, by its id. */
async function created(page, collection, data) {
  const { item } = await sent(
    await page.request.post(`${API}/collections/${collection}/entries`, {
      data,
    }),
    `creating a ${collection} document`
  );
  return String(item.id);
}

/** Takes `step` on a reviewed note's shared part, as it reads now, with `comment` if given. */
async function stepped(page, id, step, comment) {
  const state = await sent(
    await page.request.get(
      `${API}/workflows/review-state?collection=reviewed-notes&id=${encodeURIComponent(id)}`
    ),
    "reading the review state"
  );
  const part = state.parts.find(each => each.part === null);
  if (part === undefined) {
    throw new Error(
      `no shared part in the review state: ${JSON.stringify(state).slice(0, 300)}`
    );
  }
  await sent(
    await page.request.post(`${API}/workflows/steps`, {
      data: {
        document: { collection: "reviewed-notes", id },
        step,
        parts: [null],
        seen: [{ part: null, revision: part.revision, version: part.version }],
        ...(comment === undefined ? {} : { comment }),
      },
    }),
    `taking the ${step} step`
  );
}

/** Opens the editor of a document and waits for its header. */
async function opened(page, collection, id, ready) {
  await page.goto(`/admin/collections/${collection}/${id}`, {
    waitUntil: "load",
  });
  await ready.waitFor({ timeout: 30_000 });
}

/** Opens "Choose what to publish…" from the primary action's arrow. */
async function choosing(page) {
  await page.getByRole("button", { name: "More ways to publish" }).click();
  await page.getByRole("menuitem", { name: "Choose what to publish…" }).click();
  await page.getByRole("region", { name: "Ready to publish?" }).waitFor();
}

export default async (page, { route }) => {
  const state = new URL(route, "http://capture").searchParams.get("state");
  if (state === null) return;
  if (state === "no-workflow") {
    const id = await created(page, "history-notes", {
      title: "Autumn opening hours",
    });
    await opened(
      page,
      "history-notes",
      id,
      page.getByRole("button", { name: /^publish$/i }).first()
    );
    return;
  }
  const id = await created(page, "reviewed-notes", {
    title: "Spring launch notes",
    summary: "What changes for readers when the spring range goes live.",
  });
  await stepped(page, id, "submit");
  if (state === "changes-asked") {
    await stepped(
      page,
      id,
      "requestChanges",
      "Check the link https://example.com/spring-range/launch-notes/2026/final-copy-approved-by-legal-and-marketing-please-confirm before this goes out."
    );
    await opened(
      page,
      "reviewed-notes",
      id,
      page.getByRole("note").filter({ hasText: "Changes requested" })
    );
    return;
  }
  await opened(
    page,
    "reviewed-notes",
    id,
    page.getByRole("button", { name: "Approve" }).first()
  );
  if (state === "header") return;
  await choosing(page);
  if (state === "ready") return;
  await page.getByRole("button", { name: "Publish without review…" }).click();
  await page
    .getByRole("textbox", { name: "Reason" })
    .fill("The embargo lifts at noon and legal approved the copy by phone.");
};
