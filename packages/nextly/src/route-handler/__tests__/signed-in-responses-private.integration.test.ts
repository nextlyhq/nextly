/**
 * No admin API response to a signed-in request is one a shared cache (a CDN,
 * a proxy) may keep, whatever the route, the verb or the outcome.
 *
 * Every request below goes through the real catch-all handler with a session
 * cookie, or with an `Authorization` header: the admin's own reads (the
 * startup request's paths among them), each kind of entity read and write,
 * the "unchanged" answer, refusals, a missing entry, a route that does not
 * exist, and a plugin's route that asks for `public` caching. Each must say
 * `private` and `no-store`, and vary on the credentials.
 *
 * The plugin route is the separating case: a marking applied route by route
 * passes every core route here and lets that one through. Its control is the
 * same route asked by a visitor, which keeps the `public` caching it asked
 * for, so the fixture does ask for it and the judge below does catch it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../config";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

const NOTES = "private_resp_notes";
const HOME = "private_resp_home";
const EDITOR = "private-resp-editor";
const ORIGIN = "http://localhost";
const PUBLIC_CACHING = "public, max-age=600";

/** A plugin route that asks for its answers to be cached by anyone. */
const cachingPlugin = {
  name: "cache-probe",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/cached",
        public: true,
        handler: () =>
          Response.json(
            { cached: true },
            { headers: { "Cache-Control": PUBLIC_CACHING } }
          ),
      },
    ],
  },
} as unknown as PluginDefinition;

/**
 * Whether a shared cache may keep a response with this `Cache-Control`:
 * anything that does not forbid it with `private` or `no-store`.
 */
function sharedCacheMayKeep(cacheControl: string | null): boolean {
  const directives = (cacheControl ?? "")
    .split(",")
    .map(part => part.trim().split("=")[0]?.toLowerCase());
  return !directives.includes("private") || !directives.includes("no-store");
}

type Verb = "GET" | "POST" | "PATCH" | "DELETE";

let current: TestNextly;
let cookie: string;
let entryId: string;

/** A request to the admin API, with `credentials` as its headers. */
async function send(
  verb: Verb,
  path: string,
  credentials: Record<string, string>,
  extra: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const url = new URL(`${ORIGIN}/admin/api${path}`);
  const params = url.pathname
    .slice("/admin/api/".length)
    .split("/")
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));
  return createDynamicHandlers()[verb](
    new Request(url, {
      method: verb,
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        ...credentials,
        ...extra.headers,
      },
      ...(extra.body === undefined ? {} : { body: JSON.stringify(extra.body) }),
    }),
    { params: Promise.resolve({ params }) }
  );
}

beforeAll(async () => {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    singles: [
      defineSingle({ slug: HOME, fields: [text({ name: "heading" })] }),
    ],
    plugins: [cachingPlugin],
  });
  await superAdminUser(current, EDITOR);
  cookie = `nextly_session=${await signAccessToken(
    buildClaims({
      userId: EDITOR,
      email: `${EDITOR}@example.test`,
      name: EDITOR,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  )}`;
  const created = await send(
    "POST",
    `/collections/${NOTES}/entries`,
    { cookie },
    { body: { title: "first" } }
  );
  entryId = ((await created.json()) as { item: { id: string } }).item.id;
}, 180_000);

afterAll(async () => {
  await current?.destroy();
});

/** The admin's startup paths, as it names them. */
const STARTUP_PATHS = [
  "/auth/setup-status",
  "/auth/session",
  "/admin-meta",
  "/admin-meta/workspace",
  "/me",
  "/me/permissions",
  "/me/capabilities",
  "/general-settings",
  "/collections?limit=100&page=1&sortBy=name&sortOrder=asc",
  "/singles",
];

