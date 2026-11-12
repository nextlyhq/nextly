/**
 * What search engines received, through core's request handler with a real
 * API key, against a real database on every configured dialect, and a site
 * served on this machine: the check fetches the published page as each
 * crawler and compares what it received with what Nextly holds for it; a
 * difference is numbered and explained; an address on another site is
 * refused without a single request; a redirect off the site is not
 * followed; and the screen is offered the site's own pages.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import type { PluginDefinition } from "@nextlyhq/plugin-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import type { ReceivedAnswer } from "../contract";

interface Direct {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

const BASE = ["plugins", "@nextlyhq", "plugin-seo", "received"];

/** One request to a route of the check through core's handler. */
async function call(
  key: string | undefined,
  method: "GET" | "POST",
  segments: string[],
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const request = new Request(
    `https://admin.example/api/${segments.join("/")}`,
    {
      method,
      headers: {
        ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  const params = { params: Promise.resolve({ params: segments }) };
  return method === "GET"
    ? handlers.GET(request, params)
    : handlers.POST(request, params);
}

/** The check of `address`, as `key`. */
async function check(key: string, address: string): Promise<ReceivedAnswer> {
  const response = await call(key, "POST", BASE, { address });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as ReceivedAnswer;
}

/** What the site served this machine's crawlers, and how it served them. */
interface SiteState {
  /** Each request the site was asked, with the crawler it came from. */
  asked: { path: string; agent: string }[];
  /** The title served to Googlebot, where it differs from the page's. */
  googlebotTitle?: string;
  /** LinkedIn is turned away. */
  blockLinkedIn: boolean;
  /** The description served to Googlebot, where it differs from the page's. */
  googlebotDescription?: string;
}

const site: SiteState = { asked: [], blockLinkedIn: false };

/** What the design drawing the post `designed` says about it. */
const DESIGNED = {
  title: "Designed post | Acme",
  description: "Written by the post's design.",
};

/**
 * The Page Builder, stood in for by a plugin of its name offering only its
 * design service, which draws the post `designed`.
 */
const pageBuilder: PluginDefinition = {
  name: "@nextlyhq/plugin-page-builder",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    // Its Settings place, which the SEO plugin adds a tab to.
    admin: {
      places: [
        { name: "nextlyhq-plugin-page-builder.settings", accepts: ["tab"] },
      ],
    },
    services: {
      designSeo: () => ({
        valuesFor: async ({ entry }: { entry: Record<string, unknown> }) =>
          entry.slug === "designed" ? DESIGNED : undefined,
      }),
    },
  },
};

/** The designed post as its route serves it: its head from its design. */
function designedHtml(origin: string): string {
  return [
    "<!DOCTYPE html><html><head>",
    `<title>${DESIGNED.title}</title>`,
    `<meta name="description" content="${DESIGNED.description}"/>`,
    `<link rel="canonical" href="${origin}/blog/designed"/>`,
    "</head><body><h1>Designed</h1></body></html>",
  ].join("");
}

/** The page as the site serves it, its head built from the post's values. */
function pageHtml(origin: string, agent: string): string {
  const title = agent.includes("Googlebot")
    ? (site.googlebotTitle ?? "Surfer vs Rext | Rext AI")
    : "Surfer vs Rext | Rext AI";
  return [
    "<!DOCTYPE html><html><head>",
    `<title>${title}</title>`,
    `<meta name="description" content="${
      agent.includes("Googlebot")
        ? (site.googlebotDescription ??
          "Surfer grades drafts; Rext writes them.")
        : "Surfer grades drafts; Rext writes them."
    }"/>`,
    `<link rel="canonical" href="${origin}/blog/surfer-vs-rext"/>`,
    `<meta property="og:title" content="Surfer vs Rext | Rext AI"/>`,
    `<meta property="og:description" content="Surfer grades drafts; Rext writes them."/>`,
    `<meta name="twitter:title" content="Surfer vs Rext | Rext AI"/>`,
    "</head><body><h1>Surfer vs Rext</h1></body></html>",
  ].join("");
}

describe.each(getConfiguredTestDialects())(
  "what search engines received (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let server: Server;
    let origin = "";
    let reader = "";

    beforeAll(async () => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const agent = String(req.headers["user-agent"] ?? "");
        const path = req.url ?? "/";
        site.asked.push({ path, agent });
        if (path === "/leave") {
          res.writeHead(302, { location: "https://evil.example/" }).end();
          return;
        }
        if (site.blockLinkedIn && agent.includes("LinkedInBot")) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(
            path === "/blog/designed"
              ? designedHtml(origin)
              : pageHtml(origin, agent)
          );
      });
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The site is configured on this machine, so the check may reach it.
        plugins: [
          pageBuilder,
          seoPlugin({ collections: ["posts"], baseUrl: origin }),
        ],
        // The boot's seeding, so the plugin's own `check-seo` exists to grant.
        seedPublic: true,
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            // Readers see only the open team's posts.
            access: { read: () => ({ team: { equals: "open" } }) },
            fields: [
              text({ name: "title" }),
              text({ name: "slug" }),
              text({ name: "team" }),
              text({ name: "excerpt" }),
            ],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Surfer vs Rext",
          slug: "surfer-vs-rext",
          team: "open",
          // The description is automatic, from the post's excerpt.
          excerpt: "Surfer grades drafts; Rext writes them.",
          status: "published",
          seo: { metaTitle: "Surfer vs Rext | Rext AI" },
        },
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Closed plans",
          slug: "closed-plans",
          team: "closed",
          status: "published",
          seo: { metaTitle: "Closed plans | Rext AI" },
        },
      });
      // A post the design draws, with no description of its own.
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Designed",
          slug: "designed",
          team: "open",
          status: "published",
        },
      });
      await lastCatchUp();

      const direct = t.nextly as unknown as Direct;
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });
      // A reader of posts who may run the check.
      const ids = ["read-posts", "check-seo"].map(slug => {
        const found = seeded.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await direct.roles.create({
        data: { name: "Reader", slug: "reader", permissionIds: ids },
      });
      const keys = t.getService("apiKeyService") as unknown as ApiKeys;
      reader = (
        await keys.createApiKey(owner.item.id, {
          name: "reader",
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        })
      ).key;
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
      server?.closeAllConnections();
      await new Promise<void>(resolve => server?.close(() => resolve()));
    });

    beforeEach(() => {
      site.asked = [];
      delete site.googlebotTitle;
      delete site.googlebotDescription;
      site.blockLinkedIn = false;
    });

    it("fetches the page as each crawler and finds it holds what Nextly holds", async () => {
      const answer = await check(reader, `${origin}/blog/surfer-vs-rext`);
      expect(answer).toMatchObject({
        kind: "checked",
        address: `${origin}/blog/surfer-vs-rext`,
        stored: {
          title: "Surfer vs Rext | Rext AI",
          description: "Surfer grades drafts; Rext writes them.",
          canonical: `${origin}/blog/surfer-vs-rext`,
          listed: true,
        },
        differences: [],
      });
      if (answer.kind !== "checked") return;
      expect(
        answer.crawlers.map(crawler => [crawler.name, crawler.status])
      ).toEqual([
        ["Google", 200],
        ["Bing", 200],
        ["Facebook", 200],
        ["X", 200],
        ["LinkedIn", 200],
        ["AI crawlers", 200],
      ]);
      expect(answer.rows.title.googlebot).toEqual({ kind: "same" });
      // The site was asked once by each crawler, each naming itself.
      expect(
        site.asked
          .map(
            each =>
              /Googlebot|bingbot|facebookexternalhit|Twitterbot|LinkedInBot|GPTBot/.exec(
                each.agent
              )?.[0]
          )
          .sort()
      ).toEqual([
        "GPTBot",
        "Googlebot",
        "LinkedInBot",
        "Twitterbot",
        "bingbot",
        "facebookexternalhit",
      ]);
      // What Nextly holds, with the page's name, where its SEO is edited,
      // where each value comes from, and its structured data.
      expect(answer.name).toBe("Surfer vs Rext");
      expect(answer.editHref).toMatch(
        /^\/admin\/collections\/posts\/[^/?]+\?tab=nextlyhq-plugin-seo\.tab$/
      );
      expect(answer.stored?.from.title?.level).toBeDefined();
      expect(answer.aiCrawlers).toBe("all");
      expect(answer.structuredData?.items.map(item => item.type)).toContain(
        "BreadcrumbList"
      );
      expect(JSON.parse(answer.structuredData?.json ?? "{}")).toHaveProperty(
        "@graph"
      );
    });

    it("numbers and explains each difference from what Nextly holds", async () => {
      site.googlebotTitle = "An old title";
      site.googlebotDescription = "Written by the design";
      site.blockLinkedIn = true;
      const answer = await check(reader, "/blog/surfer-vs-rext");
      if (answer.kind !== "checked") throw new Error(JSON.stringify(answer));
      expect(answer.crawlers[4]).toMatchObject({
        name: "LinkedIn",
        status: 403,
        difference: 1,
      });
      expect(answer.rows.title.googlebot).toEqual({
        kind: "different",
        difference: 2,
        received: "An old title",
      });
      expect(answer.differences.map(each => each.title)).toEqual([
        "LinkedIn was answered 403.",
        "Google received a different title.",
        "Google received a different description.",
      ]);
      // A typed title is Nextly's to hold; an automatic description may be
      // set by the page's design or route.
      expect(answer.differences[1]?.text).toMatch(/^Nextly holds /);
      expect(answer.differences[2]?.text).toMatch(
        /^Nextly's automatic description is “Surfer grades drafts; Rext writes them\.”/
      );
      // Expected, nothing to fix: the design or route sets its own.
      expect(answer.differences[2]?.expected).toBe(true);
      expect(answer.differences[1]?.expected).toBeUndefined();
    });

    it("holds what a page's design sets, and finds the page holds it too", async () => {
      const answer = await check(reader, `${origin}/blog/designed`);
      expect(answer).toMatchObject({
        kind: "checked",
        stored: {
          title: DESIGNED.title,
          description: DESIGNED.description,
        },
      });
      if (answer.kind !== "checked") return;
      expect(answer.rows.title.googlebot).toEqual({ kind: "same" });
      expect(answer.rows.description.googlebot).toEqual({ kind: "same" });
    });

    it("holds nothing to compare for a page the caller may not read", async () => {
      // The reader may read posts, but not this one: its row is filtered out.
      const answer = await check(reader, `${origin}/blog/closed-plans`);
      expect(answer.kind).toBe("checked");
      expect(answer).not.toHaveProperty("stored");
      expect(JSON.stringify(answer)).not.toContain("Closed plans | Rext AI");
    });

    it("refuses an address on another site without asking anything", async () => {
      for (const address of [
        "https://evil.example/",
        "http://169.254.169.254/latest/meta-data/",
        `${origin.replace(/:\d+$/, ":1")}/`,
      ]) {
        const answer = await check(reader, address);
        expect(answer.kind, address).toBe("refused");
      }
      expect(await check(reader, "https://evil.example/")).toEqual({
        kind: "refused",
        address: "https://evil.example/",
        reason: "other-site",
        site: new URL(origin).host,
        message: `That address is on another site, evil.example. Only ${new URL(origin).host} addresses can be checked.`,
      });
      expect(site.asked).toEqual([]);
    });

    it("never follows a redirect off the site", async () => {
      const answer = await check(reader, `${origin}/leave`);
      if (answer.kind !== "checked") throw new Error(JSON.stringify(answer));
      expect(answer.differences).toEqual([
        {
          number: 1,
          title:
            "Google, Bing, Facebook, X, LinkedIn and AI crawlers received nothing.",
          text: `It redirected to https://evil.example/. That address is on another site, evil.example. Only ${new URL(origin).host} addresses can be checked.`,
        },
      ]);
      expect(site.asked.map(each => each.path)).toEqual(
        Array.from({ length: 6 }, () => "/leave")
      );
      expect(answer.crawlers[0]).toMatchObject({
        reason: "other-site",
        redirected: true,
      });
    });

    it("refuses anyone not signed in", async () => {
      const anonymous = await call(undefined, "POST", BASE, {
        address: `${origin}/blog/surfer-vs-rext`,
      });
      expect(anonymous.status).toBe(401);
      expect(site.asked).toEqual([]);
    });
  }
);
