import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { answeredNotFound } from "../support/not-found";
import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * An entry's own design, from the admin to the page a visitor is served, in a
 * PRODUCTION build.
 *
 * The playground serves `/blog/<slug>` through its one content route, which
 * draws each post with what the page builder answers for that post: its own
 * published design where it has one, else the Posts template. One post here
 * is given its own design from its Design section, which starts as a draft
 * copy of the template, so visitors keep seeing the template until the copy,
 * changed, is published; then that post alone is drawn with it, and the
 * other post keeps the template. The list marks the post in its Design
 * column. Deleting the template, from its own screen, says first that the
 * post's own design is kept, and is kept: the post is still served with it,
 * while the post without one stops being a page. Removing the own design,
 * from the post's Design section, takes the post off the site too.
 *
 * The template and the posts are written through the API the editor writes
 * with, and every page is read as an anonymous visitor, because the claim is
 * about what the site serves. Each text is stamped per run, so finding one
 * cannot be a coincidence.
 *
 * @module tests/production/entry-own-design
 */

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const ACTIONS = `${PLUGIN}/templates/actions`;
const DESIGNS = `${PLUGIN}/templates/entry-designs`;
const TEMPLATES = `${API}/collections/templates/entries`;
const POSTS = `${API}/collections/posts/entries`;

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const TEMPLATE_TITLE = `Posts layout ${STAMP}`;
const REDESIGNED = { title: `Redesigned post ${STAMP}`, slug: `re-${STAMP}` };
const PLAIN = { title: `Plain post ${STAMP}`, slug: `plain-${STAMP}` };
/** The heading the template draws, and the one the own design draws. */
const TEMPLATE_HEADING = `Drawn by the template ${STAMP}`;
const OWN_HEADING = `Drawn by its own design ${STAMP}`;

/**
 * How long a page may take to show a write: a few seconds of rendering, and
 * well under the 30 seconds after which a cached read expires on its own.
 */
const WRITE_REFRESH_MS = 12_000;

/** A Posts design: a fixed heading, and the post's title as its own. */
function design(heading: string) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "design-mark",
        type: "core/heading",
        version: 1,
        props: { text: heading, level: "h2" },
      },
      {
        id: "post-title",
        type: "core/heading",
        version: 1,
        props: { text: "Untitled", level: "h1" },
        bindings: { text: { $bind: "title", fallback: "Untitled" } },
      },
    ],
  };
}

/** Fail with the server's message rather than with a bare status code. */
async function idOf(response: APIResponse, what: string): Promise<string> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { item?: { id?: unknown } };
  const id = body.item?.id;
  if (typeof id !== "string") {
    throw new Error(`${what} answered no id: ${JSON.stringify(body)}`);
  }
  return id;
}

async function expectOk(response: APIResponse, what: string): Promise<void> {
  expect(response.ok(), `${what}: ${await response.text()}`).toBe(true);
}

/**
 * The headers a plugin route checks: the double-submit token and the origin,
 * as the admin's own requests carry them.
 */
async function pluginHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = await page.request.get(`${API}/auth/csrf`);
  expect(csrf.ok()).toBe(true);
  const { token } = (await csrf.json()) as { token: string };
  return { "x-csrf-token": token, origin: new URL(page.url()).origin };
}

/** Run one template action as the signed-in page; fail with the server's words. */
async function act(page: Page, action: Record<string, unknown>): Promise<void> {
  await expectOk(
    await page.request.post(ACTIONS, {
      headers: await pluginHeaders(page),
      data: { action },
    }),
    `the ${String(action.kind)} action`
  );
}

interface DesignsAnswer {
  items: Array<{ id: string; entryId: string; title: string; status: string }>;
  meta: { template: { id: string; title: string; status: string } | null };
}

/** What the page builder answers for the posts, or for one post. */
async function designs(
  api: APIRequestContext,
  entry?: string
): Promise<DesignsAnswer> {
  const query =
    entry === undefined ? "" : `&entry=${encodeURIComponent(entry)}`;
  const response = await api.get(`${DESIGNS}?collection=posts${query}`);
  await expectOk(response, "reading the posts' own designs");
  return (await response.json()) as DesignsAnswer;
}

/** A path as an anonymous visitor gets it: its status, and its text. */
async function visit(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; html: string }> {
  const response = await request.get(path, { headers: { cookie: "" } });
  return { status: response.status(), html: await response.text() };
}

/**
 * Poll what a visitor reads at `path` until `served` says it shows the
 * change, for at most {@link WRITE_REFRESH_MS}. Fails with what was served
 * last.
 */
