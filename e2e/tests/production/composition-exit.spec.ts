import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { pressSave } from "../canvas/editor-driver";
import { gotoAdmin } from "../support/admin";
import { test } from "../support/visible";

/**
 * The page builder's composition exit tests, against a PRODUCTION build.
 *
 * Each of the seven is one named test below, except exit test 2, whose four
 * cases need an author holding only page-editing and component-reading
 * rights, and live with the suite that signs such an author in
 * (`../builder-placement-fields-rights.spec.ts`, "exit test 2"). Run them all
 * with `--grep "exit test"` across both configs.
 *
 * Pages are read where a public site serves them: `/site/<slug>`, the
 * playground's cached route over the same pages and Layouts as the root
 * route. A cached page is what lets exit test 3 count rebuilds: Next answers
 * whether it served a stored render (`x-nextjs-cache: HIT`) or made a new one.
 * That count holds only on a server nothing else writes to, which is this
 * suite's: one worker, its own database. A page write from another spec would
 * rightly rebuild every page and say nothing about the publish being measured.
 *
 * Everything is authored through the API the editor writes with, or in the
 * editor itself, and read back as an anonymous visitor, because each claim is
 * about what the product serves for content the product accepted.
 *
 * @module tests/production/composition-exit
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const INSTANCE = "nextly/component-instance";

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);

// One file's tests in order on the one worker, each signing in for itself.
// Not serial: a failing exit test must not hide whether the others pass.
test.describe.configure({ timeout: 300_000 });

type Json = Record<string, unknown>;

interface BlockNodeJson {
  id: string;
  type: string;
  version: number;
  props: Json;
  slots?: Record<string, BlockNodeJson[]>;
  origin?: unknown;
}

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

/** The mutation's `item`, failing with the server's message. */
async function itemOf<T = Json>(
  response: APIResponse,
  what: string
): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what}: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { item?: T };
  if (body.item === undefined) {
    throw new Error(`${what} answered no item: ${JSON.stringify(body)}`);
  }
  return body.item;
}

async function idOf(response: APIResponse, what: string): Promise<string> {
  const { id } = await itemOf<{ id?: unknown }>(response, what);
  if (typeof id !== "string") throw new Error(`${what} answered no id`);
  return id;
}

function heading(id: string, text: string, level = "h2"): BlockNodeJson {
  return { id, type: "core/heading", version: 1, props: { text, level } };
}

function paragraph(id: string, text: string): BlockNodeJson {
  return { id, type: "core/text", version: 1, props: { text } };
}

function placement(id: string, componentId: string, overrides?: Json) {
  return {
    id,
    type: INSTANCE,
    version: 1,
    props: { componentId, ...(overrides ? { overrides } : {}) },
  };
}

const pageDocument = (nodes: unknown[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

/**
 * A card: a heading the placement may set (`title`) and a text that is the
 * card's own (`body`), so a publish of the card shows on a placement that
 * set its title.
 */
function cardDefinition(title: string, body: string) {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [heading("card-title", title, "h3"), paragraph("card-body", body)],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "card-title",
        propPath: "text",
        type: "text",
      },
    ],
  };
}

async function createComponent(
  api: APIRequestContext,
  slug: string,
  content: unknown,
  status: "published" | "draft" = "published"
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: { title: slug, slug: `${slug}-${STAMP}`, content, status },
    }),
    `creating the component ${slug}`
  );
}

async function createLayout(
  api: APIRequestContext,
  slug: string,
  areas: { header?: string; footer?: string }
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `${slug} ${STAMP}`,
        slug: `${slug}-${STAMP}`,
        areas: [
          ...(areas.header
            ? [{ area: "header", component: areas.header }]
            : []),
          ...(areas.footer
            ? [{ area: "footer", component: areas.footer }]
            : []),
        ],
        status: "published",
      },
    }),
    `creating the Layout ${slug}`
  );
}

