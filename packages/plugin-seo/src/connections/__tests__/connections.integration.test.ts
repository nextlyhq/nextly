/**
 * The optional connections on every configured dialect, each switched on
 * and off and each failure forced, with stand-ins for IndexNow's endpoint
 * and for Google answering as they document: nothing here reaches the
 * network.
 *
 * IndexNow: off by default; once on, publishing, changing, moving and taking
 * down a page each tell it the page's addresses, after the save and never
 * holding it up; the key is served at the site's root and kept encrypted; a
 * refused key, a rate limit and an endpoint that cannot be reached are each
 * reported on the Connections tab and the problem list, and no page changes.
 *
 * Search Console: the sign-in asks Google for read-only access with a
 * one-time state; the token that renews access is kept encrypted and never
 * answered; the report shows clicks, searches and where Google chose another
 * official address, from recorded answers; each failure is said plainly and
 * changes no page.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  definePlugin,
  type PluginContext,
  type PluginDefinition,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, type SanitizedNextlyConfig } from "nextly";
import { createDynamicHandlers, createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { keptSeoContext } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { pageRefKey, problemList, type Reader } from "../../problems/check";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import type {
  ConnectionsBody,
  SearchConsoleConnectBody,
  SearchConsoleReportBody,
} from "../contract";
import { flushIndexNow } from "../indexnow";
import type { IndexNowNotice } from "../indexnow-send";

/** What the stand-in IndexNow endpoint was sent, and how it answers. */
const indexNow = vi.hoisted(() => ({
  notices: [] as IndexNowNotice[],
  answer: 200 as number | "unreachable" | "held",
  release: () => {},
}));

vi.mock("../indexnow-send", async importOriginal => {
  const real = await importOriginal<typeof import("../indexnow-send")>();
  return {
    ...real,
    sendIndexNow: async (_fetch: unknown, notice: IndexNowNotice) => {
      indexNow.notices.push(notice);
      if (indexNow.answer === "unreachable") throw new Error("unreachable");
      if (indexNow.answer === "held") {
        // Answers only once the test lets it, as a slow endpoint would.
        await new Promise<void>(resolve => {
          indexNow.release = resolve;
        });
        return 200;
      }
      return indexNow.answer;
    },
  };
});

const SITE = "https://acme.example";
const CLIENT = { clientId: "acme-client.apps", clientSecret: "client-shh" };

let current: TestNextly | undefined;

afterEach(async () => {
  refusing.saves = false;
  indexNow.release();
  await current?.destroy();
  current = undefined;
  indexNow.notices.length = 0;
  indexNow.answer = 200;
});

let plugin: PluginDefinition;

/** Makes a save fail after the SEO plugin has recorded its addresses. */
const refusing = { saves: false };

/** Another plugin keeping addresses, which refuses a save when told to. */
const laterParticipant: PluginDefinition = definePlugin({
  name: "@test/refusing-participant",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.publicAddresses.participate({
      holderOf: async () => null,
      record: async () => {
        if (refusing.saves) throw new Error("this save is refused");
      },
    });
  },
});

async function boot(dialect: TestDialect) {
  plugin = seoPlugin({
    collections: ["pages", "guides"],
    baseUrl: SITE,
    searchConsole: CLIENT,
  });
  current = await createTestNextly({
    dialect,
    // The SEO plugin first, so the refusing one records after it.
    plugins: [plugin, laterParticipant],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      // Edits to a published page are held as a working draft.
      defineCollection({
        slug: "guides",
        status: true,
        versions: { drafts: true },
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/guides/{slug}",
      }),
    ],
  });
  await lastCatchUp();
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return { t: current, seo };
}

async function settings(t: TestNextly, data: Record<string, unknown>) {
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, productionAddresses: [SITE], ...data },
  });
}