async function servedAt(
  request: APIRequestContext,
  path: string,
  what: string,
  served: (page: { status: number; html: string }) => boolean
): Promise<void> {
  let last = { status: 0, html: "" };
  await expect
    .poll(
      async () => {
        last = await visit(request, path);
        return served(last);
      },
      { timeout: WRITE_REFRESH_MS, intervals: [250, 500, 1_000], message: what }
    )
    .toBe(true)
    .catch((error: unknown) => {
      const drew = [TEMPLATE_HEADING, OWN_HEADING].filter(text =>
        last.html.includes(text)
      );
      throw new Error(
        `${String(error)}\n${path} last answered ${String(last.status)}, drawing ${drew.length === 0 ? "neither heading" : drew.join(" and ")}`
      );
    });
}

/** Whether a page is drawn with `heading` and not with the other one. */
function drawnWith(heading: string) {
  const other = heading === OWN_HEADING ? TEMPLATE_HEADING : OWN_HEADING;
  return ({ status, html }: { status: number; html: string }) =>
    status === 200 && html.includes(heading) && !html.includes(other);
}

/** A post's page in a visitor's own browser: its design's heading, and its title. */
async function expectVisitorSees(
  browser: Browser,
  path: string,
  heading: string,
  title: string
): Promise<void> {
  const context = await browser.newContext();
  try {
    const visitor = await context.newPage();
    const response = await visitor.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(
      visitor.getByRole("heading", { level: 2, name: heading, exact: true })
    ).toBeVisible();
    await expect(
      visitor.getByRole("heading", { level: 1, name: title, exact: true })
    ).toBeVisible();
  } finally {
    await context.close();
  }
}

/**
 * Open the document's side panel, where the Design section and a template's
 * own designs are drawn. It is closed at this suite's desktop width, and may
 * be open already, so it is opened only when its toggle offers to show it.
 */
async function showDocumentPanel(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show document panel" });
  const hide = page.getByRole("button", { name: "Hide document panel" });
  await expect(show.or(hide)).toBeVisible();
  if (await show.isVisible()) await show.click();
  await expect(hide).toBeVisible();
}

// A control that never appears fails its step in half a minute, not at the
// test's whole budget.
test.use({ actionTimeout: 30_000 });