async function createPage(
  api: APIRequestContext,
  slug: string,
  nodes: unknown[],
  fields: Json = {}
): Promise<{ id: string; path: string }> {
  const id = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${slug} ${STAMP}`,
        slug: `${slug}-${STAMP}`,
        content: pageDocument(nodes),
        status: "published",
        ...fields,
      },
    }),
    `creating the page ${slug}`
  );
  return { id, path: `/site/${slug}-${STAMP}` };
}

/** The page's stored blocks, drafts included. */
async function storedNodes(
  api: APIRequestContext,
  id: string
): Promise<BlockNodeJson[]> {
  const read = await api.get(
    `${API}/collections/pages/entries/${id}?status=all`
  );
  expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Json;
  const item = (body.item ?? body) as Json;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as { nodes: BlockNodeJson[] };
  return content.nodes;
}

function walk(nodes: readonly BlockNodeJson[]): BlockNodeJson[] {
  return nodes.flatMap(node => [
    node,
    ...Object.values(node.slots ?? {}).flatMap(children => walk(children)),
  ]);
}

interface Served {
  status: number;
  /** The drawn markup: no inline scripts, which repeat the tree as data. */
  drawn: string;
  /** Whether Next served a stored render: HIT, or MISS/STALE for a new one. */
  cache: string | undefined;
}

/** The page as an anonymous visitor gets it. */
async function served(
  request: APIRequestContext,
  path: string
): Promise<Served> {
  const response = await request.get(path, { headers: { cookie: "" } });
  const html = await response.text();
  return {
    status: response.status(),
    drawn: html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<title>[\s\S]*?<\/title>/g, ""),
    cache: response.headers()["x-nextjs-cache"],
  };
}

/** Request a cached page until Next serves it from its store. */
async function warmed(
  request: APIRequestContext,
  path: string
): Promise<Served> {
  let last: Served | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    last = await served(request, path);
    expect(last.status, `serving ${path}`).toBe(200);
    if (last.cache === "HIT") return last;
  }
  throw new Error(
    `${path} was never served from the cache (x-nextjs-cache: ${String(last?.cache)})`
  );
}

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

/** The site's default Layout as it stood before this file changed it. */
let previousDefault: string | null | undefined;

async function makeDefault(page: Page, id: string): Promise<void> {
  const made = await page.request.post(`${PLUGIN}/layouts/${id}/make-default`, {
    headers: await pluginHeaders(page),
    data: {},
  });
  expect(made.ok(), `make-default: ${made.status()} ${await made.text()}`).toBe(
    true
  );
}

async function currentDefault(api: APIRequestContext): Promise<string | null> {
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as {
    meta: { defaultLayout: string | null };
  };
  return choices.meta.defaultLayout;
}

test.afterAll(async ({ browser }) => {
  if (previousDefault == null) return;
  const page = await browser.newPage();
  try {
    await signIn(page);
    await makeDefault(page, previousDefault);
  } finally {
    await page.close();
  }
});

test.describe("the composition exit tests", () => {
  test("exit test 1: a pattern inserted twice gives every block its own id", async ({
    page,
  }) => {
    const api = await signIn(page);
    const patternTitle = `Twice ${STAMP}`;
    const patternNodes = [
      {
        id: "pattern-band",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: {
          children: [
            heading("pattern-heading", `Pattern heading ${STAMP}`),
            paragraph("pattern-text", `Pattern text ${STAMP}`),
          ],
        },
      },
    ];
    await itemOf(
      await api.post(`${API}/collections/patterns/entries`, {
        data: {
          title: patternTitle,
          slug: `twice-${STAMP}`,
          granularity: "section",
          content: { formatVersion: 1, kind: "pattern", nodes: patternNodes },
          status: "published",
        },
      }),
      "creating the pattern"
    );
    const target = await idOf(
      await api.post(`${API}/collections/pages/entries`, {
        data: {
          title: `Inserted twice ${STAMP}`,
          slug: `inserted-twice-${STAMP}`,
          content: pageDocument([heading("own-heading", "The page's own")]),
          status: "draft",
        },
      }),
      "creating the page"
    );

    // Inserted from the editor's Add panel, as an author does: twice, one
    // after the other.
    await gotoAdmin(page, `/collections/pages/${target}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    const add = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
    await page.getByRole("tab", { name: "Sections" }).click();
    const tile = page.getByRole("option", { name: patternTitle, exact: true });
    await tile.click();
    await tile.click();
    const saved = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.endsWith(`/entries/${target}`) &&
        ["PATCH", "PUT"].includes(response.request().method()) &&
        response.ok()
    );
    await pressSave(page);
    await saved;

    // Stored: the page's heading and two copies of the pattern's three
    // blocks, every id distinct, none of them the pattern's own.
    const nodes = walk(await storedNodes(api, target));
    const ids = nodes.map(node => node.id);
    expect(nodes.map(node => node.type).sort()).toEqual(
      [
        "core/heading",
        "core/heading",
        "core/heading",
        "core/section",
        "core/section",
        "core/text",
        "core/text",
      ].sort()
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const own of ["pattern-band", "pattern-heading", "pattern-text"]) {
      expect(ids).not.toContain(own);
    }

    // Served, published: both copies drawn, and no two elements share an id.
    await itemOf(
      await api.patch(`${API}/collections/pages/entries/${target}`, {
        data: { status: "published" },
      }),
      "publishing the page"
    );
    const path = `/site/inserted-twice-${STAMP}`;
    const page2 = await served(page.request, path);
    expect(page2.status).toBe(200);
    expect(count(page2.drawn, `Pattern heading ${STAMP}`)).toBe(2);
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: `Pattern heading ${STAMP}` })
    ).toHaveCount(2);
    const domIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[id]"), element => element.id)
    );
    expect(domIds.length).toBe(new Set(domIds).size);
  });

  test("exit test 3: one component publish updates every page that uses it, rebuilding each once", async ({
    page,
  }) => {
    const api = await signIn(page);
    const v1 = `Card body one ${STAMP}`;
    const v2 = `Card body two ${STAMP}`;
    const card = await createComponent(
      api,
      "measured-card",
      cardDefinition(`Card title ${STAMP}`, v1)
    );
    const unrelated = await createComponent(
      api,
      "unrelated-card",
      cardDefinition(`Unrelated title ${STAMP}`, `Unrelated body ${STAMP}`)
    );
    const layout = await createLayout(api, "measured", { header: card });

    // Placed on one page, with a title of its own; drawn as another page's
    // header by its Layout; and a third page that uses neither.
    const placed = await createPage(
      api,
      "places-the-card",
      [placement("placed", card, { title: `Placed title ${STAMP}` })],
      { noHeaderFooter: true }
    );
    const framed = await createPage(
      api,
      "in-the-card-layout",
      [heading("framed-body", `Framed body ${STAMP}`)],
      { layout }
    );
    const other = await createPage(
      api,
      "uses-neither",
      [placement("other", unrelated)],
      { noHeaderFooter: true }
    );

    for (const target of [placed, framed, other]) {
      expect((await warmed(page.request, target.path)).drawn).not.toContain(v2);
    }
    expect((await warmed(page.request, placed.path)).drawn).toContain(v1);
    expect((await warmed(page.request, framed.path)).drawn).toContain(v1);

    // ONE write: the card's next revision, published.
    await itemOf(
      await api.patch(`${API}/collections/components/entries/${card}`, {
        data: {
          content: cardDefinition(`Card title ${STAMP}`, v2),
          status: "published",
        },
      }),
      "publishing the card"
    );

    // Each page that uses it is rebuilt with the new revision, the placement
    // keeping its own title...
    const placedAfter = await served(page.request, placed.path);
    expect(placedAfter.cache).not.toBe("HIT");
    expect(placedAfter.drawn).toContain(v2);
    expect(placedAfter.drawn).not.toContain(v1);
    expect(placedAfter.drawn).toContain(`Placed title ${STAMP}`);
    const framedAfter = await served(page.request, framed.path);
    expect(framedAfter.cache).not.toBe("HIT");
    expect(framedAfter.drawn).toContain(v2);
    expect(framedAfter.drawn).not.toContain(v1);

    // ...once. Next stores a render just after answering with it, so the
    // store is given that moment; from then on each page must be served from
    // it. A second expiry the publish set off, before or after, would show
    // here as another render.
    await page.waitForTimeout(750);
    for (let round = 0; round < 3; round += 1) {
      for (const target of [placed, framed]) {
        const again = await served(page.request, target.path);
        expect
          .soft(again.cache, `${target.path} rebuilt more than once`)
          .toBe("HIT");
        expect(again.drawn).toContain(v2);
      }
      await page.waitForTimeout(300);
    }

    // And the page that uses neither was not rebuilt at all.
    const otherAfter = await served(page.request, other.path);
    expect
      .soft(otherAfter.cache, "a page not using the card was rebuilt")
      .toBe("HIT");
    expect(otherAfter.drawn).toContain(`Unrelated body ${STAMP}`);
  });

  test("exit test 4: switching a page's Layout leaves another page on the default", async ({
    page,
  }) => {
    const api = await signIn(page);
    previousDefault ??= await currentDefault(api);
    const defaultHeader = await createComponent(
      api,
      "default-header",
      pageDocumentOf("component", [heading("dh", `Default header ${STAMP}`)])
    );
    const otherHeader = await createComponent(
      api,
      "other-header",
      pageDocumentOf("component", [heading("oh", `Other header ${STAMP}`)])
    );
    const main = await createLayout(api, "main", { header: defaultHeader });
    await createLayout(api, "other", { header: otherHeader });
    await makeDefault(page, main);

    const switching = await idOf(
      await api.post(`${API}/collections/pages/entries`, {
        data: {
          title: `Switches ${STAMP}`,
          slug: `switches-${STAMP}`,
          content: pageDocument([heading("sw", `Switching body ${STAMP}`)]),
          status: "draft",
        },
      }),
      "creating the page that switches"
    );
    const staying = await createPage(api, "keeps-the-default", [
      heading("st", `Staying body ${STAMP}`),
    ]);

    // Chosen on the page's form, then published, as an author does.
    await gotoAdmin(page, `/collections/pages/${switching}`);
    const picker = page.getByRole("combobox", { name: "Layout" });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await expect(picker).toContainText(`Site default · main ${STAMP}`);
    await picker.click();
    await page
      .getByRole("option", { name: `other ${STAMP}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect
      .poll(
        async () => {
          const read = await api.get(
            `${API}/collections/pages/entries/${switching}`
          );
          const body = (await read.json()) as Json;
          return ((body.item ?? body) as Json).status;
        },
        { timeout: 20_000 }
      )
      .toBe("published");

    const switched = await served(page.request, `/site/switches-${STAMP}`);
    expect(switched.status).toBe(200);
    expect(switched.drawn).toContain(`Switching body ${STAMP}`);
    expect(switched.drawn).toContain(`Other header ${STAMP}`);
    expect(switched.drawn).not.toContain(`Default header ${STAMP}`);

    const stayed = await served(page.request, staying.path);
    expect(stayed.drawn).toContain(`Staying body ${STAMP}`);
    expect(stayed.drawn).toContain(`Default header ${STAMP}`);
    expect(stayed.drawn).not.toContain(`Other header ${STAMP}`);

    // In the browser, the header is the page's banner landmark.
    await page.goto(`/site/switches-${STAMP}`);
    await expect(
      page.getByRole("banner").getByRole("heading", {
        name: `Other header ${STAMP}`,
      })
    ).toBeVisible();
  });

  test("exit test 5: a page with no header or footer serves neither", async ({
    page,
  }) => {
    const api = await signIn(page);
    previousDefault ??= await currentDefault(api);
    const header = await createComponent(
      api,
      "bare-header",
      pageDocumentOf("component", [heading("bh", `Bare header ${STAMP}`)])
    );
    const footer = await createComponent(
      api,
      "bare-footer",
      pageDocumentOf("component", [paragraph("bf", `Bare footer ${STAMP}`)])
    );
    const framing = await createLayout(api, "framing", { header, footer });
    await makeDefault(page, framing);

    // The control: a page on the default draws both, so their absence below
    // is the switch's doing.
    const framed = await createPage(api, "framed-control", [
      heading("fc", `Framed control ${STAMP}`),
    ]);
    const control = await served(page.request, framed.path);
    expect(control.drawn).toContain(`Bare header ${STAMP}`);
    expect(control.drawn).toContain(`Bare footer ${STAMP}`);

    // Switched off, and switched off while also naming a Layout: the switch
    // wins either way.
    const bare = await createPage(
      api,
      "no-header-or-footer",
      [heading("nb", `Bare body ${STAMP}`)],
      { noHeaderFooter: true }
    );
    const both = await createPage(
      api,
      "named-and-switched-off",
      [heading("ns", `Named body ${STAMP}`)],
      { layout: framing, noHeaderFooter: true }
    );
    for (const [target, body] of [
      [bare, `Bare body ${STAMP}`],
      [both, `Named body ${STAMP}`],
    ] as const) {
      const response = await served(page.request, target.path);
      expect(response.status).toBe(200);
      expect(response.drawn).toContain(body);
      expect(response.drawn).not.toContain("data-nextly-region");
      expect(response.drawn).not.toContain(`Bare header ${STAMP}`);
      expect(response.drawn).not.toContain(`Bare footer ${STAMP}`);
    }
    await page.goto(bare.path);
    await expect(
      page.getByRole("heading", { name: `Bare body ${STAMP}` })
    ).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
  });

  test("exit test 6: every step is reachable through the API", async ({
    page,
  }) => {
    const api = await signIn(page);
    const headers = await pluginHeaders(page);
    const pattern = await idOf(
      await api.post(`${API}/collections/patterns/entries`, {
        data: {
          title: `API pattern ${STAMP}`,
          slug: `api-pattern-${STAMP}`,
          granularity: "section",
          content: {
            formatVersion: 1,
            kind: "pattern",
            nodes: [
              heading("api-pattern-heading", `From the pattern ${STAMP}`),
            ],
          },
          status: "published",
        },
      }),
      "creating the pattern"
    );
    const card = await createComponent(
      api,
      "api-card",
      cardDefinition(`API card title ${STAMP}`, `API card body ${STAMP}`)
    );
    const header = await createComponent(
      api,
      "api-header",
      pageDocumentOf("component", [heading("ah", `API header ${STAMP}`)])
    );
    const layout = await createLayout(api, "api", { header });
    const target = await idOf(
      await api.post(`${API}/collections/pages/entries`, {
        data: {
          title: `Composed through the API ${STAMP}`,
          slug: `through-the-api-${STAMP}`,
          content: pageDocument([]),
          status: "draft",
        },
      }),
      "creating the page"
    );

    // The manifest names every id the actions take.
    const manifest = (await (await api.get(`${PLUGIN}/manifest`)).json()) as {
      patterns: { items: { id: string }[] };
      components: { items: { id: string; fields: { id: string }[] }[] };
      layouts: { items: { id: string }[] };
      actions: { path: string }[];
    };
    expect(manifest.patterns.items.map(item => item.id)).toContain(pattern);
    const listed = manifest.components.items.find(item => item.id === card);
    expect(listed?.fields.map(field => field.id)).toEqual(["title"]);
    expect(manifest.layouts.items.map(item => item.id)).toContain(layout);

    const act = async (action: Json, extra: Json = {}) =>
      itemOf<{
        insertedId?: string;
        refusals: string[];
        by: { kind: string };
        document?: { nodes: BlockNodeJson[] };
      }>(
        await api.post(`${PLUGIN}/pages/actions`, {
          headers,
          data: { page: { collection: "pages", id: target }, action, ...extra },
        }),
        `the ${String(action.kind)} action`
      );

    // Exit test 1's step, asked first as a dry run, which changes nothing.
    const dry = await act(
      { kind: "insert-pattern", patternId: pattern },
      { dryRun: true }
    );
    expect(dry.refusals).toEqual([]);
    expect(dry.by.kind).toBe("user");
    expect(await storedNodes(api, target)).toEqual([]);
    await act({ kind: "insert-pattern", patternId: pattern });
    await act({ kind: "insert-pattern", patternId: pattern });
    const afterInserts = walk(await storedNodes(api, target)).map(n => n.id);
    expect(afterInserts).toHaveLength(2);
    expect(new Set(afterInserts).size).toBe(2);

    // Exit test 2's step: a placement, then its exposed field set again.
    const placed = await act({
      kind: "place-component",
      componentId: card,
      values: { title: `Placed through the API ${STAMP}` },
    });
    expect(typeof placed.insertedId).toBe("string");
    await act({
      kind: "set-placement-values",
      instanceId: placed.insertedId,
      values: { title: `Set through the API ${STAMP}` },
    });
    // A field the card does not expose is refused, naming it.
    const unexposed = await api.post(`${PLUGIN}/pages/actions`, {
      headers,
      data: {
        page: { collection: "pages", id: target },
        action: {
          kind: "set-placement-values",
          instanceId: placed.insertedId,
          values: { body: "Not the page's to set" },
        },
      },
    });
    expect(unexposed.status()).toBe(422);
    // The refusal is for that field, not any 422: one reason, naming `body`,
    // so a caller can tell which value to drop.
    const refused = (await unexposed.json()) as {
      error?: {
        code?: string;
        data?: { errors?: { path: string; code: string; message: string }[] };
      };
    };
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(refused.error?.data?.errors).toEqual([
      {
        path: "action",
        code: "REFUSED",
        message: expect.stringContaining(`sets "body"`),
      },
    ]);

    // Exit test 3's step: the card's definition edited and published through
    // its own route, after a dry run that changes nothing.
    const definition = async (action: Json, extra: Json = {}) =>
      itemOf<{ targetId: string; refusals: string[] }>(
        await api.post(`${PLUGIN}/components/${card}/definition`, {
          headers,
          data: { action, ...extra },
        }),
        `the ${String(action.kind)} definition action`
      );
    const variantDry = await definition(
      { kind: "add-variant", label: `Dark ${STAMP}` },
      { dryRun: true }
    );
    expect(variantDry.refusals).toEqual([]);
    const cardVariants = async () => {
      const read = (await (await api.get(`${PLUGIN}/manifest`)).json()) as {
        components: { items: { id: string; variants: unknown[] }[] };
      };
      return read.components.items.find(item => item.id === card)?.variants;
    };
    expect(await cardVariants()).toEqual([]);
    const variant = await definition(
      { kind: "add-variant", label: `Dark ${STAMP}` },
      { publish: true }
    );
    await act({
      kind: "choose-variant",
      instanceId: placed.insertedId,
      variant: variant.targetId,
    });

    // Exit tests 4 and 5's steps: the page's Layout chosen, published with
    // the change; then switched off, and on again.
    await act({ kind: "set-layout", layout }, { publish: true });
    const framed = await served(page.request, `/site/through-the-api-${STAMP}`);
    expect(framed.status).toBe(200);
    expect(framed.drawn).toContain(`API header ${STAMP}`);
    expect(count(framed.drawn, `From the pattern ${STAMP}`)).toBe(2);
    expect(framed.drawn).toContain(`Set through the API ${STAMP}`);
    expect(framed.drawn).toContain(`API card body ${STAMP}`);

    await act(
      { kind: "set-layout", layout, noHeaderFooter: true },
      { publish: true }
    );
    const bare = await served(page.request, `/site/through-the-api-${STAMP}`);
    expect(bare.drawn).toContain(`Set through the API ${STAMP}`);
    expect(bare.drawn).not.toContain(`API header ${STAMP}`);

    // Making a Layout the site's default, as a dry run: answered, and the
    // default is as it was.
    const before = await currentDefault(api);
    const madeDry = await page.request.post(
      `${PLUGIN}/layouts/${layout}/make-default`,
      { headers, data: { dryRun: true } }
    );
    expect(madeDry.ok(), await madeDry.text()).toBe(true);
    expect(await currentDefault(api)).toBe(before);
  });

  test("exit test 7: a page built from a Layout, a pattern and components adds no client JavaScript", async ({
    page,
  }) => {
    const api = await signIn(page);
    // The baseline: a page of one heading, with no Layout, on the same route.
    const plain = await createPage(
      api,
      "plain",
      [heading("plain", `Plain ${STAMP}`, "h1")],
      { noHeaderFooter: true }
    );
    await page.context().clearCookies();

    /**
     * What a visitor's browser is given to run for a page: every script file
     * it loads, by path; the client components the page's payload asks it to
     * hydrate, by module and export; and any script inside the page's own
     * markup, which is where a Layout's regions, a placed component or a
     * pattern's blocks would add one.
     *
     * The files alone cannot tell: Next loads every client chunk a route's
     * module graph holds, whether or not a page draws it, so a client
     * component used only inside a region loads on the baseline page too. The
     * payload's client references are per page.
     */
    const scriptsOf = async (path: string) => {
      const loaded: string[] = [];
      const listen = (response: {
        request(): { resourceType(): string };
        url(): string;
      }) => {
        if (response.request().resourceType() === "script") {
          loaded.push(new URL(response.url()).pathname);
        }
      };
      page.on("response", listen);
      await page.goto(path, { waitUntil: "networkidle" });
      page.off("response", listen);
      const { clientReferences, inContent } = await page.evaluate(() => {
        // The payload as the server sent it, read from the inline scripts
        // that pushed it: hydration empties `self.__next_f` itself.
        const pushed = Array.from(document.scripts, script => {
          const text = script.textContent ?? "";
          const start = text.indexOf("self.__next_f.push(");
          if (start === -1) return "";
          const entry = JSON.parse(
            text.slice(
              start + "self.__next_f.push(".length,
              text.lastIndexOf(")")
            )
          ) as unknown[];
          return typeof entry[1] === "string" ? entry[1] : "";
        }).join("");
        // A client reference row is `<row>:I[<module>,[<chunks>],"<export>"]`.
        const references = [
          ...pushed.matchAll(/(?:^|\n)[0-9a-f]+:I(\[[^\n]*\])/g),
        ].map(match => {
          const [module, , name] = JSON.parse(match[1]) as unknown[];
          return `${String(module)}#${String(name)}`;
        });
        return {
          clientReferences: [...new Set(references)].sort(),
          inContent: document.querySelectorAll(
            "[data-nextly-region] script, .nx-pb-page script"
          ).length,
        };
      });
      return {
        loaded: [...new Set(loaded)].sort(),
        clientReferences,
        inContent,
      };
    };

    // The seeded welcome page: a Layout's header and footer, an inserted
    // pattern and three placements of a component with exposed fields.
    const composed = await scriptsOf("/site/welcome");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Build pages, not pipelines" })
    ).toBeVisible();
    const baseline = await scriptsOf(plain.path);
    await expect(
      page.getByRole("heading", { name: `Plain ${STAMP}` })
    ).toBeVisible();

    // The controls: the baseline does load scripts and hydrate components,
    // so equality below compares two populated sets.
    expect(baseline.loaded.length).toBeGreaterThan(0);
    expect(baseline.clientReferences.length).toBeGreaterThan(0);
    // Soft, so a page that adds JavaScript in more than one way reports each.
    expect.soft(composed.loaded, "script files").toEqual(baseline.loaded);
    expect
      .soft(composed.clientReferences, "client components hydrated")
      .toEqual(baseline.clientReferences);
    expect.soft(composed.inContent, "scripts in the page's markup").toBe(0);
  });
});