async function publish(t: TestNextly, slug: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "pages",
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/** Every address IndexNow was told about since the last look, sorted. */
async function told(): Promise<string[]> {
  // Saves announce their addresses once they commit, on the event bus.
  await current?.events.settle();
  await flushIndexNow();
  const urls = indexNow.notices.flatMap(notice => notice.urlList).sort();
  indexNow.notices.length = 0;
  return urls;
}

/** The site's Proxy, as an app wires it. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

async function ask(path: string) {
  const response = await proxy(new Request(`${SITE}${path}`));
  return {
    status: response?.status,
    type: response?.headers.get("content-type") ?? null,
    body: (await response?.text()) ?? "",
  };
}

/** Everything the plugins' settings rows hold, as stored. */
async function storedRows(t: TestNextly): Promise<string> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "nextly_plugin_settings"
  );
  return JSON.stringify(rows);
}

/** A stand-in for Google: what it was asked, and which answers fail. */
interface Google {
  asked: { url: string; method: string; body: string; auth: string | null }[];
  failing: Partial<Record<"token" | "sites" | "analytics" | "inspect", number>>;
}

/** An ID token as Google signs one; only its claims are read. */
const ID_TOKEN = [
  Buffer.from('{"alg":"RS256"}').toString("base64url"),
  Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      email: "sara@acme.example",
    })
  ).toString("base64url"),
  "signature",
].join(".");

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Google's token endpoint, answering as recorded. */
function tokenAnswer(google: Google, body: string): Response {
  const status = google.failing.token;
  if (status !== undefined) return json({ error: "invalid_grant" }, status);
  return new URLSearchParams(body).get("grant_type") === "authorization_code"
    ? json({
        access_token: "ya29.first-access",
        expires_in: 3599,
        refresh_token: "1//refresh-shh",
        scope:
          "https://www.googleapis.com/auth/webmasters.readonly openid https://www.googleapis.com/auth/userinfo.email",
        token_type: "Bearer",
        id_token: ID_TOKEN,
      })
    : json({
        access_token: "ya29.renewed-access",
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
        token_type: "Bearer",
      });
}

/** Search Console's counts, by page or by search, as recorded. */
function analyticsAnswer(google: Google, body: string): Response {
  const status = google.failing.analytics;
  if (status !== undefined) return json({ error: {} }, status);
  const { dimensions = [] } = JSON.parse(body) as { dimensions?: string[] };
  // No dimension: the property's totals, which count every page.
  if (dimensions.length === 0) {
    return json({
      // As Google answers it: no keys, since no dimension was asked for.
      rows: [
        {
          clicks: 4821,
          impressions: 90210,
          ctr: 0.053,
          position: 9.1,
        },
      ],
      responseAggregationType: "byProperty",
    });
  }
  const row = (key: string, clicks: number, impressions: number) => ({
    keys: [key],
    clicks,
    impressions,
    ctr: clicks / impressions,
    position: 4.2,
  });
  return json(
    dimensions[0] === "page"
      ? {
          rows: [
            row(`${SITE}/pricing`, 120, 3400),
            row(`${SITE}/about`, 30, 900),
          ],
          responseAggregationType: "byPage",
        }
      : {
          rows: [row("acme rockets", 80, 1200), row("rocket pricing", 40, 800)],
          responseAggregationType: "byProperty",
        }
  );
}

/** A page's inspection, Google choosing `/company` over `/about`. */
function inspectAnswer(google: Google, body: string): Response {
  const status = google.failing.inspect;
  if (status !== undefined) return json({ error: {} }, status);
  const { inspectionUrl } = JSON.parse(body) as { inspectionUrl: string };
  return json({
    inspectionResult: {
      inspectionResultLink: "https://search.google.com/search-console/inspect",
      indexStatusResult: {
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        userCanonical: inspectionUrl,
        googleCanonical:
          inspectionUrl === `${SITE}/about` ? `${SITE}/company` : inspectionUrl,
      },
    },
  });
}