test.describe("an entry's own design", () => {
  test("draws its entry once published, is kept when the template is deleted, and goes when removed", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(300_000);
    const api = await signIn(page);

    // A collection has one template. An earlier spec in the run may have
    // left the posts one, so it goes first and the template here is the one
    // every post is drawn with.
    const left = (await designs(api)).meta.template;
    if (left !== null) {
      await act(page, { kind: "delete-template", id: left.id });
    }

    // The Posts template, published, and two published posts.
    const templateId = await idOf(
      await api.post(TEMPLATES, {
        data: {
          title: TEMPLATE_TITLE,
          collection: "posts",
          content: design(TEMPLATE_HEADING),
          status: "published",
        },
      }),
      "publishing the Posts template"
    );
    const redesignedId = await idOf(
      await api.post(POSTS, { data: { ...REDESIGNED, status: "published" } }),
      "publishing the post given its own design"
    );
    await idOf(
      await api.post(POSTS, { data: { ...PLAIN, status: "published" } }),
      "publishing the post left with the template"
    );
    const redesignedPath = `/blog/${REDESIGNED.slug}`;
    const plainPath = `/blog/${PLAIN.slug}`;
    for (const path of [redesignedPath, plainPath]) {
      await servedAt(
        request,
        path,
        `${path} drawn with the template`,
        drawnWith(TEMPLATE_HEADING)
      );
    }

    let designId = "";
    await test.step("the Design section gives the post its own design, a draft", async () => {
      await gotoAdmin(page, `/collections/posts/${redesignedId}`);
      await showDocumentPanel(page);
      const section = page.getByRole("region", { name: "Design", exact: true });
      await section
        .getByRole("button", { name: "Give this post its own design" })
        .click();
      await expect(section).toContainText("Own design · not published");
      await expect(section).toContainText(
        `Visitors still see the ${TEMPLATE_TITLE} template until you publish this design.`
      );
      await expect(
        section.getByRole("button", { name: "Edit design" })
      ).toBeVisible();

      const given = (await designs(api, redesignedId)).items;
      expect(given.map(({ entryId, status }) => ({ entryId, status }))).toEqual(
        [{ entryId: redesignedId, status: "draft" }]
      );
      const first = given[0];
      if (first === undefined) throw new Error("the post has no own design");
      designId = first.id;
      // A draft own design is never served: visitors still see the template.
      await servedAt(
        request,
        redesignedPath,
        "a draft own design leaves its post drawn with the template",
        drawnWith(TEMPLATE_HEADING)
      );
    });

    await test.step("changed and published, the own design draws that post alone", async () => {
      await expectOk(
        await api.patch(`${TEMPLATES}/${designId}`, {
          data: {
            content: design(OWN_HEADING),
            status: "draft",
            // Replaces what is stored: this edit is not about stale ones.
            _overwrite: true,
          },
        }),
        "changing the own design's heading"
      );
      await act(page, { kind: "publish-template", id: designId });

      await servedAt(
        request,
        redesignedPath,
        "the published own design draws its post",
        drawnWith(OWN_HEADING)
      );
      await expectVisitorSees(
        browser,
        redesignedPath,
        OWN_HEADING,
        REDESIGNED.title
      );
      // The other post keeps the template.
      await servedAt(
        request,
        plainPath,
        "a post without its own design keeps the template",
        drawnWith(TEMPLATE_HEADING)
      );
      await expectVisitorSees(
        browser,
        plainPath,
        TEMPLATE_HEADING,
        PLAIN.title
      );
    });

    await test.step("the list's Design column marks the post with its own design", async () => {
      await gotoAdmin(page, "/collections/posts");
      await expect(
        page.getByRole("columnheader", { name: "Design", exact: true })
      ).toBeVisible({ timeout: 30_000 });
      // A row that opens its entry is a button; the phone-width card drawing
      // the same entry stays hidden.
      const row = (title: string) =>
        page
          .getByRole("button", { name: new RegExp(title) })
          .filter({ visible: true });
      await expect(
        row(REDESIGNED.title).locator('[data-own-design="published"]')
      ).toHaveText("Own design");
      await expect(row(PLAIN.title)).toContainText("Template");
      await expect(row(PLAIN.title).locator("[data-own-design]")).toHaveCount(
        0
      );
    });

    await test.step("deleting the template says the own design is kept, and keeps it", async () => {
      await gotoAdmin(page, `/collections/templates/${templateId}`);
      await showDocumentPanel(page);
      await expect(
        page.getByRole("list", { name: "1 post has its own design" })
      ).toContainText(REDESIGNED.title);

      // The dialog asks the site first, as a dry run of the delete.
      const judged = page.waitForResponse(
        response =>
          response.url().endsWith("/templates/actions") &&
          (response.request().postDataJSON() as { dryRun?: unknown } | null)
            ?.dryRun === true
      );
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /^Delete/ }).click();
      const dialog = page.getByRole("alertdialog", {
        name: `Delete the ${TEMPLATE_TITLE} template?`,
      });
      await expect(dialog).toBeVisible();
      const dryRun = await judged;
      expect(dryRun.ok(), await dryRun.text()).toBe(true);
      expect(
        ((await dryRun.json()) as { item: { dryRun: boolean; refusals: [] } })
          .item
      ).toMatchObject({ dryRun: true, refusals: [] });
      await expect(dialog).toContainText(
        "Posts without their own design stop being shown as pages"
      );
      const kept = dialog.getByRole("list", {
        name: "Posts with their own design",
      });
      await expect(kept).toContainText(REDESIGNED.title);
      await expect(kept).toContainText("Still shown");
      await expect(dialog).toContainText("1 · kept");

      const confirm = dialog.getByRole("button", { name: "Delete template" });
      await expect(confirm).toBeEnabled({ timeout: 30_000 });
      await confirm.click();
      await expect
        .poll(async () =>
          (await api.get(`${TEMPLATES}/${templateId}`)).status()
        )
        .toBe(404);

      // The own design outlives its template; the post without one is no
      // longer a page.
      await servedAt(
        request,
        redesignedPath,
        "the own design still draws its post once the template is deleted",
        drawnWith(OWN_HEADING)
      );
      await servedAt(
        request,
        plainPath,
        "a post without its own design is not found once the template is deleted",
        answeredNotFound
      );
    });

    await test.step("removing the own design takes its post off the site", async () => {
      await gotoAdmin(page, `/collections/posts/${redesignedId}`);
      await showDocumentPanel(page);
      const section = page.getByRole("region", { name: "Design", exact: true });
      await expect(section).toContainText(
        "Visitors see this post's own design."
      );
      await section.getByRole("button", { name: "Remove own design…" }).click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove this post's own design?",
      });
      const confirm = dialog.getByRole("button", {
        name: "Remove own design",
        exact: true,
      });
      await expect(confirm).toBeEnabled({ timeout: 30_000 });
      await confirm.click();
      await expect(dialog).toBeHidden();
      // With no template either, the post is drawn with nothing.
      await expect(section).toContainText("No template");

      expect((await designs(api, redesignedId)).items).toEqual([]);
      await servedAt(
        request,
        redesignedPath,
        "a post whose own design was removed, with no template, is not found",
        served => answeredNotFound(served) && !served.html.includes(OWN_HEADING)
      );
    });
  });
});