/** Every request the sweep sends, with the session. */
function requests(): [Verb, string, unknown?][] {
  return [
    [
      "GET",
      `/startup?${STARTUP_PATHS.map(p => `path=${encodeURIComponent(p)}`).join("&")}`,
    ],
    ...STARTUP_PATHS.map((path): [Verb, string] => ["GET", path]),
    ["GET", "/auth/csrf"],
    ["GET", "/auth/ui"],
    ["GET", `/collections/schema/${NOTES}`],
    ["GET", `/collections/${NOTES}`],
    ["GET", `/collections/${NOTES}/entries?limit=10`],
    ["GET", `/collections/${NOTES}/entries/count`],
    ["GET", `/collections/${NOTES}/entries/${entryId}`],
    ["GET", `/collections/${NOTES}/entries/${entryId}/versions`],
    ["GET", `/collections/${NOTES}/entries/does-not-exist`],
    ["GET", `/singles/${HOME}`],
    ["GET", `/singles/${HOME}/schema`],
    ["GET", "/field-groups"],
    ["GET", "/users"],
    ["GET", "/roles"],
    ["GET", "/permissions"],
    ["GET", "/media"],
    ["GET", "/api-keys"],
    ["GET", "/webhooks"],
    ["GET", "/notices/count"],
    ["GET", "/schema/journal"],
    ["GET", "/dashboard/layout"],
    ["GET", "/languages"],
    ["GET", "/no-such-route"],
    ["GET", "/plugins/cache-probe/cached"],
    ["POST", `/collections/${NOTES}/entries`, { title: "second" }],
    ["PATCH", `/collections/${NOTES}/entries/${entryId}`, { title: "edited" }],
    ["PATCH", `/singles/${HOME}`, { heading: "Welcome" }],
    ["POST", `/collections/${NOTES}/entries`, { title: 42 }],
    ["DELETE", `/collections/${NOTES}/entries/does-not-exist`],
  ];
}

describe("every admin API response to a signed-in request", () => {
  it("a visitor's request to the caching plugin route keeps the public caching it asked for", async () => {
    const response = await send("GET", "/plugins/cache-probe/cached", {});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHING);
    expect(sharedCacheMayKeep(response.headers.get("cache-control"))).toBe(
      true
    );
  });

  it("is kept by no shared cache, with a session cookie", async () => {
    const keepable: string[] = [];
    const statuses = new Set<number>();
    for (const [verb, path, body] of requests()) {
      const response = await send(verb, path, { cookie }, { body });
      statuses.add(response.status);
      const cacheControl = response.headers.get("cache-control");
      const vary = response.headers.get("vary") ?? "";
      if (sharedCacheMayKeep(cacheControl) || !/\bcookie\b/i.test(vary)) {
        keepable.push(
          `${verb} ${path} ${response.status}: ${cacheControl} / ${vary}`
        );
      }
    }
    // The sweep reached answers and refusals alike, not one kind only.
    expect([...statuses].some(status => status < 300)).toBe(true);
    expect([...statuses].some(status => status >= 400)).toBe(true);
    expect(keepable).toEqual([]);
  }, 120_000);

  it("is kept by no shared cache, with an Authorization header", async () => {
    // A key this site never issued: refused, and the refusal is private too.
    const credentials = { authorization: "Bearer sk_not_a_key" };
    const keepable: string[] = [];
    for (const [verb, path] of [
      ["GET", "/collections"],
      ["GET", `/collections/${NOTES}/entries`],
      ["GET", "/plugins/cache-probe/cached"],
    ] as const) {
      const response = await send(verb, path, credentials);
      if (sharedCacheMayKeep(response.headers.get("cache-control"))) {
        keepable.push(`${verb} ${path} ${response.status}`);
      }
    }
    expect(keepable).toEqual([]);
  });

  it("the 'unchanged' answer is kept by no shared cache", async () => {
    const path = `/collections/schema/${NOTES}`;
    const first = await send("GET", path, { cookie });
    const tag = first.headers.get("etag") ?? "";
    const again = await send(
      "GET",
      path,
      { cookie },
      { headers: { "if-none-match": tag } }
    );
    expect(again.status).toBe(304);
    expect(sharedCacheMayKeep(again.headers.get("cache-control"))).toBe(false);
  });
});