/** A fetch answering each of Google's documented addresses, and none else. */
function fakeGoogle(google: Google) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    google.asked.push({
      url,
      method: init?.method ?? "GET",
      body,
      auth: new Headers(init?.headers).get("authorization"),
    });
    if (url === "https://oauth2.googleapis.com/token") {
      return tokenAnswer(google, body);
    }
    if (url === "https://oauth2.googleapis.com/revoke") return json({});
    if (url === "https://www.googleapis.com/webmasters/v3/sites") {
      const status = google.failing.sites;
      if (status !== undefined) return json({}, status);
      return json({
        siteEntry: [
          { siteUrl: "sc-domain:other.example", permissionLevel: "siteOwner" },
          { siteUrl: `${SITE}/`, permissionLevel: "siteFullUser" },
          {
            siteUrl: "https://unverified.example/",
            permissionLevel: "siteUnverifiedUser",
          },
        ],
      });
    }
    if (url.endsWith("/searchAnalytics/query")) {
      return analyticsAnswer(google, body);
    }
    if (
      url ===
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
    ) {
      return inspectAnswer(google, body);
    }
    throw new Error(`the stand-in for Google was asked for ${url}`);
  };
}

/** Call one of the plugin's routes as Sara, with Google stood in for. */
async function call(
  seo: PluginContext,
  google: Google,
  method: string,
  path: string,
  query = ""
) {
  const route = plugin.contributes?.routes?.find(
    each => each.method === method && each.path === path
  );
  if (!route) throw new Error(`no route ${method} ${path}`);
  const ctx = {
    ...seo,
    fetch: fakeGoogle(google),
    user: { id: "u1", email: "sara@acme.example", name: "Sara" },
    caller: { can: async () => true },
    params: {},
  } as unknown as PluginRouteContext;
  try {
    const response = await route.handler(
      new Request(
        `${SITE}/admin/api/plugins/@nextlyhq/plugin-seo${path}${query}`,
        { method }
      ),
      ctx
    );
    const text = await response.text();
    return {
      status: response.status,
      location: response.headers.get("location"),
      text,
      json: text === "" ? undefined : (JSON.parse(text) as unknown),
    };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    const message =
      typeof error === "object" && error !== null && "publicMessage" in error
        ? String(error.publicMessage)
        : String(error);
    return { status, location: null, text: message, json: undefined };
  }
}

/** The tab's state, as the Connections route answers it. */
async function tab(
  seo: PluginContext
): Promise<{ text: string; body: ConnectionsBody }> {
  const answer = await call(
    seo,
    { asked: [], failing: {} },
    "GET",
    "/connections"
  );
  return { text: answer.text, body: answer.json as ConnectionsBody };
}

/** Start a sign-in and come back from Google with `query`, or its own state. */
async function signIn(
  seo: PluginContext,
  google: Google,
  query?: (state: string) => string
) {
  const started = await call(
    seo,
    google,
    "POST",
    "/connections/search-console/connect"
  );
  const url = new URL((started.json as SearchConsoleConnectBody).url);
  const state = url.searchParams.get("state") ?? "";
  const back = await call(
    seo,
    google,
    "GET",
    "/connections/search-console/callback",
    query === undefined
      ? `?state=${encodeURIComponent(state)}&code=4%2Fcode-from-google`
      : query(state)
  );
  return { url, state, back };
}

/** A reader of every page, for the problem list. */
const everything: Reader = {
  pages: async pages => new Set(pages.map(pageRefKey)),
  readsType: () => true,
  count: async () => 0,
};

/** The problem list's connection problems, as `label: what`. */
async function connectionProblems(seo: PluginContext): Promise<string[]> {
  const list = await problemList(
    seo,
    {
      targets: ["pages"],
      readers: {
        readRules: readSeoRules,
        readStructuredDataRules: structuredDataFromSettings(
          rulesFromOptions(undefined, undefined)
        ),
        readSocialCardRules: noSocialCardRules,
      },
    },
    everything
  );
  return list.problems
    .filter(problem => problem.kind === "connection")
    .map(problem => `${problem.subject.label}: ${problem.what}`);
}

