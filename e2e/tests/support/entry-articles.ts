/**
 * The `entry-articles` fixture, as the Entry content specs write it: its one
 * template (created, or found where an earlier attempt made it, then given
 * the spec's design) and its articles, each with its own blocks fields.
 *
 * The collection is registered by the e2e style fixture and served at
 * `/articles/<slug>`; only the Entry content specs write it, under
 * `LOCK.entryArticlesTemplate`.
 *
 * @module tests/support/entry-articles
 */
import { expect, type APIRequestContext } from "@playwright/test";

/** The fixture collection's slug. */
export const ENTRY_ARTICLES = "entry-articles";

const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";
const TEMPLATES = "/admin/api/collections/templates/entries";
const ARTICLES = `/admin/api/collections/${ENTRY_ARTICLES}/entries`;

/** A block document of `kind` holding `nodes`. */
export function documentOf(
  kind: "page" | "template",
  nodes: readonly Record<string, unknown>[]
): Record<string, unknown> {
  return { formatVersion: 1, kind, nodes };
}

/** A text block saying `words`. */
export function textBlock(id: string, words: string): Record<string, unknown> {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

/** An Entry content block drawing `field`. */
export function entryContentBlock(
  id: string,
  field: string
): Record<string, unknown> {
  return { id, type: "core/entry-content", version: 1, props: { field } };
}

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
 * The fixture's template id, created through the template actions route, or
 * the one an earlier attempt made, given `content` and, where asked,
 * published.
 */
export async function articlesTemplate(
  api: APIRequestContext,
  content: Record<string, unknown>,
  publish = false
): Promise<string> {
  const created = await api.post(`${PLUGIN}/templates/actions`, {
    data: { action: { kind: "create-template", collection: ENTRY_ARTICLES } },
    headers: await writeHeaders(api),
  });
  let id: string | undefined;
  if (created.ok()) {
    const body = (await created.json()) as {
      item?: { template?: { id?: string } };
    };
    id = body.item?.template?.id;
  }
  if (id === undefined) {
    // A collection has one template: an earlier attempt made it.
    const found = await api.get(
      `${TEMPLATES}?where[collection][equals]=${ENTRY_ARTICLES}&limit=1`
    );
    expect(found.ok(), await found.text()).toBe(true);
    const { items } = (await found.json()) as { items: { id: string }[] };
    id = items[0]?.id;
  }
  if (id === undefined) throw new Error("[e2e] No entry-articles template.");
  const designed = await api.patch(`${TEMPLATES}/${id}`, {
    data: { content, ...(publish ? { status: "published" } : {}) },
  });
  expect(designed.ok(), await designed.text()).toBe(true);
  return id;
}

/** A published article, with its blocks fields as given; its id. */
export async function article(
  api: APIRequestContext,
  data: {
    readonly title: string;
    readonly slug: string;
    readonly body?: Record<string, unknown>;
    readonly membersOnly?: Record<string, unknown>;
    readonly status?: "draft" | "published";
  }
): Promise<string> {
  const response = await api.post(ARTICLES, {
    data: { status: "published", ...data },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}
