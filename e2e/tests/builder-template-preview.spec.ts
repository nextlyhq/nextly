/**
 * A template is edited against a real entry of the collection it draws,
 * chosen in the Previewing strip pinned above the canvas.
 *
 * 1. The template opens on the most recently updated post the author may
 *    read, as the editor's own list puts it first (other files write posts
 *    alongside this one), marked as a draft where it is one, and the
 *    canvas's bound heading draws its title.
 * 2. The picker lists the posts, the author chooses another, and
 *    Shift+Alt+Down and Shift+Alt+Up step through the list, each switch said
 *    in a toast.
 * 3. With no post to preview, the chip says so, the notice over the canvas
 *    says bound text shows its fallback, and New is offered.
 * 4. An author who may edit the template but read no post sees the same
 *    words, without New, and the canvas draws its fallbacks.
 *
 * The `posts` collection has one template, so this file creates it once (or
 * finds the one an earlier attempt made) and takes the lock that guards it.
 *
 * @module tests/builder-template-preview.spec
 */
import {
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, freeDocumentAt, test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.postsTemplate] });

const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";
const POSTS = "/admin/api/collections/posts/entries";
const TEMPLATES = "/admin/api/collections/templates/entries";

/** The heading the template binds to the post's title, by its node id. */
const HEADING = "00000000-0000-4000-8000-0000001001a1";
/** What the heading draws with no post to read. */
const FALLBACK = "Post title";

/** The template's design: one heading bound to the entry's title. */
const DESIGN = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: HEADING,
      type: "core/heading",
      version: 1,
      props: { text: FALLBACK, level: "h1" },
      bindings: { text: { $bind: "title" } },
    },
  ],
};

/** The CSRF token and origin a cookie-signed write to a plugin route needs. */
async function writeHeaders(
  api: APIRequestContext
): Promise<Record<string, string>> {
  const csrf = await api.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which a
  // browser sends and an API request does not: named here as the site's own.
  return { "x-csrf-token": token, origin: new URL(csrf.url()).origin };
}

/**
 * The posts template's id, created through the template actions route, or
 * the one a retry of this file already made, given this file's design.
 */
async function postsTemplate(api: APIRequestContext): Promise<string> {
  const created = await api.post(`${PLUGIN}/templates/actions`, {
    data: { action: { kind: "create-template", collection: "posts" } },
    headers: await writeHeaders(api),
  });
  let id: string | undefined;
  if (created.ok()) {
    const body = (await created.json()) as {
      item?: { template?: { id?: string } };
      template?: { id?: string };
    };
    id = body.item?.template?.id ?? body.template?.id;
  }
  if (id === undefined) {
    // A collection has one template: an earlier attempt made it.
    const found = await api.get(
      `${TEMPLATES}?where[collection][equals]=posts&limit=1`
    );
    expect(found.ok(), await found.text()).toBe(true);
    const { items } = (await found.json()) as { items: { id: string }[] };
    id = items[0]?.id;
  }
  if (id === undefined) throw new Error("[e2e] No posts template.");
  const designed = await api.patch(`${TEMPLATES}/${id}`, {
    data: { content: DESIGN, _overwrite: true },
  });
  expect(designed.ok(), await designed.text()).toBe(true);
  return id;
}