describe.each(getConfiguredTestDialects())(
  "optional connections (%s)",
  dialect => {
    describe("IndexNow", () => {
      it("is off by default: a published page tells no one, and no key is made", async () => {
        const { t } = await boot(dialect);
        await settings(t, {});
        await publish(t, "pricing");

        expect(await told()).toEqual([]);
        expect(await storedRows(t)).not.toContain("indexNowKey");
      });

      it("once on, tells search engines of each published, changed, moved and removed page, and serves its key", async () => {
        const { t, seo } = await boot(dialect);
        await settings(t, { indexNow: true });

        const id = await publish(t, "pricing");
        expect(await told()).toEqual([`${SITE}/pricing`]);

        // Changed while its address stays.
        await t.nextly.update({
          collection: "pages",
          id,
          data: { title: "Pricing plans", _overwrite: true },
        });
        expect(await told()).toEqual([`${SITE}/pricing`]);

        // Moved: the old address and the new one.
        await t.nextly.update({
          collection: "pages",
          id,
          data: { slug: "plans", _overwrite: true },
        });
        expect(await told()).toEqual([`${SITE}/plans`, `${SITE}/pricing`]);

        // Taken down.
        await t.nextly.update({
          collection: "pages",
          id,
          data: { status: "draft", _overwrite: true },
        });
        expect(await told()).toEqual([`${SITE}/plans`]);

        // The key served at the root is the one each notice named.
        await publish(t, "about");
        await t.events.settle();
        await flushIndexNow();
        const last = indexNow.notices.at(-1);
        const key = last?.key ?? "";
        expect(key).toMatch(/^[0-9a-f]{32}$/);
        expect(last?.host).toBe("acme.example");
        expect(await ask(`/${key}.txt`)).toEqual({
          status: 200,
          type: "text/plain; charset=utf-8",
          body: key,
        });
        // Another key's file is the site's, not IndexNow's.
        expect((await ask(`/${"0".repeat(32)}.txt`)).body).toBe("the page");

        // Kept encrypted, and never answered to the admin.
        expect(await storedRows(t)).not.toContain(key);
        const shown = await tab(seo);
        expect(shown.text).not.toContain(key);
        expect(shown.body.indexNow.last?.result).toBe("sent");

        // Switched off: nothing is sent, and the key file is gone.
        indexNow.notices.length = 0;
        await settings(t, { indexNow: false });
        await publish(t, "contact");
        expect(await told()).toEqual([]);
        expect((await ask(`/${key}.txt`)).body).toBe("the page");
      });

      it("tells no one of a working draft, which changes nothing a visitor sees", async () => {
        const { t } = await boot(dialect);
        await settings(t, { indexNow: true });
        const created = await t.nextly.create({
          collection: "guides",
          data: { title: "Start", slug: "start", status: "published" },
        });
        expect(await told()).toEqual([`${SITE}/guides/start`]);

        await t.nextly.update({
          collection: "guides",
          id: String(created.item.id),
          data: { title: "Start here", _overwrite: true },
          draft: true,
        });
        expect(await told()).toEqual([]);
      });

      it("tells no one of a save that was undone", async () => {
        const { t } = await boot(dialect);
        await settings(t, { indexNow: true });
        refusing.saves = true;
        await expect(publish(t, "pricing")).rejects.toThrow();
        refusing.saves = false;

        expect(await told()).toEqual([]);
      });

      it("never holds up a save, even while the endpoint is slow", async () => {
        const { t } = await boot(dialect);
        await settings(t, { indexNow: true });
        indexNow.answer = "held";
        await publish(t, "pricing");
        await t.events.settle();
        const sending = flushIndexNow();
        // The endpoint has not answered, and saves and pages go on.
        const started = Date.now();
        await publish(t, "about");
        expect(Date.now() - started).toBeLessThan(5_000);
        expect((await ask("/pricing")).body).toBe("the page");
        expect(indexNow.notices).toHaveLength(1);
        indexNow.answer = 200;
        indexNow.release();
        await sending;
      });

      it.each([
        [403, "refused-key", "refused the site's IndexNow key"],
        [422, "refused-key", "refused the site's IndexNow key"],
        [429, "rate-limited", "asked the site to slow down"],
        ["unreachable", "failed", "could not be reached"],
      ] as const)(
        "reports an answer of %s on the tab and the problem list, and changes no page",
        async (answer, result, words) => {
          const { t, seo } = await boot(dialect);
          await settings(t, { indexNow: true });
          indexNow.answer = answer;
          await publish(t, "pricing");
          await t.events.settle();
          await flushIndexNow();

          expect((await tab(seo)).body.indexNow.last?.result).toBe(result);
          const problems = await connectionProblems(seo);
          expect(problems).toHaveLength(1);
          expect(problems[0]).toContain(`IndexNow: `);
          expect(problems[0]).toContain(words);
          // The page is served, and the sitemap lists it.
          expect((await ask("/pricing")).body).toBe("the page");
          const sitemap = await createDynamicHandlers().GET(
            new Request(`${SITE}/admin/api/sitemap.xml`),
            { params: Promise.resolve({ params: ["sitemap.xml"] }) }
          );
          expect(await sitemap.text()).toContain(`${SITE}/pricing`);

          // A notice that goes through clears the problem.
          indexNow.answer = 200;
          await publish(t, "about");
          await t.events.settle();
          await flushIndexNow();
          expect(await connectionProblems(seo)).toEqual([]);
        }
      );
    });

    describe("Search Console", () => {
      it("asks Google for read-only access, keeps the token encrypted, and never answers it", async () => {
        const { t, seo } = await boot(dialect);
        await settings(t, {});
        const google: Google = { asked: [], failing: {} };

        const { url, state, back } = await signIn(seo, google);
        expect(`${url.origin}${url.pathname}`).toBe(
          "https://accounts.google.com/o/oauth2/v2/auth"
        );
        expect(url.searchParams.get("scope")).toBe(
          "https://www.googleapis.com/auth/webmasters.readonly openid email"
        );
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("client_id")).toBe(CLIENT.clientId);
        expect(url.searchParams.get("redirect_uri")).toBe(
          `${SITE}/admin/api/plugins/@nextlyhq/plugin-seo/connections/search-console/callback`
        );
        expect(state.length).toBeGreaterThan(20);
        expect(back.status).toBe(303);
        expect(back.location).toBe(
          `${SITE}/admin/plugins/nextlyhq-plugin-seo/settings?tab=connections`
        );
        const exchange = new URLSearchParams(
          google.asked.find(each =>
            each.body.includes("grant_type=authorization_code")
          )?.body ?? ""
        );
        expect(exchange.get("code")).toBe("4/code-from-google");
        expect(exchange.get("code_verifier")?.length).toBeGreaterThan(40);
        // Only Google's documented addresses were asked.
        expect(new Set(google.asked.map(each => each.url))).toEqual(
          new Set([
            "https://oauth2.googleapis.com/token",
            "https://www.googleapis.com/webmasters/v3/sites",
          ])
        );

        const shown = await tab(seo);
        expect(shown.body.searchConsole).toEqual({
          configured: true,
          connected: { email: "sara@acme.example", property: `${SITE}/` },
        });
        const stored = await storedRows(t);
        for (const secret of [
          "1//refresh-shh",
          "ya29.",
          CLIENT.clientSecret,
          state,
          exchange.get("code_verifier") ?? "verifier",
        ]) {
          expect(shown.text).not.toContain(secret);
          expect(stored).not.toContain(secret);
        }
        // Who is connected is not a credential, and is kept as it is.
        expect(stored).toContain("sara@acme.example");
      });

      it("shows clicks, searches and where Google chose another official address, from Google's answers", async () => {
        const { t, seo } = await boot(dialect);
        await settings(t, {});
        const google: Google = { asked: [], failing: {} };
        await signIn(seo, google);

        const report = await call(
          seo,
          google,
          "GET",
          "/connections/search-console/report"
        );
        const body = report.json as SearchConsoleReportBody;
        // The property's total, not the sum of the pages listed.
        expect(body.clicks).toBe(4821);
        expect(body.queries.map(row => [row.query, row.clicks])).toEqual([
          ["acme rockets", 80],
          ["rocket pricing", 40],
        ]);
        expect(body.otherAddress).toEqual([
          {
            page: `${SITE}/about`,
            declared: `${SITE}/about`,
            chosen: `${SITE}/company`,
          },
        ]);
        expect(body.checked).toBe(2);
        // Every report read used renewed access, not the sign-in's.
        const reads = google.asked.filter(
          each =>
            each.url.endsWith("/searchAnalytics/query") ||
            each.url.endsWith("index:inspect")
        );
        expect(reads.length).toBeGreaterThan(0);
        expect(
          reads.every(each => each.auth === "Bearer ya29.renewed-access")
        ).toBe(true);
        expect(report.text).not.toContain("refresh-shh");
      });

      it.each([
        ["a state that does not match", "did not match"],
        ["Google refusing the sign-in", "no longer accepts"],
        ["no property for the site", "no Search Console property"],
        ["the person declining", "did not give access"],
      ] as const)(
        "says so plainly after %s, and changes no page",
        async (fault, words) => {
          const { t, seo } = await boot(dialect);
          await settings(t, {});
          await publish(t, "pricing");
          if (fault === "no property for the site") {
            await settings(t, {
              productionAddresses: ["https://elsewhere.example"],
            });
          }
          const google: Google = {
            asked: [],
            failing:
              fault === "Google refusing the sign-in" ? { token: 400 } : {},
          };
          const { back } = await signIn(
            seo,
            google,
            fault === "a state that does not match"
              ? () => "?state=someone-else&code=c"
              : fault === "the person declining"
                ? state => `?state=${state}&error=access_denied`
                : undefined
          );
          expect(back.status).toBe(303);

          expect((await tab(seo)).body.searchConsole.failed?.message).toContain(
            words
          );
          expect(await connectionProblems(seo)).toEqual([
            expect.stringContaining(words),
          ]);
          expect((await ask("/pricing")).body).toBe("the page");
        }
      );

      it("says so plainly when Google stops answering a connected site, and disconnecting forgets it", async () => {
        const { t, seo } = await boot(dialect);
        await settings(t, {});
        const google: Google = { asked: [], failing: {} };
        await signIn(seo, google);

        google.failing = { token: 401 };
        const refused = await call(
          seo,
          google,
          "GET",
          "/connections/search-console/report"
        );
        expect(refused.status).toBe(503);
        expect(refused.text).toContain("no longer accepts this connection");
        google.failing = { analytics: 429 };
        const limited = await call(
          seo,
          google,
          "GET",
          "/connections/search-console/report"
        );
        expect(limited.text).toContain("limiting requests");
        expect((await ask("/")).body).toBe("the page");

        const gone = await call(
          seo,
          google,
          "POST",
          "/connections/search-console/disconnect"
        );
        expect(gone.status).toBe(200);
        expect(google.asked.at(-1)?.url).toBe(
          "https://oauth2.googleapis.com/revoke"
        );
        expect((await tab(seo)).body.searchConsole).toEqual({
          configured: true,
        });
        expect(await storedRows(t)).not.toContain("sara@acme.example");
        expect(await connectionProblems(seo)).toEqual([]);
      });
    });
  }
);
