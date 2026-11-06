/**
 * An author who may edit pages and only read components changes a placed
 * header's exposed fields, and nothing else of it.
 *
 * The author holds a role with read and update on pages and read on
 * components, and no more. They edit the header's exposed headline on the
 * canvas and save it to the page. They are offered no way into the header's
 * own design: no "Edit component", no Style tab for the placement, and the
 * component's own builder opens read-only, while the write it would make is
 * refused. And they cannot reach what the header does not expose: its own
 * text stays the component's, and the panel lists the exposed fields only.
 *
 * `builder-placement-fields.spec.ts` covers the same fields for an author who
 * may do everything; `builder-edit-component.spec.ts` the "Edit component"
 * offer itself.
 *
 * @module tests/builder-placement-fields-rights.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasRoot, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { fileAccount, test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const COMPONENT_TITLE = "Rights header";

/**
 * A header exposing its headline (text), its level (a choice), its button's
 * link and whether the button is shown. The strap is not exposed: it is the
 * component's own text.
 */
function headerDefinition() {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      {
        id: "headline",
        type: "core/heading",
        version: 1,
        props: { text: "Site name", level: "h2" },
      },
      {
        id: "strap",
        type: "core/text",
        version: 1,
        props: { text: "Made with care" },
      },
      {
        id: "cta",
        type: "core/button",
        version: 1,
        props: { label: "Get started", href: "/signup" },
      },
    ],
    exposed: [
      {
        id: "headline",
        label: "Headline",
        nodeId: "headline",
        propPath: "text",
        type: "text",
      },
      {
        id: "level",
        label: "Heading level",
        nodeId: "headline",
        propPath: "level",
        type: "select",
        options: [
          { value: "h2", label: "H2" },
          { value: "h3", label: "H3" },
        ],
      },
      {
        id: "ctaLink",
        label: "Button link",
        nodeId: "cta",
        propPath: "href",
        type: "link",
      },
      {
        id: "ctaShown",
        label: "Button shown",
        nodeId: "cta",
        propPath: "visibility",
        type: "visibility",
      },
    ],
  };
}

/**
 * A published header and a draft page holding a heading of its own and one
 * placement of the header, made by the super-admin; answers both ids.
 */