/** A post of this run, by title, in `status`. */
async function post(
  api: APIRequestContext,
  title: string,
  status: "draft" | "published"
): Promise<string> {
  const response = await api.post(POSTS, {
    data: {
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      status,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openTemplate(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/templates/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The strip's chip, by the accessible name it carries. */
function chip(page: Page) {
  return page.locator(".nx-preview-strip__chip");
}

test.describe("previewing a template with a real entry", () => {
  test.describe.configure({ timeout: 240_000 });

  let templateId: string;

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    try {
      templateId = await postsTemplate(admin);
    } finally {
      await admin.dispose();
    }
  });

  test("opens on the most recently updated post, a draft marked as one, drawn on the canvas", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `TP${Date.now().toString(36)}`;
    await post(page.request, `${mark} Published post`, "published");
    // Made last, and more than a second later, so it is the most recently
    // updated: SQLite keeps `updatedAt` to the second, and two posts made in
    // one second tie, which the id would then order either way.
    await page.waitForTimeout(1_100);
    const draft = `${mark} Draft post`;
    await post(page.request, draft, "draft");
    // The list the editor itself is answered with as it opens. Other files
    // write posts to the same database at the same time, so the newest post
    // is whichever that answer puts first, not necessarily the one made
    // here: the editor is held to its own list, which no other post can make
    // disagree with what it opens on.
    const listed = page.waitForResponse(
      response =>
        response.url().includes(`${PLUGIN}/template-preview/entries`) &&
        response.request().method() === "POST"
    );
    await openTemplate(page, templateId);
    const { items } = (await (await listed).json()) as {
      items: {
        id: string;
        title: string;
        status: string;
        updatedAt: string | null;
      }[];
    };
    const [newest] = items;
    if (newest === undefined)
      throw new Error("[e2e] The editor listed no post.");
    // Newest first, and this file's draft among them: listed after the
    // published post made before it.
    const times = items.map(item => item.updatedAt ?? "");
    expect(times).toEqual([...times].sort().reverse());
    expect(items.map(item => item.title)).toContain(draft);

    await expect(page.getByText("Previewing", { exact: true })).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName(
      `Previewing ${newest.title}, ${newest.status}`,
      { timeout: 30_000 }
    );
    // The canvas reads the previewed post, a draft included.
    await expect(canvasBlock(page, HEADING)).toHaveText(newest.title, {
      timeout: 30_000,
    });
    // Marked as a draft where it is one: this file's own post, unless
    // another file's newer one came first, which is marked by its status.
    if (newest.status === "draft") {
      await expect(chip(page)).toContainText("Draft");
    }
  });

  test("chooses another post in the picker, and steps through the list with the keys", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `TK${Date.now().toString(36)}`;
    const older = `${mark} Older post`;
    await post(page.request, older, "published");
    await post(page.request, `${mark} Newer post`, "draft");
    await openTemplate(page, templateId);
    await expect(chip(page)).toHaveAccessibleName(/^Previewing /, {
      timeout: 30_000,
    });

    // The picker: a search on the server, the posts with their status.
    await chip(page).click();
    await page.getByPlaceholder("Search posts").fill(mark);
    const options = page.getByRole("option");
    await expect(options).toHaveCount(2, { timeout: 30_000 });
    // Found by title rather than place: the two may share `updatedAt`.
    await expect(options.filter({ hasText: "Newer post" })).toContainText(
      "Draft"
    );
    await options.filter({ hasText: older }).click();
    await expect(chip(page)).toHaveAccessibleName(
      `Previewing ${older}, published`
    );
    await expect(canvasBlock(page, HEADING)).toHaveText(older, {
      timeout: 30_000,
    });

    // The keys, from outside any field: each previews another post and
    // says which in a toast.
    await page.getByText("Previewing", { exact: true }).click();
    const before = await chip(page).getAttribute("aria-label");
    await page.keyboard.press("Shift+Alt+ArrowDown");
    await expect(chip(page)).not.toHaveAccessibleName(before ?? "");
    const after = (await chip(page).getAttribute("aria-label")) ?? "";
    const title = after.replace(/^Previewing /, "").replace(/, \w+$/, "");
    await expect(
      page.locator("[data-sonner-toast]").filter({
        hasText: `Previewing ${title}`,
      })
    ).toBeVisible();
    await page.keyboard.press("Shift+Alt+ArrowUp");
    await expect(chip(page)).toHaveAccessibleName(before ?? "");
  });

  test("says there is no post to preview, and offers New, where none can be listed", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    // Other files make posts while this one runs, so the empty list is the
    // route's real answer with its rows taken out: its labels and the create
    // right are still the server's own.
    await page.route("**/template-preview/entries", async (route: Route) => {
      try {
        const response = await route.fetch();
        const body = (await response.json()) as {
          items: unknown[];
          meta: Record<string, unknown>;
        };
        await route.fulfill({
          response,
          json: {
            items: [],
            meta: { ...body.meta, total: 0, totalPages: 0, hasNext: false },
          },
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await openTemplate(page, templateId);

    await expect(chip(page)).toHaveAccessibleName("No posts to preview", {
      timeout: 30_000,
    });
    const notice = page.locator(".nx-preview-notice");
    await expect(notice).toContainText(
      "No posts to preview. Bound text shows its fallback until there is one."
    );
    await expect(
      notice.getByRole("button", { name: "New post" })
    ).toBeVisible();
    await expect(canvasBlock(page, HEADING)).toHaveText(FALLBACK);
  });

  test.describe("for an author who may edit the template and read no post", () => {
    let author: LimitedUser;
    let admin: APIRequestContext;

    test.beforeAll(async ({ browser, playwright }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      if (baseURL === undefined) {
        throw new Error("[e2e] No baseURL configured.");
      }
      admin = await playwright.request.newContext({
        baseURL,
        storageState: await fileAccount(baseURL, testInfo),
      });
      author = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-templates",
        "update-templates",
        "read-components",
      ]);
    });

    test.afterAll(async () => {
      await author?.context.close();
      await admin?.dispose();
    });

    test("sees the same words, without New, and the canvas's fallbacks", async () => {
      // A post exists that they may not read.
      await post(admin, `TR${Date.now().toString(36)} Unreadable`, "published");
      // The tests before this one held the template open as another author,
      // and a document someone else holds opens read-only, with no strip.
      await freeDocumentAt(
        admin,
        { scopeKind: "collection", slug: "templates", entryId: templateId },
        "template"
      );
      const page = await author.context.newPage();
      await openTemplate(page, templateId);

      await expect(chip(page)).toHaveAccessibleName("No posts to preview", {
        timeout: 30_000,
      });
      await expect(page.locator(".nx-preview-notice")).toContainText(
        "No posts to preview. Bound text shows its fallback until there is one."
      );
      await expect(page.getByRole("button", { name: "New post" })).toHaveCount(
        0
      );
      await expect(canvasBlock(page, HEADING)).toHaveText(FALLBACK);
    });
  });
});
