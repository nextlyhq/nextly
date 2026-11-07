import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { settleTransitions } from "../support/axe-scan.mjs";
import { test } from "../support/visible";

/**
 * Delete component, against a PRODUCTION build: the one way a component is
 * deleted. The document's own Delete, in its "…" menu, is "Delete
 * component…", and so is each list row's action; both open the dialog, which
 * turns every copy into plain blocks and then deletes the component.
 *
 * Covered here: the dialog's offer for a used component (focus on Cancel, the
 * documents named, WCAG AA in both schemes), the whole delete to its end with
 * the page's copy turned into plain blocks, a component nothing uses, a
 * component a Layout uses (refused, nothing to confirm), and the list's row
 * action. The other states (someone else's delete, a partly done delete, no
 * permission) are the unit suite's, against the route's answers, and the
 * route's behaviour is the integration suite's.
 *
 * Every component, page and Layout is made here under a unique name, so
 * nothing reads or writes what another spec owns.
 *
 * @module tests/production/builder-component-delete
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

const API = "/admin/api";
const COMPONENTS = `${API}/collections/components/entries`;
const PAGES = `${API}/collections/pages/entries`;
const LAYOUTS = `${API}/collections/layouts/entries`;
const INSTANCE = "nextly/component-instance";

/** The WCAG 2.2 AA rule tags, as the other accessibility scans name them. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const CONVERT = "Turn each copy into plain blocks, then delete";

/** Distinctive per call, so finding a text cannot be a coincidence. */
const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// The delete walks every document on the site in steps, so a test gives it
// room; one worker runs the file's tests in order.
test.describe.configure({ timeout: 240_000 });

/** Sign in through the real form; dev auto-login is blocked here. */
async function signIn(page: Page): Promise<APIRequestContext> {
  await page.goto("/admin");
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  // By role, not label: "Show password" also matches a password label.
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  return page.request;
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

/** A published component holding one heading; answers its id and title. */
async function component(
  api: APIRequestContext,
  text: string
): Promise<{ id: string; title: string }> {
  const tag = stamp();
  const title = `Delete me ${tag}`;
  const id = await idOf(
    await api.post(COMPONENTS, {
      data: {
        title,
        slug: `delete-me-${tag}`,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "cd-heading",
              type: "core/heading",
              version: 1,
              props: { text, level: "h2" },
            },
          ],
        },
      },
    }),
    "creating the component"
  );
  return { id, title };
}

/** A published page placing the component; answers its id and title. */
async function pagePlacing(
  api: APIRequestContext,
  componentId: string
): Promise<{ id: string; title: string }> {
  const tag = stamp();
  const title = `Places it ${tag}`;
  const id = await idOf(
    await api.post(PAGES, {
      data: {
        title,
        slug: `places-it-${tag}`,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "cd-place",
              type: INSTANCE,
              version: 1,
              props: { componentId },
            },
          ],
        },
      },
    }),
    "creating the page"
  );
  return { id, title };
}

/** Open a component's edit screen and its Delete component dialog. */
async function openDelete(
  page: Page,
  id: string,
  scheme: "light" | "dark" = "light"
): Promise<Locator> {
  await gotoAdmin(page, `/collections/components/${id}`, scheme);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete component…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await checked(dialog);
  return dialog;
}

/**
 * Wait until the dry run has read every slice of the site: on a production
 * build with the suite's seed that can take longer than an expectation's
 * default wait.
 */
async function checked(dialog: Locator): Promise<void> {
  await expect(dialog).not.toContainText(/Checking where|Still checking/, {
    timeout: 120_000,
  });
}

/** Every node type a stored document holds, nested slots included. */
function nodeTypes(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap(node => {
    const typed = node as { type?: unknown; slots?: Record<string, unknown> };
    const own = typeof typed.type === "string" ? [typed.type] : [];
    const nested = Object.values(typed.slots ?? {}).flatMap(nodeTypes);
    return [...own, ...nested];
  });
}