test.describe("the demo site's welcome page", () => {
  test("is served, built from a pattern, a component with exposed fields and a Layout with a locked header", async ({
    page,
  }) => {
    const api = await signIn(page);

    // As stored: the page names the "Site" Layout, whose header is locked;
    // its hero is a copy of the "Hero" pattern; and it places the feature
    // card three times, each with its own values.
    const found = (await (
      await api.get(
        `${API}/collections/pages/entries?where[slug][equals]=welcome&status=all&depth=0`
      )
    ).json()) as { items: Json[] };
    expect(found.items).toHaveLength(1);
    const welcome = found.items[0];
    const layoutId = welcome.layout as string;
    expect(typeof layoutId).toBe("string");
    const layout = (await (
      await api.get(`${API}/collections/layouts/entries/${layoutId}?depth=0`)
    ).json()) as Json;
    const layoutItem = (layout.item ?? layout) as {
      title: string;
      areas: { area: string; component: string }[];
    };
    expect(layoutItem.title).toBe("Site");
    const headerId = layoutItem.areas.find(a => a.area === "header")?.component;
    const header = (await (
      await api.get(`${API}/collections/components/entries/${String(headerId)}`)
    ).json()) as Json;
    const headerContent = ((header.item ?? header) as Json).content as {
      nodes: { locked?: boolean }[];
    };
    expect(headerContent.nodes[0]?.locked).toBe(true);

    const nodes = walk(await storedNodes(api, welcome.id as string));
    const hero = nodes.find(node => node.origin !== undefined);
    expect(hero?.type).toBe("core/section");
    const cards = nodes.filter(node => node.type === INSTANCE);
    expect(cards.map(node => (node.props.overrides as Json).title)).toEqual([
      "Patterns",
      "Components",
      "Layouts",
    ]);

    // As served, at both of its addresses.
    for (const path of ["/site/welcome", "/welcome"]) {
      const response = await served(page.request, path);
      expect(response.status, path).toBe(200);
      expect(response.drawn).toContain('data-nextly-region="header"');
      expect(response.drawn).toContain('data-nextly-region="footer"');
      expect(response.drawn).toContain("Build pages, not pipelines");
      for (const title of ["Patterns", "Components", "Layouts"]) {
        expect(response.drawn).toContain(title);
      }
    }
    await page.goto("/site/welcome");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Open the admin" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Build pages, not pipelines",
      })
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Patterns",
      "Components",
      "Layouts",
    ]);
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("link", { name: "Source on GitHub" })
    ).toBeVisible();
  });
});

/** A document of `kind` holding `nodes`. */
function pageDocumentOf(kind: "component", nodes: unknown[]) {
  return { formatVersion: 1, kind, nodes };
}
