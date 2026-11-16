import { expect, type APIRequestContext } from "@playwright/test";

import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * Blocks shown by their visibility conditions, on a production build, as an
 * anonymous visitor is served the page.
 *
 * A block whose conditions hold for the page's entry is drawn; one whose
 * conditions don't hold, or can't be checked, is left out of the whole
 * response: the HTML, the inline payload that repeats the tree as data, and
 * the page's title. What only a production build shows: the page is
 * generated on the server, with nothing a visitor can toggle.
 */

const API = "/admin/api";

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);

type Json = Record<string, unknown>;

/** A heading shown only when `conditions` hold for the page's entry. */
function shownWhen(
  id: string,
  text: string,
  conditions: unknown,
  level = "h2"
) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level },
    visibility: { conditions },
  };
}

/** Create and publish a page, answering the path a visitor reads it at. */
async function publishPage(
  api: APIRequestContext,
  title: string,
  nodes: Json[]
): Promise<string> {
  const slug = `conditions-${STAMP}`;
  const response = await api.post(`${API}/collections/pages/entries`, {
    data: {
      title,
      slug,
      content: { formatVersion: 1, kind: "page", nodes },
      status: "published",
    },
  });
  if (!response.ok()) {
    throw new Error(
      `creating the page: ${response.status()} ${await response.text()}`
    );
  }
  return `/site/${slug}`;
}

test.describe.configure({ timeout: 180_000 });

test("serves a block whose conditions hold, and leaves out one whose conditions don't", async ({
  page,
}) => {
  const title = `Field guide ${STAMP}`;
  const api = await signIn(page);
  const path = await publishPage(api, title, [
    shownWhen(
      "lead",
      `Visible headline ${STAMP}`,
      [[{ field: "title", op: "equals", value: title }]],
      "h1"
    ),
    shownWhen(
      "members",
      `Members only ${STAMP}`,
      [[{ field: "title", op: "equals", value: "Nobody's page" }]],
      "h1"
    ),
  ]);

  const response = await page.request.get(path, { headers: { cookie: "" } });
  expect(response.status(), `serving ${path}`).toBe(200);
  const html = await response.text();

  // CONTROL: the block whose conditions hold is drawn, so the page and its
  // conditions are read at all.
  expect(html).toContain(`Visible headline ${STAMP}`);
  // Left out of everything a visitor receives, the inline data included.
  expect(html).not.toContain(`Members only ${STAMP}`);
  // And the page's title is taken from what it draws.
  const pageTitle = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "";
  expect(pageTitle).not.toContain(`Members only ${STAMP}`);
});
