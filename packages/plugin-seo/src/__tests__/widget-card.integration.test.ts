/**
 * The SEO card and its Needs attention line against a real instance, on
 * every configured dialect: each asked through the dashboard's own route as
 * a signed-in person, and compared with what the problem list's own route
 * answers that same person. The card counts the list, so the two agree, kind
 * by kind, for every reader.
 *
 * The card leaves out redirect chains, which the list names only to someone
 * holding site-wide SEO, a permission a card cannot ask; the readers here
 * hold none, so the list they are answered has none either.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  runWidgetLoad,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, ServiceContainer, text } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../address-record/catch-up";
import { seoPlugin } from "../plugin";
import { KIND_TEXT, type Problem } from "../problems/contract";
import { PROBLEMS_SLUG } from "../problems/store";

const ORIGIN = "http://localhost";
const PLUGIN = "@nextlyhq/plugin-seo";
// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seoc_pages";
const POSTS = "seoc_posts";
const COLLECTIONS = [PAGES, POSTS];

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The plugin as booted below, so its own card is the one asked. */
function plugin() {
  return seoPlugin({ collections: COLLECTIONS, sitemap: false });
}

/** The card the plugin declares. */
function cardOf(declared: ReturnType<typeof plugin>) {
  const card = declared.contributes?.dashboard?.widgets?.[0];
  if (card === undefined) throw new Error("the SEO card was withheld");
  return card;
}

/** A person whose one role holds exactly `slugs`: their id and session. */
async function holding(
  t: TestNextly,
  name: string,
  slugs: readonly string[]
): Promise<{ id: string; cookie: string }> {
  const user = await t.nextly.users.create({
    email: `${name}@example.com`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  if (slugs.length > 0) {
    const permissions = await t.nextly.permissions.find({ limit: 1000 });
    const ids = slugs.map(slug => {
      const found = permissions.items.find(item => item.slug === slug);
      if (found === undefined) throw new Error(`${slug} is not seeded`);
      return found.id;
    });
    const role = await t.nextly.roles.create({
      data: {
        name: `Holds ${name}`,
        slug: `holds-${name}`,
        permissionIds: ids,
      },
    });
    const assigned = await new ServiceContainer(
      t.adapter
    ).userRoles.assignRoleToUser(user.item.id, role.item.id);
    if (!assigned.success) throw new Error("the role was not assigned");
  }
  const token = await signAccessToken(
    buildClaims({
      userId: user.item.id,
      email: `${name}@example.com`,
      name,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { id: String(user.item.id), cookie: `nextly_session=${token}` };
}

/** A signed-in request through Nextly's own handler. */
async function post(path: string, cookie: string, body: unknown) {
  const response = await createDynamicHandlers().POST(
    new Request(`${ORIGIN}/api/${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path.split("/") }) }
  );
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

/** The problem list the list's own route answers the person. */
async function listFor(cookie: string): Promise<Problem[]> {
  const path = `plugins/${PLUGIN}/problems`;
  const response = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${path}`, {
      headers: { origin: ORIGIN, cookie },
    }),
    { params: Promise.resolve({ params: path.split("/") }) }
  );
  if (!response.ok) throw new Error(`problems: ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const doc = (body.item ?? body.data ?? body) as { problems: Problem[] };
  return doc.problems;
}

/** The SEO line of the person's Needs attention digest, by id. */
async function linesFor(cookie: string): Promise<Record<string, number>> {
  const { results } = (await post("dashboard/query", cookie, {
    queries: [{ source: "system:attention", op: "list", limit: 50 }],
  })) as {
    results: [{ result?: { items: { id: string; count: number }[] } }];
  };
  return Object.fromEntries(
    (results[0].result?.items ?? [])
      .filter(item => item.id.startsWith("seo/"))
      .map(item => [item.id, item.count])
  );
}

/** The list's problems as the card draws them: a count per kind's group. */
function byKind(problems: readonly Problem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const problem of problems) {
    const title = KIND_TEXT[problem.kind].title;
    counts[title] = (counts[title] ?? 0) + 1;
  }
  return counts;
}

/** Waits until the save's check has kept a row for each of `ids`. */
async function checked(t: TestNextly, ids: readonly string[]): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    const { items } = await t.nextly.find({
      collection: PROBLEMS_SLUG,
      limit: 100,
      overrideAccess: true,
    });
    const kept = new Set(
      (items as { holderId?: unknown }[]).map(row => String(row.holderId))
    );
    if (ids.every(id => kept.has(id))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("the pages' checks never finished");
}

describe.each(getConfiguredTestDialects())(
  "the SEO card counts the problem list (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      const declared = plugin();
      const seen: { ctx?: PluginContext } = {};
      const t = await createTestNextly({
        dialect,
        collections: COLLECTIONS.map(slug =>
          defineCollection({
            slug,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: `/${slug}/{slug}`,
          })
        ),
        plugins: [
          {
            ...declared,
            init(ctx) {
              seen.ctx = ctx;
              return declared.init?.(ctx);
            },
          },
        ],
      });
      current = t;
      // The install's first account holds super-admin, so it is made first
      // and no reader below is it.
      await holding(t, "owner", []);
      await lastCatchUp();
      return { t, card: cardOf(declared) };
    }

    it("draws, kind by kind, what the list answers the same person", async () => {
      const { t, card } = await boot();
      const ids: string[] = [];
      // A title longer than Google shows, and no description, on a page of
      // each collection; two pages sharing a title.
      for (const [collection, slug, title] of [
        [PAGES, "a", "t".repeat(70)],
        [POSTS, "b", "Harbour"],
        [POSTS, "c", "Harbour"],
      ] as const) {
        const created = await t.nextly.create({
          collection,
          data: { title, slug },
        });
        ids.push(String(created.item.id));
      }
      await checked(t, ids);
      const both = await holding(
        t,
        "both",
        COLLECTIONS.map(c => `read-${c}`)
      );

      const list = await listFor(both.cookie);
      // A positive control: the list has page problems to count.
      expect(list.some(p => p.kind === "longTitle")).toBe(true);
      expect(list.some(p => p.kind === "sharedTitle")).toBe(true);

      const answer = await runWidgetLoad(t, card, { as: { id: both.id } });
      expect(answer.state).toBe("ready");
      const { buckets } = (
        answer as { data: { buckets: { value: string; count: number }[] } }
      ).data;
      expect(
        Object.fromEntries(buckets.map(bucket => [bucket.value, bucket.count]))
      ).toEqual(byKind(list));

      // The Needs attention line counts the whole list.
      expect(await linesFor(both.cookie)).toEqual({
        "seo/problems": list.length,
      });
    });

    it("counts for a reader of one collection only what the list shows them", async () => {
      const { t } = await boot();
      const page = await t.nextly.create({
        collection: PAGES,
        data: { title: "t".repeat(70), slug: "a" },
      });
      const other = await t.nextly.create({
        collection: POSTS,
        data: { title: "t".repeat(70), slug: "b" },
      });
      await checked(t, [String(page.item.id), String(other.item.id)]);
      const pagesOnly = await holding(t, "pages-only", [`read-${PAGES}`]);

      const list = await listFor(pagesOnly.cookie);
      expect(list.some(p => p.subject.type === PAGES)).toBe(true);
      expect(list.some(p => p.subject.type === POSTS)).toBe(false);
      expect(await linesFor(pagesOnly.cookie)).toEqual({
        "seo/problems": list.length,
      });
    });
  }
);