test.describe("Delete component", () => {
  test("is the editor's own Delete, lists the documents that use it, and starts on Cancel", async ({
    page,
  }) => {
    const api = await signIn(page);
    const used = await component(api, `Copy ${stamp()}`);
    const placing = await pagePlacing(api, used.id);

    await gotoAdmin(page, `/collections/components/${used.id}`);
    // The editor's own Delete is Delete component: a component's own
    // delete is refused unless it is Delete component's last step.
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete", exact: true })
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Delete component…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete component" });
    await checked(dialog);
    await expect(dialog).toContainText("is used in 1 document");
    const link = dialog.getByRole("link", { name: placing.title });
    await expect(link).toHaveAttribute(
      "href",
      `/admin/collections/pages/${placing.id}`
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(dialog.getByRole("button", { name: CONVERT })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    const still = await api.get(`${COMPONENTS}/${used.id}`);
    expect(still.status()).toBe(200);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`offers the delete in words and colours that pass WCAG AA (${scheme})`, async ({
      page,
    }) => {
      const api = await signIn(page);
      const used = await component(api, `Copy ${stamp()}`);
      await pagePlacing(api, used.id);
      await page.emulateMedia({ reducedMotion: "reduce" });

      const dialog = await openDelete(page, used.id, scheme);
      await expect(dialog.getByRole("button", { name: CONVERT })).toBeVisible();
      await settleTransitions(page);

      // The design system's destructive button is an accepted contrast
      // pairing in light mode (`packages/ui/src/styles/contrast/accepted.ts`,
      // white on the palette's red): it is judged there, not here.
      const results = await new AxeBuilder({ page })
        .include('[role="alertdialog"]')
        .exclude('[role="alertdialog"] .bg-destructive-solid')
        .withTags(AA_TAGS)
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("turns the page's copy into plain blocks, deletes the component, and returns to the list", async ({
    page,
  }) => {
    const api = await signIn(page);
    const text = `Kept on the page ${stamp()}`;
    const used = await component(api, text);
    const placing = await pagePlacing(api, used.id);

    const dialog = await openDelete(page, used.id);
    await dialog.getByRole("button", { name: CONVERT }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Component deleted" })
    ).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "Back to the list" }).click();
    await expect(page).toHaveURL(/\/admin\/collections\/components$/);

    const gone = await api.get(`${COMPONENTS}/${used.id}`);
    expect(gone.status()).toBe(404);
    // The page keeps what it showed, as plain blocks no longer linked.
    const read = await api.get(`${PAGES}/${placing.id}`);
    expect(read.ok()).toBe(true);
    type Stored = { content?: { nodes?: unknown } };
    const body = (await read.json()) as Stored & { item?: Stored };
    const types = nodeTypes((body.item ?? body).content?.nodes);
    expect(types).not.toContain(INSTANCE);
    expect(types).toContain("core/heading");
    expect(JSON.stringify((body.item ?? body).content)).toContain(text);
  });

  test("deletes a component nothing uses once the author confirms", async ({
    page,
  }) => {
    const api = await signIn(page);
    const unused = await component(api, `Unused ${stamp()}`);

    const dialog = await openDelete(page, unused.id);
    await expect(dialog).toContainText("Nothing uses this component");
    await dialog.getByRole("button", { name: "Delete component" }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Component deleted" })
    ).toBeVisible({ timeout: 120_000 });

    const gone = await api.get(`${COMPONENTS}/${unused.id}`);
    expect(gone.status()).toBe(404);
  });

  test("refuses a component a Layout uses, naming the Layout, with nothing to confirm", async ({
    page,
  }) => {
    const api = await signIn(page);
    const header = await component(api, `Header ${stamp()}`);
    const tag = stamp();
    const layoutTitle = `Uses the header ${tag}`;
    const layoutId = await idOf(
      await api.post(LAYOUTS, {
        data: {
          title: layoutTitle,
          slug: `uses-the-header-${tag}`,
          areas: [{ area: "header", component: header.id }],
          status: "published",
        },
      }),
      "creating the Layout"
    );

    await openDelete(page, header.id);
    const refused = page.getByRole("alertdialog", {
      name: "This component can't be deleted yet",
    });
    await expect(refused).toContainText("A Layout uses this component");
    await expect(
      refused.getByRole("link", { name: layoutTitle })
    ).toHaveAttribute("href", `/admin/collections/layouts/${layoutId}`);
    await expect(refused.getByRole("button", { name: CONVERT })).toHaveCount(0);
    await expect(
      refused.getByRole("button", { name: "Delete component" })
    ).toHaveCount(0);
    const still = await api.get(`${COMPONENTS}/${header.id}`);
    expect(still.status()).toBe(200);
  });

  test("is offered on each row of the Components list, which offers no Delete of its own", async ({
    page,
  }) => {
    const api = await signIn(page);
    const listed = await component(api, `Listed ${stamp()}`);

    await gotoAdmin(page, "/collections/components");
    // A list row is a button (it opens the entry), not a `row`, so it is
    // found as the table row holding the title.
    const row = page.locator("tr", { hasText: listed.title });
    await row.getByRole("button", { name: "Row actions", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete component…" })
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Delete$/ })).toHaveCount(
      0
    );
    await page.getByRole("menuitem", { name: "Delete component…" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Delete component" });
    await checked(dialog);
    await expect(dialog).toContainText(listed.title);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  });
});
