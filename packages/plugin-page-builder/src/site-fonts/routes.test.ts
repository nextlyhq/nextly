/**
 * The catalogue route's reading of Fontsource: the list, and how popular each
 * family is, read together and kept for the catalogue's own day.
 *
 * The transport is a stand-in answering by path, so these pin what the route
 * asks for and what it makes of each answer; the integration suite drives the
 * same route over HTTP against a local catalogue.
 */
import { describe, expect, it } from "vitest";

import { resolveFontOptions } from "./options";
import { siteFontRoutes } from "./routes";

const API = "https://api.example.test";

const ENTRY = {
  subsets: ["latin"],
  weights: [400],
  styles: ["normal"],
  defSubset: "latin",
  variable: false,
  category: "serif",
  license: "OFL-1.1",
  type: "google",
};

const LIST = [
  { ...ENTRY, id: "abel", family: "Abel" },
  { ...ENTRY, id: "lora", family: "Lora" },
];

const STATS = { lora: { total: { npmDownloadMonthly: 52_000 } } };

type Answer = () => Response;

const json =
  (body: unknown): Answer =>
  () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

/** A catalogue answering each path it knows, and 404 for any other. */
function catalogueAt(routes: Record<string, Answer>) {
  const asked: string[] = [];
  const fetch = async (input: string): Promise<Response> => {
    const url = new URL(input);
    const path = `${url.pathname}${url.search}`;
    asked.push(path);
    return routes[path]?.() ?? new Response(null, { status: 404 });
  };
  return { asked, fetch };
}

function catalogueRoute(clock: { now: number }) {
  const fonts = resolveFontOptions({
    catalogue: { api: API, files: "https://files.example.test" },
  });
  if (fonts === false) throw new Error("the catalogue is on");
  const [read] = siteFontRoutes({ fonts, now: () => clock.now });
  if (read === undefined) throw new Error("no catalogue route");
  return read;
}

async function readItems(
  route: ReturnType<typeof catalogueRoute>,
  fetch: (input: string) => Promise<Response>
): Promise<Array<Record<string, unknown>>> {
  const response = await route.handler(new Request(`${API}/catalogue`), {
    self: { collections: {}, singles: {} },
    user: null,
    caller: { can: async () => true },
    fetch,
  } as unknown as Parameters<typeof route.handler>[1]);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    items: Array<Record<string, unknown>>;
    meta: Record<string, unknown>;
  };
  // The canonical list envelope, whatever the stats said.
  expect(body.meta).toMatchObject({ total: body.items.length, page: 1 });
  return body.items;
}

describe("the catalogue route's popularity", () => {
  it("gives each family its monthly downloads, and 0 to one the stats leave out", async () => {
    const { fetch } = catalogueAt({
      "/v1/fonts?type=google": json(LIST),
      "/v1/stats": json(STATS),
    });
    const items = await readItems(catalogueRoute({ now: 0 }), fetch);
    expect(items.map(item => [item.id, item.popularity])).toEqual([
      ["abel", 0],
      ["lora", 52_000],
    ]);
  });

  it("answers the list without popularity when the stats fail or cannot be read", async () => {
    for (const stats of [
      () => new Response(null, { status: 503 }),
      json(["not", "stats"]),
      () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]) {
      const { fetch } = catalogueAt({
        "/v1/fonts?type=google": json(LIST),
        "/v1/stats": stats,
      });
      const items = await readItems(catalogueRoute({ now: 0 }), fetch);
      expect(items.map(item => item.id)).toEqual(["abel", "lora"]);
      for (const item of items) expect(item).not.toHaveProperty("popularity");
    }
  });

  it("reads the stats once per catalogue read, and again only when the catalogue is", async () => {
    const { asked, fetch } = catalogueAt({
      "/v1/fonts?type=google": json(LIST),
      "/v1/stats": json(STATS),
    });
    const clock = { now: 0 };
    const route = catalogueRoute(clock);
    await readItems(route, fetch);
    await readItems(route, fetch);
    expect(asked.filter(path => path === "/v1/stats")).toHaveLength(1);

    clock.now += 25 * 60 * 60 * 1000;
    const items = await readItems(route, fetch);
    expect(asked.filter(path => path === "/v1/stats")).toHaveLength(2);
    expect(items.find(item => item.id === "lora")?.popularity).toBe(52_000);
  });
});