async function seed(
  admin: APIRequestContext
): Promise<{ pageId: string; componentId: string }> {
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const component = await admin.post(COMPONENTS, {
    data: {
      title: COMPONENT_TITLE,
      slug: `rights-header-${tag}`,
      content: headerDefinition(),
      status: "published",
    },
  });
  expect(component.ok(), `seeding the component: ${component.status()}`).toBe(
    true
  );
  const componentId = ((await component.json()) as { item: { id: string } })
    .item.id;
  const created = await admin.post(PAGES, {
    data: {
      title: "Placement rights",
      slug: `placement-rights-${tag}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "intro",
            type: "core/heading",
            version: 1,
            props: { text: "On the page", level: "h1" },
          },
          {
            id: "p1",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  const pageId = ((await created.json()) as { item: { id: string } }).item.id;
  return { pageId, componentId };
}

/** Whether a response is the builder's answer about what this author may do. */
const isCapabilityAnswer = (response: { url(): string }) =>
  new URL(response.url()).pathname.endsWith("/capability");

/**
 * Open the page's builder and wait for the placement to draw and for the
 * author's capability answer, which the "Edit component" offer is drawn from:
 * before it lands the offer is absent for everyone.
 */
async function openBuilder(page: Page, pageId: string): Promise<void> {
  const answered = page.waitForResponse(
    response => isCapabilityAnswer(response) && response.ok()
  );
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(await headline(page)).toBeVisible({ timeout: 30_000 });
  await answered;
}

/** The placement's headline on the canvas. */
async function headline(page: Page): Promise<Locator> {
  const root = await canvasRoot(page);
  return root
    .locator(
      '[data-nx-instance="p1"][data-nx-prop="text"], [data-nx-instance="p1"] [data-nx-prop="text"]'
    )
    .first();
}

/** The placement's strap, the component's own text, on the canvas. */
async function strap(page: Page): Promise<Locator> {
  return (await canvasRoot(page))
    .locator('[data-nx-instance="p1"]')
    .filter({ hasText: "Made with care" })
    .last();
}

/** Select the placement by clicking its headline, and wait for its panel. */
async function selectPlacement(page: Page): Promise<void> {
  await (await headline(page)).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(COMPONENT_TITLE) })
  ).toBeVisible();
}

/** The page's nodes as stored, by id, read by the super-admin. */
async function storedNodes(
  admin: APIRequestContext,
  pageId: string
): Promise<Record<string, { props: Record<string, unknown> }>> {
  // Every status: the page is a draft, which a plain read leaves out.
  const read = await admin.get(`${PAGES}/${pageId}?status=all`);
  expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as { nodes: { id: string; props: Record<string, unknown> }[] };
  return Object.fromEntries(content.nodes.map(node => [node.id, node]));
}

/** The component's row as stored, as text, read by the super-admin. */
async function storedComponent(
  admin: APIRequestContext,
  componentId: string
): Promise<string> {
  const read = await admin.get(`${COMPONENTS}/${componentId}?status=all`);
  expect(read.ok(), `reading the component: ${read.status()}`).toBe(true);
  return JSON.stringify(await read.json());
}

// One limited author for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial", timeout: 180_000 });

let admin: APIRequestContext;
let author: LimitedUser;
let page: Page;
let seeded: { pageId: string; componentId: string };

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  author = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
  ]);
  seeded = await seed(admin);
  page = await author.context.newPage();
});

test.afterAll(async () => {
  await author?.context.close();
  await admin?.dispose();
});

// The page builder's composition exit test 2, run in CI against the production
// build this suite serves; the other six are `production/composition-exit.spec.ts`.
test.describe("exit test 2: only a placed header's exposed fields, with page-editing and component-reading rights", () => {
  test("edits the placement's exposed headline on the canvas and saves it to the page", async () => {
    await openBuilder(page, seeded.pageId);

    const text = await headline(page);
    await text.dblclick();
    await expect(text).toHaveAttribute("contenteditable", /.+/);
    await page.keyboard.type("Acme launch");
    await page.keyboard.press("Enter");
    await expect(await headline(page)).toHaveText("Acme launch");

    const saved = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.endsWith(
          `/entries/${seeded.pageId}`
        ) && ["PATCH", "PUT"].includes(response.request().method())
    );
    await pressSave(page);
    expect((await saved).status()).toBe(200);

    const stored = await storedNodes(admin, seeded.pageId);
    expect(stored.p1?.props.overrides).toEqual({ headline: "Acme launch" });
    const component = await storedComponent(admin, seeded.componentId);
    expect(component).toContain("Site name");
    expect(component).not.toContain("Acme launch");
  });

  test("is offered no way into the component's design from the page", async () => {
    await openBuilder(page, seeded.pageId);

    // CONTROL: a block of the page's own has a Style tab for this author, so the
    // placement's having none below is about the placement.
    await (await canvasRoot(page)).getByText("On the page").click();
    await expect(
      page.getByTestId("inspector").getByRole("tab", { name: "Style" })
    ).toBeVisible();

    await selectPlacement(page);
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByRole("tab", { name: "Style" })).toHaveCount(0);
    await expect(
      page
        .getByRole("toolbar", { name: "Block actions" })
        .getByRole("button", { name: "Edit component" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit component" })
    ).toHaveCount(0);
  });

  test("cannot reach a part of the component it does not expose", async () => {
    await openBuilder(page, seeded.pageId);

    const own = await strap(page);
    await own.dblclick();
    await expect(page.getByText(/^Part of Rights header\./)).toBeVisible();
    await expect(own).not.toHaveAttribute("contenteditable", /.+/);
    await page.keyboard.type("Rewritten");
    await expect(await strap(page)).toHaveText("Made with care");

    // The panel offers the exposed fields and nothing of the strap.
    await expect(
      page.getByRole("heading", { name: new RegExp(COMPONENT_TITLE) })
    ).toBeVisible();
    const labels = page
      .getByTestId("inspector")
      .locator(".nx-inspector__field--exposed label");
    await expect(labels).toHaveText([
      "Headline",
      "Heading level",
      "Button link",
      "Button shown",
    ]);
    const values = await page
      .getByTestId("inspector")
      .getByRole("textbox")
      .evaluateAll(fields =>
        fields.map(field => (field as HTMLInputElement).value)
      );
    expect(values).not.toContain("Made with care");
  });

  test("cannot change the component's own design, in its builder or through the API", async () => {
    await gotoAdmin(
      page,
      `/collections/components/${seeded.componentId}/builder?field=content`
    );
    // Opened read-only: the component is drawn, with no canvas to edit it in.
    await expect(page.getByText("Made with care").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("region", { name: "Canvas" })).toHaveCount(0);

    // A cookie-authenticated write names its origin and token, as a browser's
    // does.
    const csrf = await author.context.request.get("/admin/api/auth/csrf");
    const { token } = (await csrf.json()) as { token: string };
    const headers = {
      "x-csrf-token": token,
      origin: new URL(csrf.url()).origin,
    };
    const redesigned = {
      ...headerDefinition(),
      nodes: headerDefinition().nodes.map(node =>
        node.id === "strap"
          ? { ...node, props: { text: "Rewritten by the author" } }
          : node
      ),
    };

    const refused = await author.context.request.patch(
      `${COMPONENTS}/${seeded.componentId}`,
      { headers, data: { content: redesigned } }
    );
    expect(refused.status(), await refused.text()).toBe(403);
    const component = await storedComponent(admin, seeded.componentId);
    expect(component).toContain("Made with care");
    expect(component).not.toContain("Rewritten by the author");

    // CONTROL: the same author, the same way, may write the page that places
    // it, so the refusal above is about the component.
    const pageWrite = await author.context.request.patch(
      `${PAGES}/${seeded.pageId}`,
      {
        headers,
        data: {
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "p1",
                type: "nextly/component-instance",
                version: 1,
                props: {
                  componentId: seeded.componentId,
                  overrides: { headline: "Through the API" },
                },
              },
            ],
          },
        },
      }
    );
    expect(pageWrite.status(), await pageWrite.text()).toBe(200);
    expect(
      (await storedNodes(admin, seeded.pageId)).p1?.props.overrides
    ).toEqual({ headline: "Through the API" });
  });
});
